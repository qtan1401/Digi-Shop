// ===== ORDER CONTROLLER =====
// Tiếp nhận HTTP request liên quan đến tra cứu và quản lý đơn hàng

const orderService = require("../services/order.service");

/** [GET] /api/orders/:id — Chi tiết đơn hàng */
const getOrderDetail = async (req, res) => {
    try {
        const order = await orderService.getOrderById(req.params.id);
        res.status(200).json({ success: true, data: order });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};

/** [GET] /api/orders — Danh sách tất cả đơn hàng */
const getAllOrders = async (req, res) => {
    try {
        const orders = await orderService.getAllOrders();
        res.status(200).json({ success: true, data: orders, total: orders.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/** [PATCH] /api/orders/:id/status — Cập nhật orderStatus (dành cho Admin) */
const updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, message: "Vui lòng cung cấp trạng thái mới." });
        }
        const order = await orderService.updateOrderStatus(req.params.id, status);
        res.status(200).json({ success: true, message: "Cập nhật trạng thái thành công.", data: order });
    } catch (error) {
        const code = error.message.includes("không hợp lệ") ? 400 : 404;
        res.status(code).json({ success: false, message: error.message });
    }
};

/** [PATCH] /api/orders/:id/payment-status — Cập nhật paymentStatus (dành cho Admin) */
const updatePaymentStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, message: "Vui lòng cung cấp trạng thái thanh toán." });
        }
        const order = await orderService.updatePaymentStatus(req.params.id, status);
        res.status(200).json({ success: true, message: "Cập nhật trạng thái thanh toán thành công.", data: order });
    } catch (error) {
        const code = error.message.includes("không hợp lệ") ? 400 : 404;
        res.status(code).json({ success: false, message: error.message });
    }
};

module.exports = { getOrderDetail, getAllOrders, updateOrderStatus, updatePaymentStatus };
