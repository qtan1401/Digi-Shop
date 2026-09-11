// ===== CART ROUTES =====
// Định nghĩa các endpoint cho tính năng giỏ hàng (server-side validate & tính ship)
// Cart state thực sự lưu ở localStorage phía client

const express = require("express");
const cartController = require("../controllers/cart.controller");

const router = express.Router();

// [POST] /api/cart/validate → Kiểm tra stock thực tế của từng item trong giỏ
router.post("/validate", cartController.validateCart);

// [POST] /api/cart/shipping → Tính phí vận chuyển theo subtotal
router.post("/shipping", cartController.getShippingFee);

module.exports = router;
