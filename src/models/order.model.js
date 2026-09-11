// ===== ORDER MODEL =====
// Cấu trúc dữ liệu đơn hàng — hỗ trợ cả đơn lẻ (1 sản phẩm) và đơn giỏ hàng (nhiều sản phẩm)
//
// Order shape:
// {
//   id: string,                    -- "ORD-{timestamp}"
//   items: Array<{                 -- mảng sản phẩm trong đơn
//     productId, name, image,
//     unitPrice, quantity, lineTotal
//   }>,
//   subtotal: number,              -- tổng tiền hàng (chưa ship)
//   shippingFee: number,           -- phí vận chuyển
//   discount: number,              -- giảm giá (hiện luôn = 0, dự phòng phase 2)
//   totalPrice: number,            -- subtotal + shippingFee - discount
//   customer: { name, phone, address, note },
//   paymentMethod: string,         -- "COD" | "BANKING"
//   orderStatus: string,           -- "PENDING" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED"
//   paymentStatus: string,         -- "UNPAID" | "PAID" | "REFUNDED"
//   createdAt: string,
//   updatedAt: string
// }

const orders = [];

module.exports = orders;
