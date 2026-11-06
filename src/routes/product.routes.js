// ===== PRODUCT ROUTES =====
// Đây là tầng Routes - định nghĩa các endpoint (URL) và kết nối với Controller
// Routes quyết định: Khi client gọi URL nào → chạy hàm nào trong Controller

const express = require("express");
const productController = require("../controllers/product.controller");
const reviewController = require("../controllers/review.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

// GET /api/products → Lấy danh sách tất cả sản phẩm
router.get("/", productController.getAll);

// GET /api/products/info/:id → Lấy thông tin sản phẩm theo ID
// Trang product_info.html đọc `id` từ query string rồi gọi endpoint này.
router.get("/info/:id", productController.getProductID);

// Product reviews. "/mine" is the caller's own review; only customers (role user) may write.
router.get("/:id/reviews", reviewController.list);
router.get("/:id/reviews/mine", requireRole("user", "admin"), reviewController.getMine);
router.post("/:id/reviews", requireRole("user"), requireCsrf, reviewController.create);
router.put("/:id/reviews/mine", requireRole("user"), requireCsrf, reviewController.updateMine);
router.delete("/:id/reviews/mine", requireRole("user"), requireCsrf, reviewController.removeMine);

module.exports = router;
