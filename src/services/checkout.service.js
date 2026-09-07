// ===== CHECKOUT SERVICE =====
// Đây là tầng Service - xử lý toàn bộ logic nghiệp vụ (business logic) của việc thanh toán
// Service kiểm tra tính hợp lệ, trừ kho và tạo đơn hàng thông qua các Repository

const productRepository = require("../repositories/product.repository");
const orderRepository = require("../repositories/order.repository");

/**
 * Kiểm tra xem sản phẩm có đủ số lượng trong kho hay không
 * @param {number|string} productId - ID sản phẩm
 * @param {number} quantity - Số lượng khách muốn mua
 * @returns {Object} Thông tin sản phẩm và trạng thái kho
 * @throws {Error} Nếu sản phẩm không tồn tại hoặc không đủ số lượng
 */
const checkProduct = async (productId, quantity = 1) => {
    // 1. Kiểm tra dữ liệu đầu vào
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
        throw new Error("Số lượng mua phải là số nguyên lớn hơn 0");
    }

    // 2. Tìm sản phẩm trong kho
    const product = productRepository.getProductByID(productId);
    if (!product) {
        throw new Error("Không tìm thấy sản phẩm trong hệ thống");
    }

    // 3. Kiểm tra số lượng tồn kho
    if (product.stock <= 0) {
        throw new Error("Sản phẩm hiện đã hết hàng");
    }

    if (product.stock < qty) {
        throw new Error(`Số lượng trong kho không đủ (Hiện chỉ còn ${product.stock} sản phẩm)`);
    }

    // 4. Trả về thông tin sản phẩm và tồn kho hợp lệ
    return {
        product,
        inStock: true,
        requestedQuantity: qty,
        availableStock: product.stock
    };
};

/**
 * Xử lý quy trình thanh toán và tạo đơn hàng hoàn chỉnh
 * @param {Object} checkoutData - Dữ liệu thanh toán từ client
 * @param {number|string} checkoutData.productId - ID sản phẩm cần mua
 * @param {number} checkoutData.quantity - Số lượng mua
 * @param {string} [checkoutData.customerName] - Họ tên khách hàng
 * @param {string} [checkoutData.customerPhone] - Số điện thoại
 * @param {string} [checkoutData.customerAddress] - Địa chỉ nhận hàng
 * @param {string} [checkoutData.paymentMethod] - Phương thức thanh toán (COD, BANKING)
 * @param {string} [checkoutData.note] - Ghi chú đơn hàng
 * @returns {Object} Kết quả gồm thông tin đơn hàng và số lượng tồn kho còn lại
 */
const processCheckout = async (checkoutData) => {
    const {
        productId,
        quantity = 1,
        customerName,
        customerPhone,
        customerAddress,
        paymentMethod = "COD",
        note = ""
    } = checkoutData;

    // Bước 1: Validate ID sản phẩm
    if (!productId) {
        throw new Error("Vui lòng cung cấp ID sản phẩm cần thanh toán");
    }

    // Bước 2: Validate số lượng mua
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
        throw new Error("Số lượng mua không hợp lệ, vui lòng chọn ít nhất 1 sản phẩm");
    }

    // Bước 3: Lấy thông tin sản phẩm từ Repository
    const product = productRepository.getProductByID(productId);
    if (!product) {
        throw new Error("Không tìm thấy sản phẩm cần thanh toán");
    }

    // Bước 4: Kiểm tra tồn kho
    if (product.stock <= 0) {
        throw new Error("Sản phẩm đã hết hàng, không thể tiếp tục thanh toán");
    }

    if (product.stock < qty) {
        throw new Error(`Số lượng trong kho không đủ đáp ứng (Hiện còn ${product.stock} sản phẩm)`);
    }

    // Bước 5: Tính toán tổng tiền
    const totalPrice = product.price * qty;

    // Bước 6: Trừ số lượng tồn kho của sản phẩm
    productRepository.decreaseStock(productId, qty);

    // Bước 7: Tạo đối tượng đơn hàng mới (Order)
    const newOrder = {
        id: "ORD-" + Date.now(), // Tạo mã đơn hàng duy nhất dựa trên timestamp
        product: {
            id: product.id,
            name: product.name,
            slug: product.slug,
            image: product.image
        },
        quantity: qty,
        unitPrice: product.price,
        totalPrice: totalPrice,
        customer: {
            name: (customerName && customerName.trim()) || "Khách hàng",
            phone: (customerPhone && customerPhone.trim()) || "Chưa cung cấp",
            address: (customerAddress && customerAddress.trim()) || "Nhận tại cửa hàng",
            note: (note && note.trim()) || ""
        },
        paymentMethod: paymentMethod === "BANKING" ? "Chuyển khoản ngân hàng" : "Thanh toán khi nhận hàng (COD)",
        status: "COMPLETED", // Trạng thái đơn hàng
        createdAt: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    };

    // Bước 8: Lưu đơn hàng vào Order Repository
    const savedOrder = orderRepository.createOrder(newOrder);

    // Bước 9: Trả về kết quả thanh toán cho Controller
    return {
        order: savedOrder,
        remainingStock: product.stock
    };
};

/**
 * Lấy chi tiết đơn hàng theo mã đơn
 * @param {string|number} orderId - Mã đơn hàng
 * @returns {Object} Đơn hàng tìm được
 * @throws {Error} Nếu không tìm thấy đơn hàng
 */
const getOrderById = async (orderId) => {
    const order = orderRepository.getOrderById(orderId);
    if (!order) {
        throw new Error("Không tìm thấy đơn hàng với mã: " + orderId);
    }
    return order;
};

/**
 * Lấy danh sách tất cả các đơn hàng đã tạo
 * @returns {Array} Danh sách đơn hàng
 */
const getAllOrders = async () => {
    return orderRepository.getAllOrders();
};

module.exports = {
    checkProduct,
    processCheckout,
    getOrderById,
    getAllOrders
};
