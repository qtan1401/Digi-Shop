// ===== CART CONTROLLER =====
// Tiếp nhận request từ frontend liên quan đến giỏ hàng
// Cart controller KHÔNG thực hiện trừ kho hay tạo đơn — chỉ đọc & tính toán

const cartService = require("../services/cart.service");

/**
 * [POST] /api/cart/validate
 * Kiểm tra tồn kho thực tế của tất cả items trong giỏ hàng
 * Body: { items: [{ productId, quantity }] }
 */
const validateCart = (req, res) => {
    try {
        const { items } = req.body;
        const result = cartService.validateCartItems(items);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * [POST] /api/cart/shipping
 * Lấy phí vận chuyển mặc định (100.000 VNĐ)
 * Body: { subtotal: number }
 */
const getShippingFee = (req, res) => {
    try {
        const subtotal = Number(req.body.subtotal) || 0;
        if (isNaN(subtotal) || subtotal < 0) {
            return res.status(400).json({ success: false, message: "subtotal không hợp lệ" });
        }
        const shippingFee = cartService.calculateShipping(subtotal);
        res.status(200).json({
            success: true,
            data: {
                subtotal,
                shippingFee
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { validateCart, getShippingFee };
