const express = require("express");
const path = require("path");

// Import Routes
const productRoutes = require("./routes/product.routes");
const checkoutRoutes = require("./routes/checkout.routes");

const app = express();

// ===== MIDDLEWARE =====
// Parse JSON body từ request
app.use(express.json());

// Serve static files (HTML, CSS, JS) từ thư mục "public"
app.use(express.static(path.join(__dirname, "../public")));

// ===== ROUTES =====
// Mount routes - gắn routes vào các prefix URL
app.use("/api/products", productRoutes);
app.use("/api", checkoutRoutes);

// Route mặc định
app.get("/", (req, res) => {
    res.json({ message: "Welcome to Node.js MVC API" });
});

module.exports = app;