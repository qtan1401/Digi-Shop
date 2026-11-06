// ===== CHECKOUT CONTROLLER =====
// Tiếp nhận HTTP request thanh toán; gọi checkout service; map lỗi → HTTP status

const checkoutService = require("../services/checkout.service");

// Map error message → HTTP status code
const errorToStatus = (msg) => {
    if (msg.includes("không tồn tại") || msg.includes("không tìm thấy") || msg.includes("Không tìm thấy")) return 404;
    if (msg.includes("hết hàng") || msg.includes("không đủ") || msg.includes("không hợp lệ") || msg.includes("trống") || msg.includes("Không thể") || msg.includes("ngừng kinh doanh")) return 400;
    return 500;
};

// Voucher failures carry a code and HTTP status (409 VOUCHER_UNAVAILABLE, 422 VOUCHER_*);
// everything else keeps the legacy message-based mapping. `message` stays for existing clients.
const VOUCHER_CODE = /^VOUCHER_/;
const sendCheckoutError = (res, error) => {
    if (VOUCHER_CODE.test(error.code || "") && Number.isInteger(error.statusCode)) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
            error: { code: error.code, message: error.message }
        });
    }
    return res.status(errorToStatus(error.message)).json({ success: false, message: error.message });
};

/**
 * [POST] /api/checkout/check-stock/:id
 * Kiểm tra tồn kho (không trừ kho)
 */
const checkVariantInStock = async (req, res) => {
    try {
        const variantId = req.params.id || req.body.variantId;
        const quantity = req.body.quantity || req.query.quantity || 1;
        const result = await checkoutService.checkVariant(variantId, quantity);
        res.status(200).json({ success: true, message: "Phiên bản sản phẩm còn hàng trong kho", inStock: true, data: result });
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
        const variantId = req.params.id || req.body.variantId;
        const { quantity = 1, customerName, customerPhone, customerAddress, paymentMethod, note, voucherCodes } = req.body;

        const result = await checkoutService.processCheckout(req.user.id, {
            variantId, quantity, customerName, customerPhone, customerAddress, paymentMethod, note, voucherCodes
        }, req);

        res.status(201).json({
            success: true,
            message: "Đặt hàng thành công!",
            data: result.order,
            remainingStock: result.remainingStock
        });
    } catch (error) {
        sendCheckoutError(res, error);
    }
};

/**
 * Thanh toán toàn bộ giỏ hàng (nhiều sản phẩm)
 * Body: { items: [{variantId, quantity}], customerName, customerPhone, customerAddress, paymentMethod, note }
 */

const cartCheckout = async (req, res) => {
    try {
        const { items, customerName, customerPhone, customerAddress, paymentMethod, note, voucherCodes } = req.body;
        const result = await checkoutService.processCartCheckout(req.user.id, {
            items, customerName, customerPhone, customerAddress, paymentMethod, note, voucherCodes
        }, req);

        res.status(201).json({
            success: true,
            message: "Đặt hàng thành công!",
            data: result.order
        });
    } catch (error) {
        sendCheckoutError(res, error);
    }
};

module.exports = { checkVariantInStock, processCheckout, cartCheckout };
