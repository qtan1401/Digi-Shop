// ===== CHECKOUT CONTROLLER =====
// Đây là tầng Controller - tiếp nhận HTTP request từ Client, gọi Service xử lý và trả response
// Controller chỉ làm nhiệm vụ điều phối và định dạng dữ liệu trả về, không chứa logic nghiệp vụ

const checkoutService = require("../services/checkout.service");

/**
 * [POST] /api/checkout/check-stock/:id hoặc [POST] /api/checkout/:id (kiểm tra tồn kho)
 * Tiếp nhận yêu cầu kiểm tra số lượng hàng trong kho
 */
const checkProductinStock = async (req, res) => {
    try {
        const productId = req.params.id || req.body.productId;
        const quantity = req.body.quantity || req.query.quantity || 1;

        const result = await checkoutService.checkProduct(productId, quantity);
        res.status(200).json({
            success: true,
            message: "Sản phẩm còn hàng trong kho",
            inStock: true,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * [POST] /api/checkout hoặc [POST] /api/checkout/:id
 * Tiếp nhận yêu cầu thực hiện thanh toán và tạo đơn hàng
 */
const processCheckout = async (req, res) => {
    try {
        // Lấy ID sản phẩm từ URL params hoặc từ Body của request
        const productId = req.params.id || req.body.productId;
        const {
            quantity = 1,
            customerName,
            customerPhone,
            customerAddress,
            paymentMethod,
            note
        } = req.body;

        // Gọi tầng Service để xử lý quy trình thanh toán
        const result = await checkoutService.processCheckout({
            productId,
            quantity,
            customerName,
            customerPhone,
            customerAddress,
            paymentMethod,
            note
        });

        // Trả về kết quả thành công kèm thông tin đơn hàng
        res.status(200).json({
            success: true,
            message: "Đặt hàng và thanh toán thành công!",
            data: result.order,
            remainingStock: result.remainingStock
        });
    } catch (error) {
        // Trả về lỗi nếu không đủ hàng hoặc dữ liệu không hợp lệ
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * [GET] /api/checkout/orders/:id
 * Lấy chi tiết đơn hàng theo mã đơn
 */
const getOrderDetail = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await checkoutService.getOrderById(orderId);
        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * [GET] /api/checkout/orders
 * Lấy danh sách tất cả các đơn hàng đã đặt
 */
const getAllOrders = async (req, res) => {
    try {
        const orders = await checkoutService.getAllOrders();
        res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    checkProductinStock,
    processCheckout,
    getOrderDetail,
    getAllOrders
};
