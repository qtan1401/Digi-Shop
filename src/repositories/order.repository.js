// ===== ORDER REPOSITORY =====
// Tầng duy nhất được phép đọc/ghi trực tiếp vào orders[]
// Không chứa business logic

const orders = require("../models/order.model");

/**
 * Tạo đơn hàng mới, lưu vào store
 * @param {Object} orderData
 * @returns {Object} Đơn hàng đã lưu
 */
const createOrder = (orderData) => {
    orders.push(orderData);
    return orderData;
};

/**
 * Lấy tất cả đơn hàng (mới nhất trước)
 * @returns {Array}
 */
const getAllOrders = () => [...orders].reverse();

/**
 * Tìm đơn hàng theo ID
 * @param {string} id
 * @returns {Object|undefined}
 */
const getOrderById = (id) => orders.find((o) => o.id === id || o.id == id);

/**
 * Cập nhật orderStatus của đơn hàng
 * @param {string} id
 * @param {string} status  -- "PENDING"|"PROCESSING"|"SHIPPED"|"DELIVERED"|"CANCELLED"
 * @returns {Object|null}
 */
const updateOrderStatus = (id, status) => {
    const order = getOrderById(id);
    if (!order) return null;
    order.orderStatus = status;
    order.updatedAt = new Date().toISOString();
    return order;
};

/**
 * Cập nhật paymentStatus của đơn hàng
 * @param {string} id
 * @param {string} status  -- "UNPAID"|"PAID"|"REFUNDED"
 * @returns {Object|null}
 */
const updatePaymentStatus = (id, status) => {
    const order = getOrderById(id);
    if (!order) return null;
    order.paymentStatus = status;
    order.updatedAt = new Date().toISOString();
    return order;
};

module.exports = {
    createOrder,
    getAllOrders,
    getOrderById,
    updateOrderStatus,
    updatePaymentStatus
};
