// ===== CHECKOUT ROUTES =====
// Lưu ý thứ tự route: /batch phải đứng TRƯỚC /:id để tránh bị match nhầm

const express = require("express");
const checkoutController = require("../controllers/checkout.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

// [POST] /api/checkout/check-stock/:id → Kiểm tra tồn kho
router.post("/checkout/check-stock/:id", checkoutController.checkProductinStock);

// [POST] /api/checkout/batch → Thanh toán giỏ hàng (nhiều sản phẩm) — phải trước /:id
router.post("/checkout/batch", requireRole("user"), requireCsrf, checkoutController.cartCheckout);

// [POST] /api/checkout/:id → Mua ngay 1 sản phẩm (ID trên URL)
router.post("/checkout/:id", requireRole("user"), requireCsrf, checkoutController.processCheckout);

// [POST] /api/checkout → Mua ngay 1 sản phẩm (ID trong body)
router.post("/checkout", requireRole("user"), requireCsrf, checkoutController.processCheckout);

module.exports = router;
