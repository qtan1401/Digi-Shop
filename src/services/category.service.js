// ===== CATEGORY SERVICE =====
// Category validation, slug normalization, and the active-product deletion guard.
// Product lookup is injected at call time so this service never imports the
// product repository (and therefore cannot introduce a circular dependency).

const categoryRepository = require("../repositories/category.repository");

const CATEGORY_NAME_ERROR = "Tên danh mục phải từ 2 đến 100 ký tự";
const DUPLICATE_SLUG_ERROR = (slug) => `Slug danh mục '${slug}' đã tồn tại. Vui lòng chọn tên khác.`;
const CATEGORY_NOT_FOUND_ERROR = "Không tìm thấy danh mục";
const PRODUCT_LOOKUP_ERROR = "Không thể kiểm tra sản phẩm thuộc danh mục.";

let defaultProductLookup;

/**
 * Normalize a display name into the URL slug used by Category.
 * Vietnamese diacritics are removed, separators are collapsed, and only
 * lowercase ASCII letters, numbers, and hyphens remain.
 *
 * @param {string} name
 * @returns {string}
 */
const normalizeSlug = (name) => String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const validateCategoryName = (name) => {
    if (typeof name !== "string") throw new Error(CATEGORY_NAME_ERROR);

    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 100) {
        throw new Error(CATEGORY_NAME_ERROR);
    }

    return normalizedName;
};

const normalizeDescription = (description) => {
    if (description === undefined || description === null) return "";
    if (typeof description !== "string") {
        throw new Error("Mô tả danh mục phải là chuỗi ký tự");
    }
    return description.trim();
};

/**
 * Install a lookup used by deleteCategory when a lookup is not supplied for
 * an individual call. The lookup may be an array, a function returning an
 * array/count, or a repository exposing getAllProducts().
 *
 * @param {Array|Function|Object} lookup
 * @returns {Array|Function|Object}
 */
const setProductLookup = (lookup) => {
    defaultProductLookup = lookup;
    return lookup;
};

const resolveProductLookup = (lookup, categoryId) => {
    const source = lookup === undefined ? defaultProductLookup : lookup;

    if (Array.isArray(source)) return source;
    if (typeof source === "function") return source(categoryId);
    if (source && typeof source.getAllProducts === "function") {
        return source.getAllProducts();
    }
    if (source && typeof source.findWithFilter === "function") {
        return source.findWithFilter(undefined, categoryId, "active");
    }

    throw new Error(PRODUCT_LOOKUP_ERROR);
};

/**
 * Count active products belonging to a category. A product is active only
 * when its lifecycle flag is explicitly false, matching the G3 contract.
 *
 * @param {number|string} categoryId
 * @param {Array|Function|Object} [productLookup]
 * @returns {number}
 */
const getActiveProductCount = (categoryId, productLookup) => {
    const lookupResult = resolveProductLookup(productLookup, categoryId);
    if (typeof lookupResult === "number") return lookupResult;

    const products = Array.isArray(lookupResult)
        ? lookupResult
        : lookupResult && Array.isArray(lookupResult.data)
            ? lookupResult.data
            : null;
    if (!products) throw new Error(PRODUCT_LOOKUP_ERROR);

    return products.reduce((count, product) => {
        if (product && product.isDeleted === false && String(product.categoryId) === String(categoryId)) {
            return count + 1;
        }
        return count;
    }, 0);

};

const getAllCategories = () => categoryRepository.getAllCategories();

const findCategoryById = (id) => categoryRepository.getCategoryById(id);

const getCategoryById = (id) => {
    const category = findCategoryById(id);
    if (!category) throw new Error(CATEGORY_NOT_FOUND_ERROR);
    return category;
};

const getCategoryBySlug = (slug) => categoryRepository.getCategoryBySlug(normalizeSlug(slug));

const createCategory = ({ name, description } = {}) => {
    const normalizedName = validateCategoryName(name);
    const slug = normalizeSlug(normalizedName);
    if (!slug) throw new Error(CATEGORY_NAME_ERROR);

    if (categoryRepository.getCategoryBySlug(slug)) {
        throw new Error(DUPLICATE_SLUG_ERROR(slug));
    }

    return categoryRepository.createCategory({
        name: normalizedName,
        slug,
        description: normalizeDescription(description)
    });
};

const deleteCategory = (id, productLookup) => {
    const category = findCategoryById(id);
    if (!category) throw new Error(CATEGORY_NOT_FOUND_ERROR);

    const activeProductCount = getActiveProductCount(category.id, productLookup);
    if (activeProductCount > 0) {
        throw new Error(
            `Không thể xóa danh mục đang có ${activeProductCount} sản phẩm đang kinh doanh. Vui lòng xóa hoặc chuyển sản phẩm trước.`
        );
    }

    return categoryRepository.deleteCategory(category.id);
};

module.exports = {
    getAllCategories,
    getCategoryById,
    findCategoryById,
    getCategoryBySlug,
    createCategory,
    deleteCategory,
    getActiveProductCount,
    setProductLookup,
    normalizeSlug,
    validateCategoryName,
    CATEGORY_NAME_ERROR,
    CATEGORY_NOT_FOUND_ERROR,
    PRODUCT_LOOKUP_ERROR,
    // Short names mirror the G3 domain outline while the descriptive names
    // above remain convenient for controllers and existing conventions.
    getAll: getAllCategories,
    getById: getCategoryById,
    getBySlug: getCategoryBySlug,
    create: createCategory,
    remove: deleteCategory,
    getCategoryByID: getCategoryById,
    getByID: getCategoryById
};
