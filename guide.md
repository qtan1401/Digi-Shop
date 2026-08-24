# 📘 Hướng Dẫn Xây Dựng Project Node.js + Express theo MVC & RESTful API

## Mục Lục

1. [Tổng Quan Kiến Trúc](#1-tổng-quan-kiến-trúc)
2. [Cấu Trúc Thư Mục](#2-cấu-trúc-thư-mục)
3. [Cài Đặt Project Từ Đầu](#3-cài-đặt-project-từ-đầu)
4. [Giải Thích Từng Layer trong MVC](#4-giải-thích-từng-layer-trong-mvc)
5. [Routing trong Express](#5-routing-trong-express)
6. [Flow Dữ Liệu Từ Request → Response](#6-flow-dữ-liệu-từ-request--response)
7. [Cách Chạy Project](#7-cách-chạy-project)

---

## 1. Tổng Quan Kiến Trúc

### MVC là gì?

**MVC (Model - View - Controller)** là mô hình kiến trúc phần mềm chia ứng dụng thành 3 phần:

| Layer | Vai trò | File ví dụ |
|-------|---------|-----------|
| **Model** | Chứa dữ liệu và cấu trúc dữ liệu | `product.model.js` |
| **View** | Giao diện người dùng (HTML/CSS/JS) | `index.html`, `product_info.html` |
| **Controller** | Nhận request, gọi xử lý, trả response | `product.controller.js` |

### Mở rộng: Repository & Service

Trong project thực tế, ta thêm 2 layer nữa:

| Layer | Vai trò | File ví dụ |
|-------|---------|-----------|
| **Repository** | Truy xuất dữ liệu từ database (CRUD) | `product.repository.js` |
| **Service** | Xử lý logic nghiệp vụ (business logic) | `product.service.js` |

**Flow hoàn chỉnh:**

```
Client Request → Routes → Controller → Service → Repository → Model (Database)
                                                                    ↓
Client Response ← Routes ← Controller ← Service ← Repository ← Data
```

### RESTful API là gì?

**REST (Representational State Transfer)** là quy ước thiết kế API:

| HTTP Method | Mục đích | Ví dụ |
|-------------|----------|-------|
| `GET` | Lấy dữ liệu | `GET /api/products` |
| `POST` | Tạo mới | `POST /api/products` |
| `PUT` | Cập nhật toàn bộ | `PUT /api/products/1` |
| `PATCH` | Cập nhật 1 phần | `PATCH /api/products/1` |
| `DELETE` | Xóa | `DELETE /api/products/1` |

---

## 2. Cấu Trúc Thư Mục

```
node_project/
├── server.js                    ← Entry point - khởi chạy server
├── .env                         ← Biến môi trường (PORT, DB_URL,...)
├── package.json                 ← Dependencies & scripts
│
├── src/                         ← Source code chính
│   ├── app.js                   ← Cấu hình Express app
│   │
│   ├── models/                  ← Tầng Model: cấu trúc dữ liệu
│   │   └── product.model.js
│   │
│   ├── repositories/            ← Tầng Repository: truy xuất database
│   │   └── product.repository.js
│   │
│   ├── services/                ← Tầng Service: business logic
│   │   └── product.service.js
│   │
│   ├── controllers/             ← Tầng Controller: xử lý request/response
│   │   └── product.controller.js
│   │
│   └── routes/                  ← Tầng Routes: định nghĩa endpoints
│       └── product.routes.js
│
└── public/                      ← Frontend static files
    ├── index.html               ← Trang chủ - danh sách sản phẩm
    ├── product_info.html        ← Trang chi tiết sản phẩm
    ├── css/
    │   └── styles.css
    └── js/
        ├── main.js              ← JS cho trang chủ
        └── product_info.js      ← JS cho trang chi tiết
```

---

## 3. Cài Đặt Project Từ Đầu

### Bước 1: Khởi tạo project

```bash
# Tạo thư mục project
mkdir node_project
cd node_project

# Khởi tạo package.json
npm init -y
```

`npm init -y` tạo file `package.json` — file "hộ chiếu" của project, chứa thông tin project và danh sách dependencies.

### Bước 2: Cài đặt dependencies

```bash
# Express - framework web cho Node.js
npm install express

# Dotenv - đọc biến môi trường từ file .env
npm install dotenv
```

**Tại sao cần dotenv?** Để tách các config nhạy cảm (PORT, DB password, API keys...) ra khỏi code. File `.env` KHÔNG được push lên Git.

### Bước 3: Tạo cấu trúc thư mục

```bash
# Tạo các thư mục theo kiến trúc MVC
mkdir src
mkdir src/models
mkdir src/repositories
mkdir src/services
mkdir src/controllers
mkdir src/routes
mkdir public
mkdir public/css
mkdir public/js
```

### Bước 4: Tạo file .env

```env
PORT=3000
```

### Bước 5: Tạo server.js (Entry Point)

```javascript
// server.js - Điểm khởi chạy ứng dụng
require("dotenv").config();          // Load biến môi trường từ .env
const app = require("./src/app");    // Import Express app

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server đang chạy tại: http://localhost:${PORT}`);
});
```

**Tại sao tách `server.js` và `app.js`?**
- `app.js` = cấu hình Express (middleware, routes)
- `server.js` = khởi chạy server (listen)
- Khi viết unit test, bạn chỉ cần import `app.js` mà không cần chạy server thật

### Bước 6: Tạo app.js (Express Configuration)

```javascript
// src/app.js
const express = require("express");
const path = require("path");

const productRoutes = require("./routes/product.routes");
const app = express();

// Middleware: parse JSON body
app.use(express.json());

// Middleware: serve static files từ thư mục public
app.use(express.static(path.join(__dirname, "../public")));

// Mount routes
app.use("/api/products", productRoutes);

module.exports = app;
```

**`app.use("/api/products", productRoutes)`** có nghĩa:
- Mọi request bắt đầu bằng `/api/products` sẽ vào `productRoutes`
- Trong `productRoutes`, `router.get("/")` tương đương `GET /api/products`
- `router.get("/info/:slug")` tương đương `GET /api/products/info/:slug`

---

## 4. Giải Thích Từng Layer trong MVC

### 4.1. Model — Dữ liệu

```javascript
// src/models/product.model.js
const products = [
    { id: 1, name: "iPhone 16", slug: "iphone-16", price: 34990000, ... },
    { id: 2, name: "Samsung S25", slug: "samsung-s25", price: 33990000, ... },
];
module.exports = products;
```

- **Trong project thật:** Model sẽ là Mongoose Schema (MongoDB) hoặc Sequelize Model (MySQL)
- **Ở đây:** Dùng mảng JavaScript để đơn giản hóa, tập trung học routing

### 4.2. Repository — Truy xuất dữ liệu

```javascript
// src/repositories/product.repository.js
const products = require("../models/product.model");

const getAllProducts = () => {
    // Trả về toàn bộ mảng products
};

const getProductBySlug = (slug) => {
    // Dùng Array.find() tìm sản phẩm theo slug
};
```

**Tại sao cần Repository?**
- Tách biệt phần truy vấn dữ liệu ra khỏi logic
- Khi đổi database (từ mảng → MongoDB), chỉ cần sửa Repository, không ảnh hưởng Service

### 4.3. Service — Business Logic

```javascript
// src/services/product.service.js
const productRepository = require("../repositories/product.repository");

const getProductBySlug = (slug) => {
    // 1. Gọi repository lấy dữ liệu
    // 2. Kiểm tra: nếu không tìm thấy → throw Error
    // 3. Nếu tìm thấy → return sản phẩm
};
```

**Tại sao cần Service?**
- Chứa logic nghiệp vụ: validation, xử lý lỗi, format dữ liệu
- Giúp Controller "gọn gàng" — Controller chỉ nhận request và trả response

### 4.4. Controller — Điều phối

```javascript
// src/controllers/product.controller.js
const productService = require("../services/product.service");

const getProductInfo = (req, res) => {
    // 1. Lấy slug từ req.params.slug
    // 2. Gọi service
    // 3. Trả JSON response: res.json({ success: true, data: product })
    // 4. Nếu lỗi: res.status(404).json({ success: false, message: ... })
};
```

**Controller KHÔNG chứa logic!** Chỉ:
1. Nhận request (`req`)
2. Gọi Service xử lý
3. Trả response (`res`)

### 4.5. Routes — Định tuyến

```javascript
// src/routes/product.routes.js
const router = express.Router();
const productController = require("../controllers/product.controller");

router.get("/", productController.getAll);
router.get("/info/:slug", productController.getProductInfo);

module.exports = router;
```

---

## 5. Routing trong Express

### 5.1. Route cơ bản

```javascript
// Method + Path = Route
router.get("/", handler);           // GET /api/products
router.post("/", handler);          // POST /api/products
router.put("/:id", handler);        // PUT /api/products/123
router.delete("/:id", handler);     // DELETE /api/products/123
```

### 5.2. Route Parameters (`:slug`)

Đây là phần **quan trọng nhất** của project này:

```javascript
// Định nghĩa route với parameter
router.get("/info/:slug", productController.getProductInfo);
```

Khi client gọi: `GET /api/products/info/iphone-16-pro-max`

```javascript
// Trong controller, lấy parameter:
const slug = req.params.slug;   // "iphone-16-pro-max"
```

**`:slug` là Route Parameter** — giá trị động trong URL. Express tự động parse và đưa vào `req.params`.

### 5.3. Query String (`?key=value`)

Ngoài Route Params, còn có **Query String** — truyền dữ liệu qua URL sau dấu `?`:

```
URL: /product_info.html?slug=iphone-16-pro-max&color=blue
```

```javascript
// Trong JavaScript (frontend):
const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get("slug");    // "iphone-16-pro-max"
const color = urlParams.get("color");  // "blue"
```

### 5.4. So sánh Route Params vs Query String

| | Route Params | Query String |
|---|---|---|
| **Cú pháp URL** | `/products/info/iphone` | `/products?slug=iphone` |
| **Cách lấy** | `req.params.slug` | `req.query.slug` |
| **Dùng khi** | Xác định TÀI NGUYÊN | Lọc, tìm kiếm, phân trang |
| **Bắt buộc?** | Có (phần của URL) | Không (optional) |

### 5.5. Static Files Routing

```javascript
app.use(express.static(path.join(__dirname, "../public")));
```

Express tự động serve file từ thư mục `public/`:
- `http://localhost:3000/index.html` → `public/index.html`
- `http://localhost:3000/css/styles.css` → `public/css/styles.css`

---

## 6. Flow Dữ Liệu Từ Request → Response

### Ví dụ: User click "View" trên card iPhone

```
1. [Frontend] User click nút View
   → Browser chuyển đến: /product_info.html?slug=iphone-16-pro-max

2. [Frontend] product_info.js chạy:
   → Lấy slug từ URL: "iphone-16-pro-max"
   → Gọi fetch("/api/products/info/iphone-16-pro-max")

3. [Routes] Express match route:
   → GET /api/products/info/:slug
   → Gọi productController.getProductInfo

4. [Controller] getProductInfo(req, res):
   → req.params.slug = "iphone-16-pro-max"
   → Gọi productService.getProductBySlug("iphone-16-pro-max")

5. [Service] getProductBySlug("iphone-16-pro-max"):
   → Gọi productRepository.getProductBySlug("iphone-16-pro-max")
   → Kiểm tra: tìm thấy? → return product

6. [Repository] getProductBySlug("iphone-16-pro-max"):
   → products.find(p => p.slug === "iphone-16-pro-max")
   → Return object iPhone 16

7. [Ngược lại] Repository → Service → Controller
   → Controller gọi: res.json({ success: true, data: product })

8. [Frontend] Nhận JSON response
   → Render HTML chi tiết sản phẩm lên trang
```

---

## 7. Cách Chạy Project

```bash
# 1. Di chuyển vào thư mục project
cd node_project

# 2. Cài dependencies (nếu chưa)
npm install

# 3. Chạy server
node server.js

# 4. Mở trình duyệt
# → http://localhost:3000           (Trang chủ)
# → http://localhost:3000/index.html (Trang chủ)
```

### Test API bằng trình duyệt hoặc Postman

```
GET http://localhost:3000/api/products
GET http://localhost:3000/api/products/info/iphone-16-pro-max
GET http://localhost:3000/api/products/info/samsung-galaxy-s25-ultra
GET http://localhost:3000/api/products/info/macbook-pro-m4
```

---

## 📝 Bài Tập

Tất cả các hàm xử lý chính trong project đều **để trống body** và có **comment gợi ý**. Hãy hoàn thành theo thứ tự:

### Thứ tự hoàn thành (từ dưới lên trên theo kiến trúc):

1. **`src/repositories/product.repository.js`**
   - `getAllProducts()` — trả về mảng products
   - `getProductBySlug(slug)` — tìm product theo slug

2. **`src/services/product.service.js`**
   - `getAllProducts()` — gọi repository
   - `getProductBySlug(slug)` — gọi repository + xử lý not found

3. **`src/controllers/product.controller.js`**
   - `getAll(req, res)` — gọi service, trả JSON
   - `getProductInfo(req, res)` — lấy params, gọi service, trả JSON

4. **`public/js/main.js`**
   - `formatPrice()` — format giá VNĐ
   - `createProductCard()` — tạo HTML card
   - `loadProducts()` — fetch API + render

5. **`public/js/product_info.js`**
   - `getUrlParam()` — lấy query param từ URL
   - `loadProductInfo()` — fetch API + render chi tiết

> **💡 Mẹo:** Sau khi hoàn thành mỗi bước, chạy `node server.js` để test. Nếu lỗi, đọc error message trong terminal sẽ biết lỗi ở đâu!
