// ===== CHECKOUT SERVICE =====
// Xử lý toàn bộ logic nghiệp vụ thanh toán: validate → trừ kho → tạo đơn
// Hai luồng:
//   processCheckout()      — Mua ngay 1 sản phẩm (giữ tương thích với flow cũ)
//   processCartCheckout()  — Thanh toán toàn bộ giỏ hàng (nhiều sản phẩm)

const crypto = require("node:crypto");
const productRepository = require("../repositories/product.repository");
const checkoutRepository = require("../repositories/checkout.repository");
const paymentService = require("./payment.service");
const { calculateShipping } = require("./cart.service");

// ─── Helper ───────────────────────────────────────────────────────────────────

const VALID_PAYMENT_METHODS = ["COD", "BANKING", "MOMO", "VNPAY"];

const validateCustomer = ({ customerName, customerPhone, customerAddress }) => {
    const errors = [];
    if (!customerName || customerName.trim().length < 2) {
        errors.push("Tên khách hàng phải có ít nhất 2 ký tự");
    }
    const phoneRegex = /^(0|\+84)[0-9]{8,10}$/;
    if (!customerPhone || !phoneRegex.test(customerPhone.trim())) {
        errors.push("Số điện thoại không hợp lệ (VD: 0901234567 hoặc +84901234567)");
    }
    if (!customerAddress || customerAddress.trim().length < 5) {
        errors.push("Địa chỉ phải có ít nhất 5 ký tự");
    }
    if (errors.length) throw new Error(errors.join("; "));
};

const buildCustomer = ({ customerName, customerPhone, customerAddress, note }) => ({
    name: customerName.trim(),
    phone: customerPhone.trim(),
    address: customerAddress.trim(),
    note: (note && note.trim()) || ""
});

const formatPaymentMethod = (method) => {
    const upper = (method || "").toUpperCase();
    if (!VALID_PAYMENT_METHODS.includes(upper)) {
        throw new Error("Phương thức thanh toán không hợp lệ");
    }
    if (upper === "MOMO" || upper === "VNPAY") return upper;
    return upper === "BANKING" ? "Chuyển khoản ngân hàng" : "Thanh toán khi nhận hàng (COD)";
};

const buildPaymentAttempt = (method, orderId, amount) => {
    if (method !== "MOMO" && method !== "VNPAY") return undefined;
    if (!Number.isSafeInteger(amount) || amount < 1) {
        throw new Error("Số tiền thanh toán không hợp lệ");
    }
    return {
        id: crypto.randomBytes(16).toString("hex"),
        orderId,
        provider: method,
        amount,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    };
};
const initializePaymentOrRetainOrder = async (order, attempt, userId, request) => {
    try {
        return await paymentService.initializeAttempt(order, attempt, request);
    } catch {
        return paymentService.getAttempt(attempt.id, { id: userId });
    }
};

const generateOrderId = () => {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `ORD-${ts}-${rnd}`;
};

const now = () => new Date().toISOString();
const discontinuedProductMessage = (product) =>
    `Sản phẩm '${product.name}' đã ngừng kinh doanh, vui lòng xóa khỏi giỏ hàng.`;
const requireUserId = (userId) => {
    if (typeof userId !== "string" || userId.trim().length === 0) {
        throw new Error("Authentication is required");
    }
    return userId;
};

// ─── Mua ngay 1 sản phẩm ─────────────────────────────────────────────────────

/**
 * Kiểm tra tồn kho (không trừ kho, không tạo đơn)
 * Dùng cho endpoint check-stock
 */
const checkProduct = async (productId, quantity = 1) => {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) throw new Error("Số lượng mua phải là số nguyên lớn hơn 0");
    const product = await productRepository.getProductByID(productId);
    if (!product) throw new Error("Không tìm thấy sản phẩm trong hệ thống");
    if (product.isDeleted === true) throw new Error(discontinuedProductMessage(product));
    if (product.stock <= 0) throw new Error("Sản phẩm hiện đã hết hàng");
    if (product.stock < qty) throw new Error(`Số lượng trong kho không đủ (Hiện chỉ còn ${product.stock} sản phẩm)`);

    return {
        product: { id: product.id, name: product.name, price: product.price, stock: product.stock },
        requestedQuantity: qty,
        inStock: true
    };
};

/**
 * Thanh toán 1 sản phẩm (Mua ngay) — giữ nguyên tương thích
 */
