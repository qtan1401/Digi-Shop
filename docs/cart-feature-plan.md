# 🛒 Kế hoạch Thiết kế: Tính năng Giỏ hàng (Cart Feature)

> Dự án: Digi-Shop (Node.js + Express, MVC + Repository + Service)
> Phạm vi: Thiết kế Cart độc lập với Checkout và Order Management,
>          chuẩn bị hạ tầng phân quyền Admin / User về sau.

---

## 0. Nguyên tắc thiết kế cốt lõi

| Nguyên tắc | Quyết định |
|---|---|
| **Tách biệt domain** | Cart ≠ Checkout ≠ Order — mỗi domain sở hữu dữ liệu, route, service riêng |
| **Storage cho Cart** | `localStorage` (client-side, giai đoạn học). Đặt sẵn interface để nâng lên server-side session sau |
| **Shipping Fee** | Tính phía server (`cart.service`) theo rule đơn giản → dễ thay rule sau |
| **Phân quyền** | Đặt placeholder `role: "user" \| "admin"` ngay từ đầu; middleware auth xác nhận role |
| **Không phá vỡ flow cũ** | Giữ nguyên `POST /api/checkout`; Cart chỉ là bước chuẩn bị trước checkout |

---

## 1. Phân tách 3 Domain rõ ràng

```
┌──────────────────────────────────────────────────────────────┐
│  CART (Giỏ hàng)          CHECKOUT (Thanh toán)   ORDER (Đơn hàng) │
│  ─────────────────        ──────────────────────  ──────────────── │
│  Client-side state        Server-side transaction  Server-side DB   │
│  localStorage             Validate → Deduct stock  Persistent store │
│  Không cần đăng nhập      Cần thông tin KH         Lịch sử mua hàng │
│                                                                      │
│  USER thao tác            USER thao tác            USER xem          │
│                                                    ADMIN quản lý     │
└──────────────────────────────────────────────────────────────┘
```

### Ranh giới rõ ràng giữa 3 domain:

```
[Trang SP] → "Add to Cart"
    ↓ localStorage
[/cart.html] → Xem giỏ, chỉnh số lượng, xóa, xem subtotal + shipping
    ↓ "Tiến hành thanh toán"
[/checkouts.html] → Nhập thông tin KH, chọn PTTT, xác nhận
    ↓ POST /api/checkout/batch
[/order-confirm.html?orderId=ORD-xxx] → Hiển thị đơn hàng đã tạo
    ↓ (Admin)
[/admin/orders.html] → Quản lý toàn bộ đơn hàng
```

---

## 2. Data Shapes (Chuẩn dữ liệu)

### 2.1 Cart Item (localStorage)
```js
// Key: "digi_cart"  |  Value: JSON array
[
  {
    productId: 1,
    name: "iPhone 16 Pro Max",
    slug: "iphone-16-pro-max",
    image: "https://...",
    description: "iPhone 16 Pro Max với chip A18 Pro...",  // summary
    price: 34990000,        // snapshot giá tại thời điểm add
    quantity: 2,
    addedAt: "2026-09-10T08:00:00.000Z"
  }
]
```

> **Lý do snapshot giá:** Giá sản phẩm có thể thay đổi; giỏ hàng phải hiển thị đúng giá khi user add, checkout sẽ re-validate lại giá thực từ server.

### 2.2 Cart Summary (tính client-side, validate server-side)
```js
{
  items: [...],          // CartItem[]
  itemCount: 3,          // tổng số lượng tất cả item
  subtotal: 68980000,    // tổng tiền hàng
  shippingFee: 30000,    // phí ship (tính từ API)
  discount: 0,           // giảm giá (phase 2)
  total: 69010000        // subtotal + shippingFee - discount
}
```

