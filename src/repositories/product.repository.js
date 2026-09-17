// ===== PRODUCT REPOSITORY =====
// Đây là tầng Repository - chịu trách nhiệm truy xuất dữ liệu từ Model (Database)
// Repository KHÔNG xử lý logic, chỉ đọc/ghi dữ liệu

const products = require("../models/product.model");

/**
 * Lấy tất cả sản phẩm từ database.
 *
 * Repository trả về bản ghi gốc để giữ tương thích với các luồng tồn kho cũ;
 * việc lọc sản phẩm đã xóa thuộc về service/filter dành cho từng boundary.
 * @returns {Array} Mảng tất cả sản phẩm
 */
const getAllProducts = () => products;

/**
 * Tìm sản phẩm theo id.
 * @param {number|string} id
 * @returns {Object|undefined}
 */
const getProductByID = (id) => products.find((product) => product.id == id);

/**
 * Tìm sản phẩm theo id (tên camelCase dùng bởi các domain mới).
 * @param {number|string} id
 * @returns {Object|undefined}
 */
const findById = (id) => getProductByID(id);

/**
 * Tìm sản phẩm theo SKU đã chuẩn hóa.
 * SKU được kiểm tra trên toàn bộ lịch sử, bao gồm cả sản phẩm đã xóa mềm.
 * @param {string} sku
 * @returns {Object|undefined}
 */
const findBySku = (sku) => {
    if (typeof sku !== "string") return undefined;
    const normalizedSku = sku.trim().toUpperCase();
    return products.find((product) =>
        typeof product.sku === "string" && product.sku.trim().toUpperCase() === normalizedSku
    );
};

const isSkuTaken = (sku) => Boolean(findBySku(sku));
const checkSku = (sku) => isSkuTaken(sku);

/**
 * Cập nhật số lượng tồn kho của một sản phẩm
 * @param {number|string} id
 * @param {number} newStock
 * @returns {Object|null}
 */
const updateStock = (id, newStock) => {
    const product = getProductByID(id);
    if (!product) return null;
    product.stock = newStock;
    product.updatedAt = new Date().toISOString();
    return product;
};

/**
 * Giảm số lượng tồn kho khi có đơn hàng.
 * @param {number|string} id
 * @param {number} quantity
 * @returns {Object|null}
 */
const decreaseStock = (id, quantity) => {
    const product = getProductByID(id);
    if (!product) return null;
    product.stock -= quantity;
    product.updatedAt = new Date().toISOString();
    return product;
};

const nextId = () => products.reduce((max, product) => Math.max(max, Number(product.id) || 0), 0) + 1;

/**
 * Lưu một sản phẩm mới. Validation/normalization thuộc service.
 * @param {Object} productData
 * @returns {Object}
 */
const createProduct = (productData) => {
    const product = { ...productData, id: nextId() };
    products.push(product);
    return product;
};

/**
 * Cập nhật các field đã được service cho phép.
 * @param {number|string} id
 * @param {Object} changes
 * @returns {Object|null}
 */
const updateProduct = (id, changes) => {
    const product = getProductByID(id);
    if (!product) return null;
    Object.assign(product, changes, { updatedAt: new Date().toISOString() });
    return product;
};

/**
 * Đánh dấu xóa mềm, tuyệt đối không loại bỏ record khỏi mảng.
 * @param {number|string} id
 * @returns {Object|null}
 */
const softDelete = (id) => {
    const product = getProductByID(id);
    if (!product) return null;
    product.isDeleted = true;
    product.deletedAt = new Date().toISOString();
    product.updatedAt = product.deletedAt;
    return product;
};

const deleteProduct = (id) => softDelete(id);

/**
 * Khôi phục record đã xóa. Service chịu trách nhiệm kiểm tra category.
 * @param {number|string} id
 * @param {Object} changes
 * @returns {Object|null}
 */
const restore = (id, changes = {}) => {
    const product = getProductByID(id);
    if (!product) return null;
    Object.assign(product, changes, {
        isDeleted: false,
        deletedAt: null,
        updatedAt: new Date().toISOString()
    });
    return product;
};

const restoreProduct = (id, changes = {}) => restore(id, changes);

/**
 * Lọc sản phẩm dành cho admin. Mặc định chỉ trả active.
 * @param {string} q
 * @param {number|string} categoryId
 * @param {"all"|"active"|"deleted"} status
 * @returns {Array}
 */
const findWithFilter = (q = "", categoryId, status = "active") => {
    const query = typeof q === "string" ? q.trim().toLowerCase() : "";
    return products.filter((product) => {
        const deleted = product.isDeleted === true;
        if (status === "active" && deleted) return false;
        if (status === "deleted" && !deleted) return false;
        if (categoryId !== undefined && categoryId !== null && String(categoryId) !== "" &&
            product.categoryId != categoryId) return false;
        if (query && !String(product.name || "").toLowerCase().includes(query) &&
            !String(product.sku || "").toLowerCase().includes(query)) return false;
        return true;
    });
};

const getProductsByFilter = (filters = {}) =>
    findWithFilter(filters.q, filters.categoryId, filters.status || "active");

module.exports = {
    getAllProducts,
    getProductByID,
    findById,
    findBySku,
    isSkuTaken,
    checkSku,
    findWithFilter,
    getProductsByFilter,
    createProduct,
    updateProduct,
    softDelete,
    deleteProduct,
    restore,
    restoreProduct,
    updateStock,
    decreaseStock
};
