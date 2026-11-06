const { storageDirectory } = require("./services/product-image-storage");
const express = require("express");
const path = require("path");

const catalogSeoRoutes = require("./routes/catalog-seo.routes");
// Import Routes
const productRoutes = require("./routes/product.routes");
const checkoutRoutes = require("./routes/checkout.routes");
const orderRoutes = require("./routes/order.routes");
const cartRoutes = require("./routes/cart.routes");
const adminRoutes = require("./routes/admin.routes");
const authRoutes = require("./routes/auth.routes");
const paymentRoutes = require("./routes/payment.routes");
const voucherRoutes = require("./routes/voucher.routes");
const { parseCookies, ensureCsrfCookie, attachUser } = require("./middlewares/auth");

const app = express();

// Behind a reverse proxy (e.g. Railway) set TRUST_PROXY to the number of proxy hops
// so req.ip is the customer's address, which VNPay requires. Unset = trust none.
if (/^[1-9]\d*$/.test(process.env.TRUST_PROXY || "")) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY));
}

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(parseCookies);
app.use(ensureCsrfCookie);
app.use(attachUser);
app.use("/uploads/products", express.static(storageDirectory(), { fallthrough: false, index: false }));
app.use(express.static(path.join(__dirname, "../public")));
app.use("/", catalogSeoRoutes);


// ===== ROUTES =====
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);         // Cart domain — validate & shipping
app.use("/api", checkoutRoutes);          // Checkout domain — mua ngay + giỏ hàng
app.use("/api/orders", orderRoutes);      // Order domain — tra cứu + quản lý
app.use("/api/admin", adminRoutes);
app.use("/api/vouchers", voucherRoutes); // Voucher quote for cart/checkout
app.use("/api/payments", paymentRoutes); // Provider callbacks and customer payment attempts

app.get("/", (req, res) => {
    res.json({ message: "Welcome to Digi-Shop API" });
});

module.exports = app;
