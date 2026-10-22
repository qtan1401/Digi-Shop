// ===== CART SERVICE =====
// Cart business rules; inventory remains unreserved until checkout.

const crypto = require("crypto");
const productRepository = require("../repositories/product.repository");
const cartRepository = require("../repositories/cart.repository");

const SHIPPING_FEE_DEFAULT = 100000;
const calculateShipping = () => SHIPPING_FEE_DEFAULT;

const variantLabel = (optionValues = {}) => Object.entries(optionValues)
    .map(([name, value]) => `${name}: ${value}`)
    .join(" · ");

const validateCartItems = async (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Giỏ hàng trống, vui lòng thêm sản phẩm trước khi tiếp tục.");
    }
    let subtotal = 0;
    let hasUnavailable = false;
    const validatedItems = await Promise.all(items.map(async (input) => {
        const { variantId, productId, quantity } = input || {};
        const qty = parseInt(quantity, 10);
        const legacyProductId = variantId === undefined || variantId === null
            ? Number(productId)
            : null;
        const variant = variantId !== undefined && variantId !== null
            ? await productRepository.getVariantByID(variantId)
            : Number.isInteger(legacyProductId) && legacyProductId > 0
                ? await productRepository.getLegacyDefaultVariantByProductID(legacyProductId)
                : undefined;
        if (!variant) {
            hasUnavailable = true;
            return {
                ...(Number.isInteger(legacyProductId) && legacyProductId > 0 ? { productId: legacyProductId } : {}),
                name: input?.name || "Phiên bản không tồn tại",
                image: input?.image || null,
                price: Number(input?.price) || 0,
                quantity: qty || 0,
                stock: 0,
                available: false,
                unavailableReason: "legacy_variant_unavailable",
                lineTotal: 0
            };
        }
        const product = variant.product;
        const item = {
            variantId: variant.id,
            productId: product.id,
            name: product.name,
            variantLabel: variantLabel(variant.optionValues),
            sku: variant.sku,
            optionValues: variant.optionValues,
            image: product.image,
            description: product.description,
            price: variant.price,
            stock: variant.stock
        };
        if (product.isDeleted === true || variant.isActive !== true) {
            hasUnavailable = true;
            return { ...item, quantity: qty, available: false, unavailableReason: product.isDeleted ? "soft_deleted" : "variant_unavailable", lineTotal: 0 };
        }
        if (variant.stock <= 0) {
            hasUnavailable = true;
            return { ...item, quantity: qty, stock: 0, available: false, unavailableReason: "out_of_stock", lineTotal: 0 };
        }
        const effectiveQty = Math.min(qty, variant.stock);
        const lineTotal = variant.price * effectiveQty;
        subtotal += lineTotal;
        return { ...item, quantity: effectiveQty, requestedQuantity: qty, available: true, quantityAdjusted: effectiveQty !== qty, lineTotal };
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
const normalizeVariantId = (variantId) => {
    const value = cartRepository.toVariantId(variantId);
    if (value === null) throw new CartDomainError("VALIDATION_FAILED", "variantId không hợp lệ", 400, { variantId: "invalid" });
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
        const variantId = normalizeVariantId(item.variantId);
        const quantity = normalizeQuantity(item.quantity);
        const total = (quantities.get(variantId) || 0) + quantity;
        if (!Number.isSafeInteger(total)) throw new CartDomainError("VALIDATION_FAILED", "quantity vượt giới hạn", 400, { quantity: "invalid" });
        quantities.set(variantId, total);
    }
    return [...quantities.entries()]
        .map(([variantId, quantity]) => ({ variantId, quantity }))
        .sort((left, right) => left.variantId - right.variantId);
};
const requestHash = (items) => crypto.createHash("sha256").update(JSON.stringify({ items })).digest("hex");

const getAccountCart = async (userId) => {
    normalizeUserId(userId);
    const cart = await cartRepository.getCart(userId);
    return { items: cart.items };
};
const setAccountCartQuantity = async (userId, variantId, quantity) => {
    normalizeUserId(userId);
    const normalizedVariantId = normalizeVariantId(variantId);
    const normalizedQuantity = normalizeQuantity(quantity);
    const result = await cartRepository.setQuantity(userId, normalizedVariantId, normalizedQuantity);
    if (result.kind === "not_found") throw new CartDomainError("VARIANT_NOT_FOUND", "Phiên bản sản phẩm không tồn tại", 404);
    if (result.kind === "unavailable") throw new CartDomainError("CART_ITEM_UNAVAILABLE", "Phiên bản sản phẩm hiện không khả dụng", 409, { variantId: normalizedVariantId });
    return { items: result.cart.items, adjustments: result.adjustment ? [result.adjustment] : [] };
};
const removeAccountCartItem = async (userId, variantId) => {
    normalizeUserId(userId);
    return { items: (await cartRepository.removeItem(userId, normalizeVariantId(variantId))).items };
};
const mergeGuestCart = async (userId, operationId, items) => {
    normalizeUserId(userId);
    const normalizedItems = normalizeMergeItems(items);
    return cartRepository.mergeGuestCart(userId, normalizeOperationId(operationId), requestHash(normalizedItems), normalizedItems);
};

module.exports = {
    validateCartItems,
    calculateShipping,
    SHIPPING_FEE_DEFAULT,
    getAccountCart,
    setAccountCartQuantity,
    removeAccountCartItem,
    mergeGuestCart,
    CartDomainError
};
