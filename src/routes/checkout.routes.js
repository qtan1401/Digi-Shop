// ===== CHECKOUT ROUTES =====
// Đây là tầng Routes - định nghĩa các endpoint (URL) cho quy trình thanh toán & đơn hàng
// Routes quyết định: Khi client gửi request đến URL nào → gọi hàm tương ứng trong Checkout Controller

const express = require("express");
const checkoutController = require("../controllers/checkout.controller");

const router = express.Router();

// [POST] /api/checkout/check-stock/:id → Kiểm tra xem sản phẩm có đủ hàng trong kho không
router.post("/checkout/check-stock/:id", checkoutController.checkProductinStock);

// [POST] /api/checkout/:id → Thực hiện thanh toán cho sản phẩm theo ID trên URL
router.post("/checkout/:id", checkoutController.processCheckout);

// [POST] /api/checkout → Thực hiện thanh toán khi ID sản phẩm nằm trong Request Body
router.post("/checkout", checkoutController.processCheckout);

// [GET] /api/checkout/orders → Lấy danh sách tất cả các đơn hàng đã đặt
router.get("/checkout/orders", checkoutController.getAllOrders);

// [GET] /api/checkout/orders/:id → Xem chi tiết một đơn hàng theo mã đơn
router.get("/checkout/orders/:id", checkoutController.getOrderDetail);

module.exports = router;
