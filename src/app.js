const express = require("express");
const path = require("path");

// Import Routes
const productRoutes = require("./routes/product.routes");
const checkoutRoutes = require("./routes/checkout.routes");
const orderRoutes = require("./routes/order.routes");
const cartRoutes = require("./routes/cart.routes");
const categoryRoutes = require("./routes/category.routes");
const adminRoutes = require("./routes/admin.routes");
const authRoutes = require("./routes/auth.routes");
const { parseCookies, ensureCsrfCookie, attachUser } = require("./middlewares/auth");

const app = express();

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(parseCookies);
app.use(ensureCsrfCookie);
app.use(attachUser);
app.use(express.static(path.join(__dirname, "../public")));


// ===== ROUTES =====
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);         // Cart domain — validate & shipping
app.use("/api", checkoutRoutes);          // Checkout domain — mua ngay + giỏ hàng
app.use("/api/orders", orderRoutes);      // Order domain — tra cứu + quản lý
app.use("/api/categories", categoryRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (req, res) => {
    res.json({ message: "Welcome to Digi-Shop API" });
});

module.exports = app;
