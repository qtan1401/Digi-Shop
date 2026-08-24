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

module.exports = {
    getAllProducts,
    getProductByID
};
