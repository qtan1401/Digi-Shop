// ===== PRODUCT REPOSITORY =====
// Đây là tầng Repository - chịu trách nhiệm truy xuất dữ liệu từ Model (Database)
// Repository KHÔNG xử lý logic, chỉ đọc/ghi dữ liệu

const products = require("../models/product.model");

/**
 * Lấy tất cả sản phẩm từ database
 * @returns {Array} Mảng tất cả sản phẩm
 */
const getAllProducts = () => {
    return products;
};

/**
 * Tìm sản phẩm theo id
 * @param {number|string} id - ID của sản phẩm
 * @returns {Object|undefined} Sản phẩm tìm được hoặc undefined
 */
const getProductByID = (id) => {
    return products.find((product) => product.id == id);
};

/**
 * Tìm sản phẩm theo id (alias cho getProductByID)
 * @param {number|string} id - ID của sản phẩm
 * @returns {Object|undefined} Sản phẩm tìm được
 */
const findById = (id) => {
    return getProductByID(id);
};

/**
 * Cập nhật số lượng tồn kho của một sản phẩm
 * @param {number|string} id - ID của sản phẩm
 * @param {number} newStock - Số lượng tồn kho mới
 * @returns {Object|null} Sản phẩm sau khi cập nhật hoặc null nếu không tìm thấy
 */
const updateStock = (id, newStock) => {
    const product = getProductByID(id);
    if (!product) {
        return null;
    }
    product.stock = newStock;
    return product;
};

/**
 * Giảm số lượng tồn kho khi có đơn hàng
 * @param {number|string} id - ID của sản phẩm
 * @param {number} quantity - Số lượng cần giảm
 * @returns {Object|null} Sản phẩm sau khi trừ kho
 */
const decreaseStock = (id, quantity) => {
    const product = getProductByID(id);
    if (!product) {
        return null;
    }
    product.stock -= quantity;
    return product;
};

module.exports = {
    getAllProducts,
    getProductByID,
    findById,
    updateStock,
    decreaseStock
};
