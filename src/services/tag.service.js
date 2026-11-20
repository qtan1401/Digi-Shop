// ===== TAG SERVICE =====
// Business rules for tags (free-form product attributes such as gaming, khong-day) and their assignment to products.
// Audit logging is the admin layer's job; every function returns plain objects that are safe to snapshot.

const repository = require("../repositories/tag.repository");
const { BRANDS, brandSlug } = require("../../public/js/catalog-taxonomy");
const { SLUG_PATTERN, normalizeSlug, normalizeName, slugFromName, isUniqueViolation } = require("./category.service");

const SLUG_MESSAGE = "Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang, dài 2-40 ký tự";
const NAME_MAX = 60;
const MAX_TAGS_PER_PRODUCT = 20;
// /the/<brand slug> redirects (301) to /hang/<brand>, so a tag can never take one of these slugs.
const RESERVED_SLUGS = Object.freeze(BRANDS.map(brandSlug));

class TagError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.name = "TagError";
        this.code = code;
        this.statusCode = statusCode;
        if (details) this.details = details;
    }
}

const validationFailed = (fields, extra) => new TagError("VALIDATION_FAILED", "Thông tin thẻ không hợp lệ", 400, { fields, ...extra });
const notFound = () => new TagError("TAG_NOT_FOUND", "Không tìm thấy thẻ", 404);
const productNotFound = () => new TagError("PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm", 404);
const slugTaken = (slug) => new TagError("SLUG_TAKEN", `Slug "${slug}" đã được dùng cho một thẻ khác`, 409, { fields: { slug: "Slug đã được dùng" } });
const slugReserved = (slug) => new TagError(
    "TAG_SLUG_RESERVED",
    `Slug "${slug}" trùng tên một hãng nên không thể dùng cho thẻ`,
    409,
    { fields: { slug: "Slug trùng tên một hãng" } }
);

const view = (row) => row && {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
};

const publicView = (row) => ({ id: row.id, slug: row.slug, name: row.name });

const parseId = (value) => {
    const text = typeof value === "number" ? String(value) : value;
    return typeof text === "string" && /^[1-9]\d{0,9}$/.test(text) && Number(text) <= 2147483647 ? Number(text) : undefined;
};

const hasValue = (value) => value !== undefined && value !== null && value !== "";

const validateName = (value, fields) => {
    const name = normalizeName(value);
    if (name.length < 1 || name.length > NAME_MAX) fields.name = `Tên thẻ phải có 1-${NAME_MAX} ký tự`;
    return name;
};

const validateSlug = (value, fields) => {
    const slug = normalizeSlug(value);
    if (!SLUG_PATTERN.test(slug)) fields.slug = SLUG_MESSAGE;
    return slug;
};

// Public: undeleted tags, alphabetical.
const listTags = async () => (await repository.listActive()).map(publicView);

// Admin: with the number of undeleted products carrying each tag.
const listAdminTags = async ({ includeDeleted = false } = {}) =>
    (await repository.listWithProductCounts({ includeDeleted })).map((row) => ({
        ...view(row), productCount: row._count.products
    }));

const getTagBySlug = async (slug) => {
    const normalized = normalizeSlug(slug);
    const row = SLUG_PATTERN.test(normalized) ? await repository.findActiveBySlug(normalized) : null;
    if (!row) throw notFound();
    return publicView(row);
};

// Admin lookup by id; includes soft-deleted rows so audit diffs can snapshot them.
const getTag = async (id) => {
    const tagId = parseId(id);
    const row = tagId === undefined ? null : await repository.findById(tagId);
    if (!row) throw notFound();
    return view(row);
};

const assertSlugAvailable = async (slug) => {
    if (RESERVED_SLUGS.includes(slug)) throw slugReserved(slug);
    if (await repository.findActiveBySlug(slug)) throw slugTaken(slug);
};

const createTag = async (input = {}) => {
    const fields = {};
    const name = validateName(input.name, fields);
    const slug = validateSlug(hasValue(input.slug) ? input.slug : slugFromName(input.name), fields);
    if (Object.keys(fields).length) throw validationFailed(fields);

    await assertSlugAvailable(slug);
    try {
        return view(await repository.create({ slug, name }));
    } catch (error) {
        if (isUniqueViolation(error)) throw slugTaken(slug);
        throw error;
    }
};

