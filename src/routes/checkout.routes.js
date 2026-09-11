// ===== CHECKOUT ROUTES =====
// Lưu ý thứ tự route: /batch phải đứng TRƯỚC /:id để tránh bị match nhầm

const express = require("express");
const checkoutController = require("../controllers/checkout.controller");

const router = express.Router();

// [POST] /api/checkout/check-stock/:id → Kiểm tra tồn kho
router.post("/checkout/check-stock/:id", checkoutController.checkProductinStock);

// [POST] /api/checkout/batch → Thanh toán giỏ hàng (nhiều sản phẩm) — phải trước /:id
router.post("/checkout/batch", checkoutController.cartCheckout);

// [POST] /api/checkout/:id → Mua ngay 1 sản phẩm (ID trên URL)
router.post("/checkout/:id", checkoutController.processCheckout);

// [POST] /api/checkout → Mua ngay 1 sản phẩm (ID trong body)
router.post("/checkout", checkoutController.processCheckout);

module.exports = router;