### 2.3 Checkout Request Body (Cart → Checkout)
```js
// POST /api/checkout/batch
{
  items: [
    { productId: 1, quantity: 2 },
    { productId: 3, quantity: 1 }
  ],
  customerName: "Nguyễn Văn A",
  customerPhone: "0901234567",
  customerAddress: "123 Lê Lợi, Q1, TP.HCM",
  paymentMethod: "COD",   // "COD" | "BANKING"
  note: ""
}
```

### 2.4 Order Shape (mở rộng từ hiện tại)
```js
{
  id: "ORD-1725955200000",
  items: [                          // MẢNG item thay vì 1 product
    {
      productId: 1,
      name: "iPhone 16 Pro Max",
      image: "https://...",
      unitPrice: 34990000,
      quantity: 2,
      lineTotal: 69980000
    }
  ],
  subtotal: 69980000,
  shippingFee: 30000,
  discount: 0,
  totalPrice: 70010000,
  customer: {
    name: "Nguyễn Văn A",
    phone: "0901234567",
    address: "123 Lê Lợi, Q1, TP.HCM",
    note: ""
  },
  paymentMethod: "COD",
  orderStatus: "PENDING",           // PENDING → PROCESSING → SHIPPED → DELIVERED → CANCELLED
  paymentStatus: "UNPAID",         // UNPAID → PAID → REFUNDED
  createdAt: "2026-09-10T08:00:00.000Z",
  updatedAt: "2026-09-10T08:00:00.000Z"
}
```

---

## 3. Kiến trúc File (Files cần tạo / sửa)

```
src/
├── models/
│   ├── product.model.js         [GIỮ NGUYÊN]
│   └── order.model.js           [SỬA] thêm orderStatus, paymentStatus, shippingFee, items[]
│
├── repositories/
│   ├── product.repository.js    [GIỮ NGUYÊN]
│   ├── order.repository.js      [SỬA] thêm updateOrderStatus(), updatePaymentStatus()
│   └── cart.repository.js       [MỚI] server-side cart ops (nếu nâng lên session sau)
│
├── services/
│   ├── cart.service.js          [MỚI] tính shipping fee, validate items với stock thực
│   ├── checkout.service.js      [SỬA] thêm processCartCheckout() xử lý mảng items
│   └── order.service.js         [MỚI] getOrderById, getAllOrders, updateStatus (admin)
│
├── controllers/
│   ├── cart.controller.js       [MỚI] calculateShipping, validateCart
│   ├── checkout.controller.js   [SỬA] thêm cartCheckout handler
│   └── order.controller.js      [SỬA] thêm updateOrderStatus (admin route)
│
├── routes/
│   ├── cart.routes.js           [MỚI] POST /api/cart/validate, POST /api/cart/shipping
│   ├── checkout.routes.js       [SỬA] thêm POST /api/checkout/batch
│   └── order.routes.js          [SỬA] thêm PATCH /api/orders/:id/status (admin)
│
└── middlewares/                  [MỚI - thư mục mới]
    ├── auth.middleware.js        [MỚI] xác thực token (placeholder JWT)
    └── role.middleware.js        [MỚI] requireRole("admin") | requireRole("user")

public/
├── cart.html                    [MỚI] Trang giỏ hàng
├── js/
│   ├── cart.js                  [MỚI] Logic cart: CRUD localStorage, render, sync server
│   ├── main.js                  [SỬA] Thêm nút "Add to Cart" vào product card
│   └── payment.js               [SỬA] Đọc từ cart thay vì URL param đơn lẻ
└── css/
    └── styles.css               [SỬA] Thêm styles cho cart page, cart badge, toast
```

---

## 4. API Endpoints

### 4.1 Cart API (server dùng để validate / tính toán)

| Method | Endpoint | Mô tả | Auth |
|---|---|---|---|
| `POST` | `/api/cart/validate` | Kiểm tra stock thực tế của tất cả items trong cart | ❌ Public |
| `POST` | `/api/cart/shipping` | Tính phí vận chuyển dựa theo địa chỉ + subtotal | ❌ Public |

### 4.2 Checkout API (bổ sung)

