// ===== PRODUCT SERVICE =====
// Đây là tầng Service - chứa business logic (xử lý nghiệp vụ)
// Service gọi Repository để lấy dữ liệu, sau đó xử lý logic trước khi trả về Controller

const productRepository = require("../repositories/product.repository");

/**
 * Lấy danh sách tất cả sản phẩm
 * @returns {Array} Danh sách sản phẩm
 */
const getAllProducts = () => {
    return productRepository.getAllProducts();
};

/**
 * Lấy thông tin chi tiết 1 sản phẩm theo ID
 * @param {number|string} id - ID của sản phẩm
 * @returns {Object} Sản phẩm tìm được
 * @throws {Error} Nếu không tìm thấy sản phẩm
 */
const getProductByID = (id) => {
    const product = productRepository.getProductByID(id);
    if (!product) {
        throw new Error("Không tìm thấy sản phẩm");
    }
    return product;
};

module.exports = {
    getAllProducts,
    getProductByID
};
