// ===== PRODUCT SERVICE =====
// Business logic and invariants for the Product domain.

const productRepository = require("../repositories/product.repository");

const REQUIRED_FIELDS = ["name", "price", "stock", "categoryId", "sku", "image", "description"];
const EDITABLE_FIELDS = ["name", "price", "stock", "categoryId", "image", "description"];
const PRODUCT_STATUSES = ["all", "active", "deleted"];

const createDomainError = (message, errors = [], statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.status = statusCode;
    error.errors = errors;
    return error;
};

const getCategoryService = () => require("./category.service");

const findCategory = (categoryId) => {
    const categoryService = getCategoryService();
    if (typeof categoryService.findCategoryById === "function") {
        return categoryService.findCategoryById(categoryId);
    }
    try {
        return categoryService.getCategoryById(categoryId);
    } catch (error) {
        return undefined;
    }
};

const assertActiveCategory = (categoryId) => {
    const category = findCategory(categoryId);
    if (!category || category.isDeleted === true) {
        throw createDomainError(
            "Danh mục không tồn tại hoặc đã bị xóa.",
            [{ field: "categoryId", message: "Danh mục phải đang hoạt động" }]
        );
    }
    return category;
};

const normalizeSku = (sku) => typeof sku === "string" ? sku.trim().toUpperCase() : "";

const slugify = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isBlank = (value) =>
    value === undefined || value === null ||
    (typeof value === "string" && value.trim().length === 0);

/**
 * Validate and normalize the complete product shape.
 * @param {Object} input
 * @param {boolean} requireSku
 * @returns {Object}
 */
const validateProduct = (input, { requireSku = true } = {}) => {
    const data = { ...input };
    const errors = [];

    for (const field of REQUIRED_FIELDS) {
        if (field === "sku" && !requireSku) continue;
        if (isBlank(data[field])) {
            errors.push({ field, message: `${field} là trường bắt buộc` });
        }
    }

    if (typeof data.name === "string") {
        data.name = data.name.trim();
        if (data.name.length < 2 || data.name.length > 200) {
            errors.push({ field: "name", message: "Tên sản phẩm phải từ 2 đến 200 ký tự" });
        }
    } else if (!isBlank(data.name)) {
        errors.push({ field: "name", message: "Tên sản phẩm phải là chuỗi" });
    }

    if (typeof data.price !== "number" || !Number.isFinite(data.price) ||
        !Number.isInteger(data.price) || data.price <= 0) {
        errors.push({ field: "price", message: "Giá bán phải là số nguyên dương (> 0)" });
    }

    if (typeof data.stock !== "number" || !Number.isFinite(data.stock) ||
        !Number.isInteger(data.stock) || data.stock < 0) {
        errors.push({ field: "stock", message: "Tồn kho phải là số nguyên không âm (≥ 0)" });
    }

    if (typeof data.categoryId !== "number" || !Number.isInteger(data.categoryId) || data.categoryId <= 0) {
        errors.push({ field: "categoryId", message: "categoryId phải là số nguyên dương" });
    }

    if (requireSku || !isBlank(data.sku)) {
        data.sku = normalizeSku(data.sku);
        if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(data.sku)) {
            errors.push({ field: "sku", message: "SKU chỉ được chứa chữ cái, số và dấu gạch nối" });
        }
    }

    if (typeof data.image !== "string" || isBlank(data.image)) {
        if (!errors.some((error) => error.field === "image")) {
            errors.push({ field: "image", message: "Ảnh sản phẩm là trường bắt buộc" });
        }
    } else {
        data.image = data.image.trim();
        try {
            const imageUrl = new URL(data.image);
            if (!["http:", "https:"].includes(imageUrl.protocol)) throw new Error("invalid protocol");
        } catch (error) {
            errors.push({ field: "image", message: "Ảnh sản phẩm phải là URL hợp lệ" });
        }
    }

    if (typeof data.description !== "string" || isBlank(data.description)) {
        if (!errors.some((error) => error.field === "description")) {
            errors.push({ field: "description", message: "Mô tả sản phẩm là trường bắt buộc" });
        }
    } else {
        data.description = data.description.trim();
    }

    if (errors.length > 0) {
        throw createDomainError(
            "Vui lòng nhập đầy đủ và chính xác các trường bắt buộc của sản phẩm.",
            errors
        );
    }

    return data;
};

