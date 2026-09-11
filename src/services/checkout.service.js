// ===== CHECKOUT SERVICE =====
// Xử lý toàn bộ logic nghiệp vụ thanh toán: validate → trừ kho → tạo đơn
// Hai luồng:
//   processCheckout()      — Mua ngay 1 sản phẩm (giữ tương thích với flow cũ)
//   processCartCheckout()  — Thanh toán toàn bộ giỏ hàng (nhiều sản phẩm)

const productRepository = require("../repositories/product.repository");
const orderRepository = require("../repositories/order.repository");
const { calculateShipping } = require("./cart.service");

// ─── Helper ───────────────────────────────────────────────────────────────────

const buildCustomer = ({ customerName, customerPhone, customerAddress, note }) => ({
    name: (customerName && customerName.trim()) || "Khách hàng",
    phone: (customerPhone && customerPhone.trim()) || "",
    address: (customerAddress && customerAddress.trim()) || "",
    note: (note && note.trim()) || ""
});

const formatPaymentMethod = (method) =>
    method === "BANKING" ? "Chuyển khoản ngân hàng" : "Thanh toán khi nhận hàng (COD)";

const generateOrderId = () => "ORD-" + Date.now();

const now = () => new Date().toISOString();

// ─── Mua ngay 1 sản phẩm ─────────────────────────────────────────────────────

/**
 * Kiểm tra tồn kho (không trừ kho, không tạo đơn)
 * Dùng cho endpoint check-stock
 */
const checkProduct = async (productId, quantity = 1) => {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) throw new Error("Số lượng mua phải là số nguyên lớn hơn 0");

    const product = productRepository.getProductByID(productId);
    if (!product) throw new Error("Không tìm thấy sản phẩm trong hệ thống");
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
const processCheckout = async (checkoutData) => {
    const { productId, quantity = 1, customerName, customerPhone, customerAddress, paymentMethod = "COD", note = "" } = checkoutData;

    if (!productId) throw new Error("Vui lòng cung cấp ID sản phẩm.");

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) throw new Error("Số lượng mua không hợp lệ, vui lòng chọn ít nhất 1 sản phẩm.");

    const product = productRepository.getProductByID(productId);
    if (!product) throw new Error("Không tìm thấy sản phẩm cần thanh toán.");
    if (product.stock <= 0) throw new Error("Sản phẩm đã hết hàng.");
    if (product.stock < qty) throw new Error(`Số lượng trong kho không đủ (Hiện còn ${product.stock} sản phẩm).`);

    // Tính tiền
    const subtotal = product.price * qty;
    const shippingFee = calculateShipping(subtotal);
    const totalPrice = subtotal + shippingFee;

    // Trừ kho
    productRepository.decreaseStock(productId, qty);

    // Tạo đơn — dùng cấu trúc items[] thống nhất với cart checkout
    const order = {
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
        totalPrice,
        customer: buildCustomer({ customerName, customerPhone, customerAddress, note }),
        paymentMethod: formatPaymentMethod(paymentMethod),
        orderStatus: "PENDING",
        paymentStatus: paymentMethod === "BANKING" ? "UNPAID" : "UNPAID",
        createdAt: now(),
        updatedAt: now()
    };

    const savedOrder = orderRepository.createOrder(order);
    return { order: savedOrder, remainingStock: product.stock };
};

// ─── Thanh toán giỏ hàng (nhiều sản phẩm) ────────────────────────────────────

/**
 * Checkout toàn bộ giỏ hàng
 * @param {Object} param
 * @param {Array<{productId, quantity}>} param.items
 * @param {string} param.customerName
 * @param {string} param.customerPhone
 * @param {string} param.customerAddress
 * @param {string} param.paymentMethod
 * @param {string} param.note
 */
const processCartCheckout = async ({ items, customerName, customerPhone, customerAddress, paymentMethod = "COD", note = "" }) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Giỏ hàng trống, vui lòng thêm sản phẩm trước khi thanh toán.");
    }

    // Validate & snapshot từng item — KHÔNG tin giá từ client
    const validatedItems = [];
    const stockErrors = [];

    for (const { productId, quantity } of items) {
        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty <= 0) {
            throw new Error(`Số lượng không hợp lệ cho sản phẩm ID ${productId}.`);
        }

        const product = productRepository.getProductByID(productId);
        if (!product) {
            stockErrors.push(`Sản phẩm ID ${productId} không tồn tại.`);
            continue;
        }
        if (product.stock <= 0) {
            stockErrors.push(`"${product.name}" đã hết hàng.`);
            continue;
        }
        if (product.stock < qty) {
            stockErrors.push(`"${product.name}" chỉ còn ${product.stock} sản phẩm (bạn chọn ${qty}).`);
            continue;
        }

        validatedItems.push({ product, qty });
    }

    if (stockErrors.length > 0) {
        throw new Error("Không thể thanh toán:\n" + stockErrors.join("\n"));
    }

    // Trừ kho tất cả (chỉ sau khi toàn bộ đã pass validate)
    for (const { product, qty } of validatedItems) {
        productRepository.decreaseStock(product.id, qty);
    }

    // Build order items & tính tiền
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
    const totalPrice = subtotal + shippingFee;

    const order = {
        id: generateOrderId(),
        items: orderItems,
        subtotal,
        shippingFee,
        discount: 0,
        totalPrice,
        customer: buildCustomer({ customerName, customerPhone, customerAddress, note }),
        paymentMethod: formatPaymentMethod(paymentMethod),
        orderStatus: "PENDING",
        paymentStatus: "UNPAID",
        createdAt: now(),
        updatedAt: now()
    };

    const savedOrder = orderRepository.createOrder(order);
    return { order: savedOrder };
};

module.exports = { checkProduct, processCheckout, processCartCheckout };
