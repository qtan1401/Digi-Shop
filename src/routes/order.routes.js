// ===== ORDER ROUTES =====
// Public: tra cứu đơn theo ID
// Admin-ready: GET all, PATCH status (middleware auth sẽ được gắn vào ở phase sau)

const express = require("express");
const orderController = require("../controllers/order.controller");

const router = express.Router();

// [GET] /api/orders → Toàn bộ đơn hàng (TODO: gắn requireRole("admin") sau)
router.get("/", orderController.getAllOrders);

// [GET] /api/orders/:id → Chi tiết đơn hàng (public — user tra mã)
router.get("/:id", orderController.getOrderDetail);

// [PATCH] /api/orders/:id/status → Cập nhật orderStatus (TODO: requireRole("admin"))
router.patch("/:id/status", orderController.updateOrderStatus);

// [PATCH] /api/orders/:id/payment-status → Cập nhật paymentStatus (TODO: requireRole("admin"))
router.patch("/:id/payment-status", orderController.updatePaymentStatus);

module.exports = router;
