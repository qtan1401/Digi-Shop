// ===== PRODUCT ROUTES =====
// Đây là tầng Routes - định nghĩa các endpoint (URL) và kết nối với Controller
// Routes quyết định: Khi client gọi URL nào → chạy hàm nào trong Controller

const express = require("express");
const productController = require("../controllers/product.controller");
const reviewController = require("../controllers/review.controller");
const { requireRole, requireCsrf, rateLimitAuth } = require("../middlewares/auth");

const router = express.Router();

// GET /api/products → Lấy danh sách tất cả sản phẩm
router.get("/", productController.getAll);

// GET /api/products/info/:id → Lấy thông tin sản phẩm theo ID
// Trang product_info.html đọc `id` từ query string rồi gọi endpoint này.
router.get("/info/:id", productController.getProductID);

// Writing a review: signed-in callers must be customers (role user) and keep the Verified reviewer rules.
// Anonymous callers may only post a Guest comment (guestName, no rating); the service enforces that, and
// only they are rate limited (guestReview), so a signed-in customer is never throttled by a shared IP.
const guestReviewLimit = rateLimitAuth("guestReview");
const limitGuests = (req, res, next) => (req.user ? next() : guestReviewLimit(req, res, next));
const requireCustomerWhenSignedIn = (req, res, next) => (req.user ? requireRole("user")(req, res, next) : next());

// Product reviews. "/mine" is the caller's own review; only customers (role user) may edit or delete it.
router.get("/:id/reviews", reviewController.list);
router.get("/:id/reviews/mine", requireRole("user", "admin"), reviewController.getMine);
router.post("/:id/reviews", limitGuests, requireCustomerWhenSignedIn, requireCsrf, reviewController.create);
router.put("/:id/reviews/mine", requireRole("user"), requireCsrf, reviewController.updateMine);
router.delete("/:id/reviews/mine", requireRole("user"), requireCsrf, reviewController.removeMine);

module.exports = router;
