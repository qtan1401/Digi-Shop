// ===== CART CONTROLLER =====
// Guest validation/shipping remain backwards compatible; account operations use session identity.

const cartService = require("../services/cart.service");

const validateCart = async (req, res) => {
    try {
        const { items } = req.body;
        const result = await cartService.validateCartItems(items);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

const getShippingFee = (req, res) => {
    try {
        const subtotal = Number(req.body.subtotal) || 0;
        if (isNaN(subtotal) || subtotal < 0) {
            return res.status(400).json({ success: false, message: "subtotal không hợp lệ" });
        }
        const shippingFee = cartService.calculateShipping(subtotal);
        res.status(200).json({ success: true, data: { subtotal, shippingFee } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const sendAccountError = (res, error) => {
    const knownCodes = new Set([
        "AUTH_REQUIRED",
        "VALIDATION_FAILED",
        "VARIANT_NOT_FOUND",
        "CART_ITEM_UNAVAILABLE",
        "IDEMPOTENCY_CONFLICT"
    ]);
    const knownError = error && knownCodes.has(error.code);
    const status = knownError && Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const body = {
        success: false,
        error: {
            code: knownError ? error.code : "CART_REQUEST_FAILED",
            message: knownError ? error.message : "Không thể cập nhật giỏ hàng"
        }
    };
    if (knownError && error.fields) body.error.fields = error.fields;
    return res.status(status).json(body);
};

const accountUserId = (req) => req.user && req.user.id;

const getAccountCart = async (req, res) => {
    try {
        return res.json({ success: true, data: await cartService.getAccountCart(accountUserId(req)) });
    } catch (error) {
        return sendAccountError(res, error);
    }
};

const setAccountCartQuantity = async (req, res) => {
    try {
        const result = await cartService.setAccountCartQuantity(accountUserId(req), req.params.variantId, req.body && req.body.quantity);
        return res.json({ success: true, data: result });
    } catch (error) {
        return sendAccountError(res, error);
    }
};

const removeAccountCartItem = async (req, res) => {
    try {
        const result = await cartService.removeAccountCartItem(accountUserId(req), req.params.variantId);
        return res.json({ success: true, data: result });
    } catch (error) {
        return sendAccountError(res, error);
    }
};

const mergeGuestCart = async (req, res) => {
    try {
        const result = await cartService.mergeGuestCart(accountUserId(req), req.body && req.body.operationId, req.body && req.body.items);
        return res.json({ success: true, data: result });
    } catch (error) {
        return sendAccountError(res, error);
    }
};

module.exports = { validateCart, getShippingFee, getAccountCart, setAccountCartQuantity, removeAccountCartItem, mergeGuestCart };
