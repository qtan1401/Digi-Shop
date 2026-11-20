// ===== CATEGORY SERVICE =====
// Business rules for administrator-managed product categories. Audit logging is the admin layer's job; every
// function here returns plain objects that are safe to snapshot.

const repository = require("../repositories/category.repository");

const SLUG_PATTERN = /^[a-z0-9-]{2,40}$/;
const SLUG_MESSAGE = "Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang, dài 2-40 ký tự";
const NAME_MAX = 80;
const SORT_ORDER_MAX = 100000;

class CategoryError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.name = "CategoryError";
        this.code = code;
        this.statusCode = statusCode;
        if (details) this.details = details;
    }
}

// Lowercases and strips Vietnamese diacritics; does not invent hyphens, so "may tinh" is rejected, not rewritten.
const normalizeSlug = (value) => typeof value === "string"
    ? value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase()
    : "";

const slugFromName = (name) => normalizeSlug(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const normalizeName = (value) => typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ") : "";

// The partial unique index rejects a duplicate undeleted slug even when a concurrent request passed the pre-check.
const isUniqueViolation = (error) =>
    error?.code === "P2002" || error?.code === "23505" || error?.cause?.code === "23505" || error?.cause?.originalCode === "23505";

const validationFailed = (fields) => new CategoryError("VALIDATION_FAILED", "Thông tin danh mục không hợp lệ", 400, { fields });
const notFound = () => new CategoryError("CATEGORY_NOT_FOUND", "Không tìm thấy danh mục", 404);
const slugTaken = (slug) => new CategoryError("SLUG_TAKEN", `Slug "${slug}" đã được dùng cho một danh mục khác`, 409, { fields: { slug: "Slug đã được dùng" } });

const view = (row) => row && {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sortOrder: row.sortOrder,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
};

const parseId = (value) => {
    const text = typeof value === "number" ? String(value) : value;
    if (typeof text !== "string" || !/^[1-9]\d{0,9}$/.test(text) || Number(text) > 2147483647) throw notFound();
    return Number(text);
};

const parseSortOrder = (value, fields) => {
    const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    if (!Number.isInteger(number) || number < 0 || number > SORT_ORDER_MAX) {
        fields.sortOrder = `Thứ tự phải là số nguyên từ 0 đến ${SORT_ORDER_MAX}`;
        return undefined;
    }
    return number;
};

const hasValue = (value) => value !== undefined && value !== null && value !== "";

const validateName = (value, fields) => {
    const name = normalizeName(value);
    if (name.length < 1 || name.length > NAME_MAX) fields.name = `Tên danh mục phải có 1-${NAME_MAX} ký tự`;
    return name;
};

const validateSlug = (value, fields) => {
    const slug = normalizeSlug(value);
    if (!SLUG_PATTERN.test(slug)) fields.slug = SLUG_MESSAGE;
    return slug;
};

// Public: undeleted categories in display order.
const listCategories = async () => (await repository.listActive()).map((row) => ({
    id: row.id, slug: row.slug, name: row.name, sortOrder: row.sortOrder
}));

// Admin: with the number of undeleted products in each category.
const listAdminCategories = async ({ includeDeleted = false } = {}) =>
    (await repository.listWithProductCounts({ includeDeleted })).map((row) => ({
        ...view(row), productCount: row._count.products
    }));

const getCategoryBySlug = async (slug) => {
    const normalized = normalizeSlug(slug);
    const row = SLUG_PATTERN.test(normalized) ? await repository.findActiveBySlug(normalized) : null;
    if (!row) throw notFound();
    return view(row);
};

// Admin lookup by id; includes soft-deleted rows so audit diffs can snapshot them.
const getCategory = async (id) => {
    const row = await repository.findById(parseId(id));
    if (!row) throw notFound();
    return view(row);
};

const createCategory = async (input = {}) => {
    const fields = {};
    const name = validateName(input.name, fields);
    const slug = validateSlug(hasValue(input.slug) ? input.slug : slugFromName(input.name), fields);
    const sortOrder = hasValue(input.sortOrder) ? parseSortOrder(input.sortOrder, fields) : undefined;
    if (Object.keys(fields).length) throw validationFailed(fields);

    if (await repository.findActiveBySlug(slug)) throw slugTaken(slug);
    const order = sortOrder ?? ((await repository.maxSortOrder()) ?? 0) + 1;
    try {
        return view(await repository.create({ slug, name, sortOrder: order }));
    } catch (error) {
        if (isUniqueViolation(error)) throw slugTaken(slug);
        throw error;
    }
};

// Renaming and reordering are always allowed. Changing the slug is refused while ANY product (deleted or not)
// belongs to the category, so /danh-muc/<slug> links and products.device_type never go stale.
const updateCategory = async (id, input = {}) => {
    const categoryId = parseId(id);
    const fields = {};
    const changes = {};
    if (input.name !== undefined) changes.name = validateName(input.name, fields);
    if (input.slug !== undefined) changes.slug = validateSlug(input.slug, fields);
    if (input.sortOrder !== undefined) changes.sortOrder = parseSortOrder(input.sortOrder, fields);
    if (Object.keys(fields).length) throw validationFailed(fields);

    try {
        return await repository.withCategoryLock(categoryId, async (tx, current) => {
            if (!current || current.isDeleted) throw notFound();
            if (changes.slug !== undefined && changes.slug === current.slug) delete changes.slug;
            if (Object.keys(changes).length === 0) return view(current);
            if (changes.slug !== undefined) {
                const productCount = await repository.countProducts(categoryId, { includeDeleted: true }, tx);
                if (productCount > 0) {
                    throw new CategoryError(
                        "CATEGORY_SLUG_LOCKED",
                        `Không thể đổi slug vì danh mục còn ${productCount} sản phẩm (kể cả sản phẩm đã xóa)`,
                        409,
                        { productCount, fields: { slug: "Không thể đổi slug khi danh mục còn sản phẩm" } }
                    );
                }
                if (await repository.findActiveBySlug(changes.slug, tx)) throw slugTaken(changes.slug);
            }
            return view(await repository.update(categoryId, changes, tx));
        });
    } catch (error) {
        if (isUniqueViolation(error)) throw slugTaken(changes.slug);
        throw error;
    }
};

// Soft delete; refused while any undeleted product still belongs to the category.
const softDeleteCategory = async (id) => {
    const categoryId = parseId(id);
    return repository.withCategoryLock(categoryId, async (tx, current) => {
        if (!current || current.isDeleted) throw notFound();
        const productCount = await repository.countProducts(categoryId, { includeDeleted: false }, tx);
        if (productCount > 0) {
            throw new CategoryError(
                "CATEGORY_IN_USE",
                `Không thể xóa danh mục "${current.name}" vì còn ${productCount} sản phẩm. Hãy chuyển hoặc xóa các sản phẩm đó trước`,
                409,
                { productCount }
            );
        }
        return view(await repository.update(categoryId, { isDeleted: true, deletedAt: new Date() }, tx));
    });
};

module.exports = {
    CategoryError,
    SLUG_PATTERN,
    normalizeSlug,
    normalizeName,
    slugFromName,
    isUniqueViolation,
    listCategories,
    listAdminCategories,
    getCategoryBySlug,
    getCategory,
    createCategory,
    updateCategory,
    softDeleteCategory
};