const updateTag = async (id, input = {}) => {
    const tagId = parseId(id);
    const current = tagId === undefined ? null : await repository.findById(tagId);
    if (!current || current.isDeleted) throw notFound();

    const fields = {};
    const changes = {};
    if (input.name !== undefined) changes.name = validateName(input.name, fields);
    if (input.slug !== undefined) changes.slug = validateSlug(input.slug, fields);
    if (Object.keys(fields).length) throw validationFailed(fields);

    if (changes.slug === current.slug) delete changes.slug;
    if (Object.keys(changes).length === 0) return view(current);
    if (changes.slug !== undefined) await assertSlugAvailable(changes.slug);
    try {
        return view(await repository.update(tagId, changes));
    } catch (error) {
        if (isUniqueViolation(error)) throw slugTaken(changes.slug);
        throw error;
    }
};

// Soft delete: the tag disappears from every product and from /the/*; its slug becomes reusable.
const softDeleteTag = async (id) => {
    const tagId = parseId(id);
    const current = tagId === undefined ? null : await repository.findById(tagId);
    if (!current || current.isDeleted) throw notFound();
    const deleted = await repository.softDelete(tagId);
    if (!deleted) throw notFound();
    return view(deleted);
};

const parseTagIds = (tagIds) => {
    if (!Array.isArray(tagIds) || tagIds.length > MAX_TAGS_PER_PRODUCT) {
        throw validationFailed({ tagIds: `Thẻ phải là danh sách tối đa ${MAX_TAGS_PER_PRODUCT} thẻ` });
    }
    const ids = tagIds.map(parseId);
    if (ids.some((tagId) => tagId === undefined)) throw validationFailed({ tagIds: "Mã thẻ không hợp lệ" });
    return [...new Set(ids)];
};

// Replaces the full tag set of a product (an empty list clears it). Returns the product's undeleted tags.
const setProductTags = async (productId, tagIds) => {
    const id = parseId(productId);
    if (id === undefined) throw productNotFound();
    const ids = parseTagIds(tagIds);
    if (!await repository.findProduct(id)) throw productNotFound();
    if (ids.length > 0) {
        const found = new Set((await repository.findActiveByIds(ids)).map((row) => row.id));
        const missing = ids.filter((tagId) => !found.has(tagId));
        if (missing.length > 0) {
            throw validationFailed({ tagIds: "Có thẻ không tồn tại hoặc đã bị xóa" }, { missingTagIds: missing });
        }
    }
    const rows = await repository.replaceProductTags(id, ids);
    if (rows === undefined) throw productNotFound();
    if (rows === null) {
        throw validationFailed({ tagIds: "Có thẻ không tồn tại hoặc đã bị xóa" });
    }
    return rows.map(publicView);
};

const getProductTags = async (productId) => {
    const id = parseId(productId);
    if (id === undefined || !await repository.findProduct(id)) throw productNotFound();
    return (await repository.listForProduct(id)).map(publicView);
};

// For listing pages: Map<productId, tag[]> (undeleted tags only; products without tags are absent from the map).
const getTagsByProductIds = async (productIds) => {
    const ids = [...new Set((productIds || []).map(parseId).filter((id) => id !== undefined))];
    const result = new Map();
    if (ids.length === 0) return result;
    for (const link of await repository.listLinksForProducts(ids)) {
        if (!result.has(link.productId)) result.set(link.productId, []);
        result.get(link.productId).push(publicView(link.tag));
    }
    for (const tags of result.values()) tags.sort((a, b) => a.name.localeCompare(b.name, "vi") || a.id - b.id);
    return result;
};

module.exports = {
    TagError,
    MAX_TAGS_PER_PRODUCT,
    RESERVED_SLUGS,
    listTags,
    listAdminTags,
    getTagBySlug,
    getTag,
    createTag,
    updateTag,
    softDeleteTag,
    setProductTags,
    getProductTags,
    getTagsByProductIds
};