| Method | Endpoint | Mô tả | Auth |
|---|---|---|---|
| `POST` | `/api/checkout` | Checkout 1 sản phẩm (GIỮ NGUYÊN) | ❌ Public |
| `POST` | `/api/checkout/batch` | Checkout toàn bộ giỏ hàng (MỚI) | ❌ Public |

### 4.3 Order API

| Method | Endpoint | Mô tả | Auth |
|---|---|---|---|
| `GET` | `/api/orders/:id` | Xem chi tiết đơn hàng | ❌ Public (tra mã) |
| `GET` | `/api/orders` | Danh sách tất cả đơn hàng | 🔒 Admin |
| `PATCH` | `/api/orders/:id/status` | Cập nhật trạng thái đơn hàng | 🔒 Admin |

---

## 5. Shipping Fee Rule (Logic tính phí ship)

```
Subtotal ≥ 500,000đ  → Miễn phí ship (shippingFee = 0)
Subtotal < 500,000đ  → 30,000đ

// Mở rộng phase 2: theo khu vực
// Nội thành TP.HCM / HN  → 20,000đ
// Tỉnh khác              → 35,000đ
```

Đặt trong `cart.service.js::calculateShipping(subtotal, address?)`:
```js
const calculateShipping = (subtotal, address = "") => {
    if (subtotal >= 500000) return 0;
    return 30000;
};
```

---

## 6. UI Cart Page (`/cart.html`)

```
┌────────────────────────────────────────────────────────────┐
│  NodeShop                          🛒 Giỏ hàng (2)  [nav]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  GIỎ HÀNG CỦA BẠN (2 sản phẩm)                           │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ [IMG] iPhone 16 Pro Max                              │  │
│  │       Chip A18 Pro, camera 48MP, màn 6.9" ...        │  │
│  │       34.990.000₫            [-] [2] [+]  [🗑 Xóa]  │  │
│  │       Thành tiền: 69.980.000₫                        │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ [IMG] MacBook Pro M4                                 │  │
│  │       Chip M4 Pro, RAM 18GB, SSD 512GB ...           │  │
│  │       49.990.000₫            [-] [1] [+]  [🗑 Xóa]  │  │
│  │       Thành tiền: 49.990.000₫                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│                          ┌──────────────────────────────┐  │
│                          │ Tạm tính:   119.970.000₫     │  │
│                          │ Phí ship:   Miễn phí ✓       │  │
│                          │ ─────────────────────────    │  │
│                          │ TỔNG CỘNG:  119.970.000₫     │  │
│                          │                              │  │
│                          │ [Tiếp tục mua sắm]           │  │
│                          │ [THANH TOÁN NGAY →]          │  │
│                          └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## 7. Cart Badge trên Navbar

- Icon giỏ hàng trên nav: `🛒 (n)` — n là tổng số lượng items.
- Cập nhật realtime khi add/remove item (không cần reload trang).
- Tất cả các trang `index.html`, `product_info.html`, `cart.html`, `checkouts.html` đều có badge này.

```html
<!-- Thêm vào tất cả navbar -->
<li>
  <a href="/cart.html" class="cart-nav-link">
    🛒 <span class="cart-badge" id="cart-badge">0</span>
  </a>
</li>
```

---

## 8. Luồng dữ liệu chi tiết (Data Flow)

```
[index.html / product_info.html]
    "Add to Cart" click
        ↓
[cart.js] cartService.addItem(product)
    → localStorage "digi_cart" push/update
    → cập nhật badge navbar
    → toast notification "Đã thêm vào giỏ hàng"
        ↓
[cart.html]
    loadCart() đọc localStorage
        ↓
    POST /api/cart/validate  ← so sánh quantity với stock thực
        ↓ (nếu có item hết hàng → warning, vô hiệu hóa)
    POST /api/cart/shipping  ← tính phí ship
        ↓
    Render items + summary (subtotal, ship, total)
        ↓
    "Thanh toán ngay" → /checkouts.html
        ↓
