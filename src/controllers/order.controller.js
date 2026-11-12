// ===== ORDER CONTROLLER =====
// Tiếp nhận HTTP request liên quan đến tra cứu và quản lý đơn hàng

const orderService = require("../services/order.service");
const { tokenFromRequest } = require("../services/guest-access");

const SAFE_ERROR_MESSAGES = Object.freeze({
    AUTH_REQUIRED: "Authentication is required",
    ORDER_NOT_FOUND: "Không tìm thấy đơn hàng",
    INVALID_ORDER_STATUS: "Trạng thái đơn hàng không hợp lệ",
    INVALID_ORDER_TRANSITION: "Không thể chuyển trạng thái đơn hàng",
    INVALID_PAYMENT_STATUS: "Trạng thái thanh toán không hợp lệ",
    INVALID_PAGINATION: "Tham số phân trang không hợp lệ",
    INVALID_FILTER: "Bộ lọc không hợp lệ"
});

const sendOrderError = (res, error) => {
    const code = error?.code || "ORDER_REQUEST_FAILED";
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(status).json({
        success: false,
        error: {
            code,
            message: SAFE_ERROR_MESSAGES[code] || "Order request failed"
        }
    });
};

/** [GET] /api/orders/mine — Đơn hàng của chính khách hàng */
const getMyOrders = async (req, res) => {
    try {
        const { data, meta } = await orderService.listMyOrders(req.user, req.query);
        return res.status(200).json({ success: true, data, meta });
    } catch (error) {
        return sendOrderError(res, error);
    }
};

// The route lets a request carrying a guest token through without a role check, so the actor is re-checked here:
// an administrator who must still change the password does not get admin reach through that door.
const orderActor = (user) => {
    if (!user || !["user", "admin"].includes(user.role)) return undefined;
    if (user.role === "admin" && user.forcePasswordChange) return undefined;
    return user;
};

/** [GET] /api/orders/:id — Chi tiết đơn hàng */
const getOrderDetail = async (req, res) => {
    try {
        const order = await orderService.getOrderById(req.params.id, orderActor(req.user), { guestToken: tokenFromRequest(req) });
        return res.status(200).json({ success: true, data: order });
    } catch (error) {
        return sendOrderError(res, error);
    }
};

/** [GET] /api/orders — Danh sách tất cả đơn hàng */
const getAllOrders = async (req, res) => {
    try {
        const { data, meta } = await orderService.getAllOrders(req.query);
        return res.status(200).json({ success: true, data, meta });
    } catch (error) {
        return sendOrderError(res, error);
    }
};

/** [PATCH] /api/orders/:id/status — Cập nhật orderStatus (dành cho Admin) */
const updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!status) {
            return res.status(400).json({
                success: false,
                error: { code: "INVALID_ORDER_STATUS", message: "Trạng thái đơn hàng không hợp lệ" }
            });
        }
        const order = await orderService.updateOrderStatus(req.params.id, status);
        return res.status(200).json({ success: true, message: "Cập nhật trạng thái thành công.", data: order });
    } catch (error) {
        return sendOrderError(res, error);
    }
};

/** [PATCH] /api/orders/:id/payment-status — Cập nhật paymentStatus (dành cho Admin) */
const updatePaymentStatus = async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!status) {
            return res.status(400).json({
                success: false,
                error: { code: "INVALID_PAYMENT_STATUS", message: "Trạng thái thanh toán không hợp lệ" }
            });
        }
        const order = await orderService.updatePaymentStatus(req.params.id, status);
        return res.status(200).json({ success: true, message: "Cập nhật trạng thái thanh toán thành công.", data: order });
    } catch (error) {
        return sendOrderError(res, error);
    }
};

module.exports = { getOrderDetail, getMyOrders, getAllOrders, updateOrderStatus, updatePaymentStatus };