const assertUniqueSku = (sku, productId) => {
    const existing = productRepository.findBySku(sku);
    if (existing && String(existing.id) !== String(productId)) {
        throw createDomainError(
            `Mã SKU '${sku}' đã tồn tại trên hệ thống. SKU là duy nhất vĩnh viễn.`,
            [{ field: "sku", message: "SKU trùng lặp" }]
        );
    }
};

/**
 * Public list. Deleted records are excluded by default.
 * Set includeDeleted/status explicitly for an internal/admin caller.
 */
const getAllProducts = (options = {}) => {
    if (options === true || options.includeDeleted === true || options.status === "all") {
        return productRepository.findWithFilter("", undefined, "all");
    }
    if (options.status === "deleted") {
        return productRepository.findWithFilter("", undefined, "deleted");
    }
    return productRepository.findWithFilter("", undefined, "active");
};

/**
 * Public detail lookup excludes soft-deleted products by default.
 */
const getProductByID = (id, options = {}) => {
    const product = productRepository.getProductByID(id);
    if (!product || (product.isDeleted === true && options.includeDeleted !== true)) {
        throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    }
    return product;
};

const getProductById = getProductByID;
const getAdminProductById = (id) => getProductByID(id, { includeDeleted: true });

const findProducts = (filters = {}) => {
    const status = filters.status || "active";
    if (!PRODUCT_STATUSES.includes(status)) {
        throw createDomainError("Trạng thái sản phẩm không hợp lệ.", [
            { field: "status", message: "status phải là all, active hoặc deleted" }
        ]);
    }
    return productRepository.findWithFilter(filters.q, filters.categoryId, status);
};

const getAdminProducts = (filters = {}) => {
    const data = findProducts(filters);
    return { data, total: data.length };
};

const createProduct = (input) => {
    const data = validateProduct(input);
    assertActiveCategory(data.categoryId);
    assertUniqueSku(data.sku);
    const timestamp = new Date().toISOString();
    return productRepository.createProduct({
        ...data,
        slug: slugify(data.name),
        isDeleted: false,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
    });
};

const updateProduct = (id, input = {}) => {
    const product = productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);

    const changes = {};
    for (const field of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(input, field)) changes[field] = input[field];
    }
    const merged = validateProduct({ ...product, ...changes }, { requireSku: true });
    assertActiveCategory(merged.categoryId);
    assertUniqueSku(product.sku, product.id);

    // Keep the original SKU regardless of a forged payload.
    delete merged.sku;
    delete merged.id;
    delete merged.slug;
    delete merged.isDeleted;
    delete merged.deletedAt;
    delete merged.createdAt;
    return productRepository.updateProduct(product.id, merged);
};

const softDeleteProduct = (id) => {
    const product = productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    if (product.isDeleted === true) {
        throw createDomainError("Sản phẩm đã nằm trong thùng rác.");
    }
    return productRepository.softDelete(id);
};

const deleteProduct = softDeleteProduct;

const restoreProduct = (id, options = {}) => {
    const product = productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    if (product.isDeleted !== true) {
        throw createDomainError("Sản phẩm hiện không ở trạng thái đã xóa.");
    }

    const newCategoryId = typeof options === "object" && options !== null
        ? options.newCategoryId
        : options;
    const category = findCategory(product.categoryId);
    let categoryId = product.categoryId;
    if (!category || category.isDeleted === true) {
        if (newCategoryId === undefined || newCategoryId === null || newCategoryId === "") {
            throw createDomainError(
                "Danh mục gốc đã bị xóa. Vui lòng chọn danh mục mới cho sản phẩm trước khi khôi phục.",
                [{ field: "newCategoryId", message: "Cần chọn danh mục mới hợp lệ" }]
            );
        }
        categoryId = assertActiveCategory(newCategoryId).id;
    } else if (newCategoryId !== undefined && newCategoryId !== null && String(newCategoryId) !== "") {
        categoryId = assertActiveCategory(newCategoryId).id;
    }

    assertUniqueSku(product.sku, product.id);
    return productRepository.restoreProduct(id, { categoryId });
};

const restore = restoreProduct;

module.exports = {
    REQUIRED_FIELDS,
    EDITABLE_FIELDS,
    PRODUCT_STATUSES,
    normalizeSku,
    getAllProducts,
    getProductByID,
    getProductById,
    getAdminProductById,
    findProducts,
    getAdminProducts,
    createProduct,
    updateProduct,
    softDeleteProduct,
    deleteProduct,
    restoreProduct,
    restore
};
