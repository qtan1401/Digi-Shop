// ===== CHECKOUT CONTROLLER =====
// Tiếp nhận HTTP request thanh toán; gọi checkout service; map lỗi → HTTP status

const checkoutService = require("../services/checkout.service");

// Map error message → HTTP status code
const errorToStatus = (msg) => {
    if (msg.includes("không tồn tại") || msg.includes("không tìm thấy") || msg.includes("Không tìm thấy")) return 404;
    if (msg.includes("hết hàng") || msg.includes("không đủ") || msg.includes("không hợp lệ") || msg.includes("trống") || msg.includes("Không thể")) return 400;
    return 500;
};

/**
 * [POST] /api/checkout/check-stock/:id
 * Kiểm tra tồn kho (không trừ kho)
 */
const checkProductinStock = async (req, res) => {
    try {
        const productId = req.params.id || req.body.productId;
        const quantity = req.body.quantity || req.query.quantity || 1;
        const result = await checkoutService.checkProduct(productId, quantity);
        res.status(200).json({ success: true, message: "Sản phẩm còn hàng trong kho", inStock: true, data: result });
    } catch (error) {
        res.status(errorToStatus(error.message)).json({ success: false, message: error.message });
    }
};

/**
 * [POST] /api/checkout/:id  hoặc  [POST] /api/checkout
 * Mua ngay 1 sản phẩm
 */
const processCheckout = async (req, res) => {
    try {
        const productId = req.params.id || req.body.productId;
        const { quantity = 1, customerName, customerPhone, customerAddress, paymentMethod, note } = req.body;

        const result = await checkoutService.processCheckout({
            productId, quantity, customerName, customerPhone, customerAddress, paymentMethod, note
        });

        res.status(201).json({
            success: true,
            message: "Đặt hàng thành công!",
            data: result.order,
            remainingStock: result.remainingStock
        });
    } catch (error) {
        res.status(errorToStatus(error.message)).json({ success: false, message: error.message });
    }
};

/**
 * [POST] /api/checkout/batch
 * Thanh toán toàn bộ giỏ hàng (nhiều sản phẩm)
 * Body: { items: [{productId, quantity}], customerName, customerPhone, customerAddress, paymentMethod, note }
 */
const cartCheckout = async (req, res) => {
    try {
        const { items, customerName, customerPhone, customerAddress, paymentMethod, note } = req.body;
        const result = await checkoutService.processCartCheckout({
            items, customerName, customerPhone, customerAddress, paymentMethod, note
        });

        res.status(201).json({
            success: true,
            message: "Đặt hàng thành công!",
            data: result.order
        });
    } catch (error) {
        res.status(errorToStatus(error.message)).json({ success: false, message: error.message });
    }
};

module.exports = { checkProductinStock, processCheckout, cartCheckout };
