// ===== ORDER ROUTES =====
// User: own order detail; Admin: all orders and order management.

const express = require("express");
const orderController = require("../controllers/order.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

// [GET] /api/orders → Toàn bộ đơn hàng (Admin only)
router.get("/", requireRole("admin"), orderController.getAllOrders);

// [GET] /api/orders/:id → Chi tiết đơn hàng (chủ đơn hoặc Admin)
router.get("/:id", requireRole("user", "admin"), orderController.getOrderDetail);

// [PATCH] /api/orders/:id/status → Cập nhật orderStatus (Admin only)
router.patch("/:id/status", requireRole("admin"), requireCsrf, orderController.updateOrderStatus);

// [PATCH] /api/orders/:id/payment-status → Cập nhật paymentStatus (Admin only)
router.patch("/:id/payment-status", requireRole("admin"), requireCsrf, orderController.updatePaymentStatus);

module.exports = router;