[checkouts.html / payment.js]
    Đọc cart từ localStorage
    Hiển thị order summary bên phải
    Form nhập thông tin KH + chọn PTTT
        ↓
    POST /api/checkout/batch { items[], customer, paymentMethod }
        ↓
[checkout.service.js] processCartCheckout()
    Validate từng item (stock)
    Tính lại total (không tin giá từ client)
    decreaseStock() từng sản phẩm
    createOrder() → order với orderStatus: PENDING, paymentStatus: UNPAID
        ↓
[order-confirm.html?orderId=ORD-xxx]
    Hiển thị xác nhận đơn hàng
```

---

## 9. Chuẩn bị phân quyền Admin / User

### Middleware structure (placeholder, chưa implement JWT):
```js
// src/middlewares/auth.middleware.js
const authenticate = (req, res, next) => {
    // Phase 2: Verify JWT token từ Authorization header
    // Hiện tại: Gắn dummy user để dev
    req.user = { id: 1, role: "user" };
    next();
};

// src/middlewares/role.middleware.js
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, message: "Không có quyền truy cập" });
    }
    next();
};
```

### Route phân quyền:
```js
// Admin-only routes (order.routes.js)
router.get("/",          authenticate, requireRole("admin"), orderController.getAllOrders);
router.patch("/:id/status", authenticate, requireRole("admin"), orderController.updateOrderStatus);

// Public routes
router.get("/:id",  orderController.getOrderById);  // user tra mã đơn
```

---

## 10. Thứ tự triển khai (Implementation Phases)

### Phase 1 — Hạ tầng Cart (Backend + localStorage)
1. `src/services/cart.service.js` — `validateCartItems()`, `calculateShipping()`
2. `src/controllers/cart.controller.js` + `src/routes/cart.routes.js`
3. Mount `/api/cart` trong `src/app.js`

### Phase 2 — Cart UI
4. `public/js/cart.js` — CRUD localStorage, `addItem`, `removeItem`, `updateQuantity`, `getCartSummary`
5. `public/cart.html` — Trang giỏ hàng full UI
6. Sửa `public/js/main.js` — Thêm nút "Add to Cart" vào product card + badge
7. Sửa `public/js/product_info.js` — Thêm nút "Add to Cart" + badge

### Phase 3 — Batch Checkout
8. Sửa `src/services/checkout.service.js` — Thêm `processCartCheckout()`
9. Sửa `src/controllers/checkout.controller.js` + routes — thêm `/api/checkout/batch`
10. Sửa `public/js/payment.js` — Đọc cart, hiển thị order summary bên phải form

### Phase 4 — Order Management & Auth Skeleton
11. Sửa `src/models/order.model.js` + `order.repository.js` — thêm `orderStatus`, `paymentStatus`, `updateStatus()`
12. `src/services/order.service.js` + sửa `order.controller.js`
13. `src/middlewares/auth.middleware.js` + `role.middleware.js`
14. Áp dụng middleware vào admin routes

---

## 11. Definition of Done

- [ ] "Add to Cart" hoạt động từ trang danh sách + trang chi tiết sản phẩm
- [ ] Badge giỏ hàng hiển thị đúng số lượng trên tất cả trang
- [ ] `/cart.html` hiển thị đầy đủ: ảnh, tên, mô tả ngắn, đơn giá, số lượng (chỉnh được), thành tiền, tổng tiền, phí ship
- [ ] Phí ship tự động cập nhật theo subtotal (qua `/api/cart/shipping`)
- [ ] Item hết hàng được đánh dấu cảnh báo, không cho checkout
- [ ] Checkout từ giỏ hàng gọi `/api/checkout/batch` tạo đơn nhiều item
- [ ] Order có `orderStatus` + `paymentStatus` tách biệt
- [ ] Admin route (`GET /api/orders`, `PATCH /api/orders/:id/status`) được bảo vệ bởi `requireRole("admin")`