const processCheckout = async (userId, checkoutData, request) => {
    userId = requireUserId(userId);
    const { productId, quantity = 1, customerName, customerPhone, customerAddress, paymentMethod = "COD", note = "" } = checkoutData;

    if (!productId) throw new Error("Vui lòng cung cấp ID sản phẩm.");

    // Validate customer (K1)
    validateCustomer({ customerName, customerPhone, customerAddress });

    // Validate paymentMethod (K2)
    const formattedPayment = formatPaymentMethod(paymentMethod);

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) throw new Error("Số lượng mua không hợp lệ, vui lòng chọn ít nhất 1 sản phẩm.");

    const normalizedProductId = Number(productId);
    if (!Number.isInteger(normalizedProductId)) {
        throw new Error("Không tìm thấy sản phẩm cần thanh toán.");
    }

    try {
        const result = await checkoutRepository.checkout(
            [{ productId: normalizedProductId, quantity: qty }],
            userId,
            ([{ product }]) => {
                if (!product) throw new Error("Không tìm thấy sản phẩm cần thanh toán.");
                if (product.isDeleted === true) throw new Error(discontinuedProductMessage(product));
                if (product.stock <= 0) throw new Error("Sản phẩm đã hết hàng.");
                if (product.stock < qty) throw new Error(`Số lượng trong kho không đủ (Hiện còn ${product.stock} sản phẩm).`);

                const subtotal = product.price * qty;
                const shippingFee = calculateShipping(subtotal);
                const timestamp = now();
                const orderData = {
                    id: generateOrderId(),
                    items: [{
                        productId: product.id,
                        name: product.name,
                        image: product.image,
                        unitPrice: product.price,
                        quantity: qty,
                        lineTotal: subtotal
                    }],
                    subtotal,
                    shippingFee,
                    discount: 0,
                    totalPrice: subtotal + shippingFee,
                    customer: buildCustomer({ customerName, customerPhone, customerAddress, note }),
                    paymentMethod: formattedPayment,
                    orderStatus: "PENDING",
                    paymentStatus: "UNPAID",
                    createdAt: timestamp,
                    updatedAt: timestamp
                };
                orderData.paymentAttempt = buildPaymentAttempt(formattedPayment, orderData.id, orderData.totalPrice);
                return orderData;
            }
        );

        let order = result.order;
        if (result.paymentAttempt) {
            order = {
                ...order,
                paymentAttempt: await initializePaymentOrRetainOrder(order, result.paymentAttempt, userId, request)
            };
        }
        return {
            order,
            remainingStock: result.remainingStockByProductId[normalizedProductId]
        };
    } catch (error) {
        if (!(error instanceof checkoutRepository.CheckoutStockConflictError)) throw error;
        const product = error.product;
        if (!product) throw new Error("Không tìm thấy sản phẩm cần thanh toán.");
        if (product.isDeleted === true) throw new Error(discontinuedProductMessage(product));
        if (product.stock <= 0) throw new Error("Sản phẩm đã hết hàng.");
        throw new Error(`Số lượng trong kho không đủ (Hiện còn ${product.stock} sản phẩm).`);
    }
};

// ─── Thanh toán giỏ hàng (nhiều sản phẩm) ─────────────────────────────────────

/**
 * Checkout toàn bộ giỏ hàng
 *
 * Body: { items: [{ productId, quantity }], customerName, customerPhone,
 *         customerAddress, paymentMethod, note }
 *
 * Returns: { order } — cùng format với processCheckout()
 */
const processCartCheckout = async (userId, { items, customerName, customerPhone, customerAddress, paymentMethod = "COD", note = "" }, request) => {
    userId = requireUserId(userId);
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Giỏ hàng trống, vui lòng thêm sản phẩm trước khi thanh toán.");
    }

    // Validate customer (K1)
    validateCustomer({ customerName, customerPhone, customerAddress });

    // Validate paymentMethod (K2)
    const formattedPayment = formatPaymentMethod(paymentMethod);

    // Gộp trùng productId trước validate (B1)
    const qtyMap = new Map();
    for (const { productId, quantity } of items) {
        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty <= 0) {
            throw new Error(`Số lượng không hợp lệ cho sản phẩm ID ${productId}.`);
        }

        const normalizedProductId = Number(productId);
        if (!Number.isInteger(normalizedProductId)) {
            throw new Error(`Sản phẩm ID ${productId} không tồn tại.`);
        }
        qtyMap.set(normalizedProductId, (qtyMap.get(normalizedProductId) || 0) + qty);
    }

    const normalizedItems = [...qtyMap.entries()]
        .map(([productId, quantity]) => ({ productId, quantity }));

    try {
        const result = await checkoutRepository.checkout(normalizedItems, userId, (lockedItems) => {
            const validatedItems = lockedItems.map(({ productId, quantity: qty, product }) => {
                if (!product) throw new Error(`Sản phẩm ID ${productId} không tồn tại.`);
                if (product.isDeleted === true) throw new Error(discontinuedProductMessage(product));
                if (product.stock <= 0) throw new Error(`"${product.name}" đã hết hàng.`);
                if (product.stock < qty) throw new Error(`"${product.name}" chỉ còn ${product.stock} sản phẩm (yêu cầu ${qty}).`);
                return { product, qty };
            });

            const orderItems = validatedItems.map(({ product, qty }) => ({
                productId: product.id,
                name: product.name,
                image: product.image,
                unitPrice: product.price,
                quantity: qty,
                lineTotal: product.price * qty
            }));

            const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
            const shippingFee = calculateShipping(subtotal);
            const timestamp = now();

            const orderData = {
                id: generateOrderId(),
                items: orderItems,
                subtotal,
                shippingFee,
                discount: 0,
                totalPrice: subtotal + shippingFee,
                customer: buildCustomer({ customerName, customerPhone, customerAddress, note }),
                paymentMethod: formattedPayment,
                orderStatus: "PENDING",
                paymentStatus: "UNPAID",
                createdAt: timestamp,
                updatedAt: timestamp
            };
            orderData.paymentAttempt = buildPaymentAttempt(formattedPayment, orderData.id, orderData.totalPrice);
            return orderData;
        });

        let order = result.order;
        if (result.paymentAttempt) {
            order = { ...order, paymentAttempt: await initializePaymentOrRetainOrder(order, result.paymentAttempt, userId, request) };
        }
        return { order };
    } catch (error) {
        if (!(error instanceof checkoutRepository.CheckoutStockConflictError)) throw error;
        const product = error.product;
        if (!product) throw new Error("Sản phẩm không tồn tại.");
        if (product.isDeleted === true) throw new Error(discontinuedProductMessage(product));
        if (product.stock <= 0) throw new Error(`"${product.name}" đã hết hàng.`);
        throw new Error(`"${product.name}" chỉ còn ${product.stock} sản phẩm (yêu cầu ${error.quantity}).`);
    }
};

module.exports = { checkProduct, processCheckout, processCartCheckout };
