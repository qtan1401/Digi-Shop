// ===== ORDER REPOSITORY =====
// Đây là tầng Repository - chịu trách nhiệm lưu và truy xuất dữ liệu đơn hàng
// Repository chỉ thao tác trực tiếp với dữ liệu (Model), không chứa logic nghiệp vụ

const orders = require("../models/order.model");

/**
 * Tạo một đơn hàng mới và lưu vào danh sách
 * @param {Object} orderData - Dữ liệu đơn hàng cần tạo
 * @returns {Object} Đơn hàng vừa tạo
 */
const createOrder = (orderData) => {
    orders.push(orderData);
    return orderData;
};

/**
 * Lấy danh sách tất cả đơn hàng
 * @returns {Array} Mảng các đơn hàng
 */
const getAllOrders = () => {
    return orders;
};

/**
 * Tìm đơn hàng theo mã đơn hàng (ID)
 * @param {string|number} id - Mã đơn hàng
 * @returns {Object|undefined} Đơn hàng tìm được hoặc undefined
 */
const getOrderById = (id) => {
    return orders.find((order) => order.id === id || order.id == id);
};

module.exports = {
    createOrder,
    getAllOrders,
    getOrderById
};
