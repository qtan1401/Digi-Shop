// ===== ORDER MODEL =====
// Đây là tầng Model - chứa dữ liệu và cấu trúc dữ liệu của đơn hàng (Order)
// Trong thực tế sẽ lưu vào Database (MongoDB, MySQL,...), ở đây dùng mảng để học tập

/**
 * Danh sách đơn hàng trong bộ nhớ
 * Cấu trúc mỗi đơn hàng gồm:
 * - id: Mã đơn hàng (string/number)
 * - product: Thông tin sản phẩm (id, name, price, image)
 * - quantity: Số lượng mua
 * - unitPrice: Đơn giá tại thời điểm mua
 * - totalPrice: Tổng tiền thanh toán
 * - customer: Thông tin khách hàng (name, phone, address, note)
 * - paymentMethod: Phương thức thanh toán (COD, BANKING)
 * - status: Trạng thái đơn hàng (COMPLETED, PENDING, CANCELLED)
 * - createdAt: Thời gian tạo đơn
 */
const orders = [];

module.exports = orders;
