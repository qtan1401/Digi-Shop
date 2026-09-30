// ===== PRODUCT SERVICE =====
// Business logic and invariants for the Product domain.

const productRepository = require("../repositories/product.repository");

const REQUIRED_FIELDS = ["name", "brand", "deviceType", "price", "stock", "sku", "image", "description"];
const EDITABLE_FIELDS = ["name", "brand", "deviceType", "price", "stock", "image", "description"];
const BRANDS = ["Apple", "Samsung", "MSI"];
const DEVICE_TYPES = ["phone", "tablet", "laptop"];
const PRODUCT_STATUSES = ["all", "active", "deleted"];

const createDomainError = (message, errors = [], statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.status = statusCode;
    error.errors = errors;
    return error;
};

const isAllowed = (value, choices) => typeof value === "string" && choices.includes(value);

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

    if (!isAllowed(data.brand, BRANDS)) {
        errors.push({ field: "brand", message: "Thương hiệu phải là Apple, Samsung hoặc MSI" });
    }

    if (!isAllowed(data.deviceType, DEVICE_TYPES)) {
        errors.push({ field: "deviceType", message: "Loại thiết bị phải là phone, tablet hoặc laptop" });
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

const assertUniqueSku = async (sku, productId) => {
    const existing = await productRepository.findBySku(sku);
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
const getAllProducts = async (options = {}) => {
    if (options === true || options.includeDeleted === true || options.status === "all") {
        return await productRepository.findWithFilter("", "all");
    }
    if (options.status === "deleted") {
        return await productRepository.findWithFilter("", "deleted");
    }
    return await productRepository.findWithFilter("", "active");
};

/**
 * Public detail lookup excludes soft-deleted products by default.
 */
const getProductByID = async (id, options = {}) => {
    const product = await productRepository.getProductByID(id);
    if (!product || (product.isDeleted === true && options.includeDeleted !== true)) {
        throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    }
    return product;
};

const getProductById = getProductByID;
const getAdminProductById = async (id) =>
    await getProductByID(id, { includeDeleted: true });

const findProducts = async (filters = {}) => {
    const status = filters.status || "active";
    if (!PRODUCT_STATUSES.includes(status)) {
        throw createDomainError("Trạng thái sản phẩm không hợp lệ.", [
            { field: "status", message: "status phải là all, active hoặc deleted" }
        ]);
    }
    return await productRepository.findWithFilter(filters.q, status);
};

const getAdminProducts = async (filters = {}) => {
    const data = await findProducts(filters);
    return { data, total: data.length };
};

const createProduct = async (input) => {
    const data = validateProduct(input);
    await assertUniqueSku(data.sku);
    const timestamp = new Date().toISOString();
    return await productRepository.createProduct({
        ...data,
        slug: slugify(data.name),
        isDeleted: false,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
    });
};

const updateProduct = async (id, input = {}) => {
    const product = await productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);

    const changes = {};
    for (const field of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(input, field)) changes[field] = input[field];
    }
    const merged = validateProduct({ ...product, ...changes }, { requireSku: true });
    await assertUniqueSku(product.sku, product.id);

    // Keep the original SKU regardless of a forged payload.
    delete merged.sku;
    delete merged.id;
    delete merged.slug;
    delete merged.isDeleted;
    delete merged.deletedAt;
    delete merged.createdAt;
    return await productRepository.updateProduct(product.id, merged);
};

const softDeleteProduct = async (id) => {
    const product = await productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    if (product.isDeleted === true) {
        throw createDomainError("Sản phẩm đã nằm trong thùng rác.");
    }
    return await productRepository.softDelete(id);
};

const deleteProduct = softDeleteProduct;

const restoreProduct = async (id) => {
    const product = await productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    if (product.isDeleted !== true) {
        throw createDomainError("Sản phẩm hiện không ở trạng thái đã xóa.");
    }

    await assertUniqueSku(product.sku, product.id);
    return await productRepository.restoreProduct(id);
};

const restore = restoreProduct;

module.exports = {
    REQUIRED_FIELDS,
    BRANDS,
    DEVICE_TYPES,
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
