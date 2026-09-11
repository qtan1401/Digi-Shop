// ===== CART SERVICE =====
// Xử lý logic nghiệp vụ của giỏ hàng: validate stock thực tế và tính phí vận chuyển
// Cart KHÔNG trừ kho, KHÔNG tạo đơn — đó là nhiệm vụ của Checkout Service

const productRepository = require("../repositories/product.repository");

// Phí vận chuyển mặc định (VNĐ) là 100.000đ theo yêu cầu hiển thị mặc định
const SHIPPING_FEE_DEFAULT = 100000;

/**
 * Tính phí vận chuyển dựa trên tổng tiền hàng
 * @param {number} subtotal - Tổng tiền hàng (chưa gồm ship)
 * @returns {number} Phí vận chuyển mặc định là 100.000 VNĐ
 */
const calculateShipping = (subtotal = 0) => {
    return SHIPPING_FEE_DEFAULT;
};

/**
 * Validate danh sách items trong giỏ hàng đối chiếu với tồn kho thực tế
 * Trả về trạng thái từng item + tổng tiền + phí ship
 *
 * @param {Array<{productId: number|string, quantity: number}>} items
 * @returns {Object} { validatedItems, subtotal, shippingFee, total, hasUnavailable }
 */
const validateCartItems = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Giỏ hàng trống, vui lòng thêm sản phẩm trước khi tiếp tục.");
    }

    let subtotal = 0;
    let hasUnavailable = false;

    const validatedItems = items.map(({ productId, quantity }) => {
        const qty = parseInt(quantity, 10);
        const product = productRepository.getProductByID(productId);

        // Sản phẩm không tồn tại
        if (!product) {
            hasUnavailable = true;
            return {
                productId,
                name: "Sản phẩm không tồn tại",
                image: null,
                price: 0,
                quantity: qty || 0,
                stock: 0,
                available: false,
                unavailableReason: "not_found",
                lineTotal: 0
            };
        }

        // Sản phẩm hết hàng
        if (product.stock <= 0) {
            hasUnavailable = true;
            return {
                productId: product.id,
                name: product.name,
                image: product.image,
                price: product.price,
                quantity: qty,
                stock: 0,
                available: false,
                unavailableReason: "out_of_stock",
                lineTotal: 0
            };
        }

        // Số lượng yêu cầu vượt tồn kho — điều chỉnh xuống max stock
        const effectiveQty = Math.min(qty, product.stock);
        const lineTotal = product.price * effectiveQty;
        subtotal += lineTotal;

        return {
            productId: product.id,
            name: product.name,
            image: product.image,
            description: product.description,
            price: product.price,
            quantity: effectiveQty,
            requestedQuantity: qty,
            stock: product.stock,
            available: true,
            quantityAdjusted: effectiveQty !== qty,
            lineTotal
        };
    });

    const shippingFee = calculateShipping(subtotal);
    const total = subtotal + shippingFee;

    return { validatedItems, subtotal, shippingFee, total, hasUnavailable };
};

module.exports = {
    validateCartItems,
    calculateShipping,
    SHIPPING_FEE_DEFAULT
};
