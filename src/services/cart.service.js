// ===== CART SERVICE =====
// Account-cart business rules plus the pre-existing Guest validation/shipping flow.
// Cart mutations do not reserve stock; checkout revalidates stock independently.

const crypto = require("crypto");
const productRepository = require("../repositories/product.repository");
const cartRepository = require("../repositories/cart.repository");

const SHIPPING_FEE_DEFAULT = 100000;
const calculateShipping = (subtotal = 0) => SHIPPING_FEE_DEFAULT;

const validateCartItems = async (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Giỏ hàng trống, vui lòng thêm sản phẩm trước khi tiếp tục.");
    }
    let subtotal = 0;
    let hasUnavailable = false;
    const validatedItems = await Promise.all(items.map(async ({ productId, quantity }) => {
        const qty = parseInt(quantity, 10);
        const product = await productRepository.getProductByID(productId);
        if (!product) {
            hasUnavailable = true;
            return { productId, name: "Sản phẩm không tồn tại", image: null, price: 0, quantity: qty || 0, stock: 0, available: false, unavailableReason: "not_found", lineTotal: 0 };
        }
        if (product.isDeleted === true) {
            hasUnavailable = true;
            return { productId: product.id, name: product.name, image: product.image, description: product.description, price: product.price, quantity: qty, stock: product.stock, available: false, unavailableReason: `Sản phẩm '${product.name}' đã ngừng kinh doanh, vui lòng xóa khỏi giỏ hàng.`, lineTotal: 0 };
        }
        if (product.stock <= 0) {
            hasUnavailable = true;
            return { productId: product.id, name: product.name, image: product.image, price: product.price, quantity: qty, stock: 0, available: false, unavailableReason: "out_of_stock", lineTotal: 0 };
        }
        const effectiveQty = Math.min(qty, product.stock);
        const lineTotal = product.price * effectiveQty;
        subtotal += lineTotal;
        return { productId: product.id, name: product.name, image: product.image, description: product.description, price: product.price, quantity: effectiveQty, requestedQuantity: qty, stock: product.stock, available: true, quantityAdjusted: effectiveQty !== qty, lineTotal };
    }));
    const shippingFee = calculateShipping(subtotal);
    return { validatedItems, subtotal, shippingFee, total: subtotal + shippingFee, hasUnavailable };
};

class CartDomainError extends Error {
    constructor(code, message, statusCode = 400, fields) {
        super(message);
        this.name = "CartDomainError";
        this.code = code;
        this.statusCode = statusCode;
        if (fields) this.fields = fields;
    }
}

const normalizeUserId = (userId) => {
    if (typeof userId !== "string" || userId.trim() === "") throw new CartDomainError("AUTH_REQUIRED", "Yêu cầu đăng nhập", 401);
    return userId;
};
const normalizeProductId = (productId) => {
    const value = cartRepository.toProductId(productId);
    if (value === null) throw new CartDomainError("VALIDATION_FAILED", "productId không hợp lệ", 400, { productId: "invalid" });
    return value;
};
const normalizeQuantity = (quantity) => {
    const value = cartRepository.toQuantity(quantity);
    if (value === null) throw new CartDomainError("VALIDATION_FAILED", "quantity phải là số nguyên dương", 400, { quantity: "invalid" });
    return value;
};
const normalizeOperationId = (operationId) => {
    if (typeof operationId !== "string" || operationId.trim() === "" || operationId.length > 64) throw new CartDomainError("VALIDATION_FAILED", "operationId không hợp lệ", 400, { operationId: "invalid" });
    return operationId;
};
const normalizeMergeItems = (items) => {
    if (!Array.isArray(items)) throw new CartDomainError("VALIDATION_FAILED", "items phải là một mảng", 400, { items: "invalid" });
    const quantities = new Map();
    for (const item of items) {
        if (!item || typeof item !== "object") throw new CartDomainError("VALIDATION_FAILED", "item không hợp lệ", 400, { items: "invalid" });
        const productId = normalizeProductId(item.productId);
        const quantity = normalizeQuantity(item.quantity);
        const total = (quantities.get(productId) || 0) + quantity;
        if (!Number.isSafeInteger(total)) throw new CartDomainError("VALIDATION_FAILED", "quantity vượt giới hạn", 400, { quantity: "invalid" });
        quantities.set(productId, total);
    }
    return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId - b.productId);
};
const requestHash = (items) => crypto.createHash("sha256").update(JSON.stringify({ items })).digest("hex");

const getAccountCart = async (userId) => {
    normalizeUserId(userId);
    const cart = await cartRepository.getCart(userId);
    return { items: cart.items };
};
const setAccountCartQuantity = async (userId, productId, quantity) => {
    normalizeUserId(userId);
    const normalizedProductId = normalizeProductId(productId);
    const normalizedQuantity = normalizeQuantity(quantity);
    const result = await cartRepository.setQuantity(userId, normalizedProductId, normalizedQuantity);
    if (result.kind === "not_found") throw new CartDomainError("PRODUCT_NOT_FOUND", "Sản phẩm không tồn tại", 404);
    if (result.kind === "unavailable") throw new CartDomainError("CART_ITEM_UNAVAILABLE", "Sản phẩm hiện không khả dụng", 409, { productId: normalizedProductId });
    return { items: result.cart.items, adjustments: result.adjustment ? [result.adjustment] : [] };
};
const removeAccountCartItem = async (userId, productId) => {
    normalizeUserId(userId);
    return { items: (await cartRepository.removeItem(userId, normalizeProductId(productId))).items };
};
const mergeGuestCart = async (userId, operationId, items) => {
    normalizeUserId(userId);
    const normalizedItems = normalizeMergeItems(items);
    return cartRepository.mergeGuestCart(userId, normalizeOperationId(operationId), requestHash(normalizedItems), normalizedItems);
};

module.exports = { validateCartItems, calculateShipping, SHIPPING_FEE_DEFAULT, getAccountCart, setAccountCartQuantity, removeAccountCartItem, mergeGuestCart, CartDomainError };
