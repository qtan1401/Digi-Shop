// ===== ORDER SERVICE =====
// Business logic cho tra cứu và quản lý đơn hàng
// Cập nhật trạng thái đơn / trạng thái thanh toán (dự phòng Admin phase sau)

const orderRepository = require("../repositories/order.repository");

const VALID_ORDER_STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
const VALID_PAYMENT_STATUSES = ["UNPAID", "PAID", "REFUNDED"];

/**
 * Lấy chi tiết đơn hàng theo mã
 */
const getOrderById = async (orderId) => {
    if (!orderId) throw new Error("Vui lòng cung cấp mã đơn hàng.");
    const order = orderRepository.getOrderById(orderId);
    if (!order) throw new Error("Không tìm thấy đơn hàng: " + orderId);
    return order;
};

/**
 * Lấy toàn bộ danh sách đơn hàng
 */
const getAllOrders = async () => orderRepository.getAllOrders();

/**
 * Cập nhật trạng thái đơn hàng (orderStatus)
 * @param {string} orderId
 * @param {string} status
 */
const updateOrderStatus = async (orderId, status) => {
    if (!VALID_ORDER_STATUSES.includes(status)) {
        throw new Error(`Trạng thái đơn hàng không hợp lệ. Hợp lệ: ${VALID_ORDER_STATUSES.join(", ")}`);
    }
    const order = orderRepository.updateOrderStatus(orderId, status);
    if (!order) throw new Error("Không tìm thấy đơn hàng: " + orderId);
    return order;
};

/**
 * Cập nhật trạng thái thanh toán (paymentStatus)
 * @param {string} orderId
 * @param {string} status
 */
const updatePaymentStatus = async (orderId, status) => {
    if (!VALID_PAYMENT_STATUSES.includes(status)) {
        throw new Error(`Trạng thái thanh toán không hợp lệ. Hợp lệ: ${VALID_PAYMENT_STATUSES.join(", ")}`);
    }
    const order = orderRepository.updatePaymentStatus(orderId, status);
    if (!order) throw new Error("Không tìm thấy đơn hàng: " + orderId);
    return order;
};

module.exports = { getOrderById, getAllOrders, updateOrderStatus, updatePaymentStatus };
