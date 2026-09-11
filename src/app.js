const express = require("express");
const path = require("path");

// Import Routes
const productRoutes = require("./routes/product.routes");
const checkoutRoutes = require("./routes/checkout.routes");
const orderRoutes = require("./routes/order.routes");
const cartRoutes = require("./routes/cart.routes");

const app = express();

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ===== ROUTES =====
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);         // Cart domain — validate & shipping
app.use("/api", checkoutRoutes);          // Checkout domain — mua ngay + giỏ hàng
app.use("/api/orders", orderRoutes);      // Order domain — tra cứu + quản lý

app.get("/", (req, res) => {
    res.json({ message: "Welcome to Digi-Shop API" });
});

module.exports = app;
