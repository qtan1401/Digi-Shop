// ===== ORDER ROUTES =====
// Public: tra cứu đơn theo ID
// Admin: GET all, PATCH status/payment-status (requireRole("admin"))

const express = require("express");
const orderController = require("../controllers/order.controller");
const { requireRole } = require("../middlewares/auth");

const router = express.Router();

// [GET] /api/orders → Toàn bộ đơn hàng (Admin only)
router.get("/", requireRole("admin"), orderController.getAllOrders);

// [GET] /api/orders/:id → Chi tiết đơn hàng (public — user tra mã)
router.get("/:id", orderController.getOrderDetail);

// [PATCH] /api/orders/:id/status → Cập nhật orderStatus (Admin only)
router.patch("/:id/status", requireRole("admin"), orderController.updateOrderStatus);

// [PATCH] /api/orders/:id/payment-status → Cập nhật paymentStatus (Admin only)
router.patch("/:id/payment-status", requireRole("admin"), orderController.updatePaymentStatus);

module.exports = router;

