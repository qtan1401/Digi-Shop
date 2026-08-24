// ===== PRODUCT ROUTES =====
// Đây là tầng Routes - định nghĩa các endpoint (URL) và kết nối với Controller
// Routes quyết định: Khi client gọi URL nào → chạy hàm nào trong Controller

const express = require("express");
const productController = require("../controllers/product.controller");
const checkoutController = require("../controllers/checkout.controller");

const router = express.Router();

// GET /api/products → Lấy danh sách tất cả sản phẩm
router.get("/", productController.getAll);

// GET /api/products/info/:slug → Lấy chi tiết sản phẩm theo slug
// :slug là Route Parameter - giá trị động truyền qua URL
// Ví dụ: /api/products/info/iphone-16-pro-max → req.params.slug = "iphone-16-pro-max"
router.get("/info/:id", productController.getProductID);
module.exports = router;
