// ===== PRODUCT ROUTES =====
// Đây là tầng Routes - định nghĩa các endpoint (URL) và kết nối với Controller
// Routes quyết định: Khi client gọi URL nào → chạy hàm nào trong Controller

const express = require("express");
const productController = require("../controllers/product.controller");

const router = express.Router();

// GET /api/products → Lấy danh sách tất cả sản phẩm
router.get("/", productController.getAll);

// GET /api/products/info/:id → Lấy thông tin sản phẩm theo ID
// Trang product_info.html đọc `id` từ query string rồi gọi endpoint này.
router.get("/info/:id", productController.getProductID);
module.exports = router;
