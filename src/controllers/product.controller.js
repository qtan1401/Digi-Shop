// ===== PRODUCT CONTROLLER =====
// Đây là tầng Controller - nhận request từ client, gọi Service xử lý, trả response
// Controller KHÔNG chứa business logic, chỉ điều phối

const productService = require("../services/product.service");

/**
 * [GET] /api/products
 * Lấy danh sách tất cả sản phẩm
 */
const getAll = (req, res) => {
    const products = productService.getAllProducts();
    res.json({ success: true, data: products });
};

/**
 * [GET] /api/products/info/:id
 * Lấy thông tin chi tiết 1 sản phẩm theo ID (route params)
 */
const getProductID = (req, res) => {
    try {
        const id = req.params.id;
        const product = productService.getProductByID(id);
        res.json({ success: true, data: product });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAll,
    getProductID
};
