// ===== checkout ROUTES =====
// Đây là tầng Routes - định nghĩa các endpoint (URL) và kết nối với Controller
// Routes quyết định: Khi client gọi URL nào → chạy hàm nào trong Controller

const express = require("express");
const checkoutController = require("../controllers/checkout.controller");

const router = express.Router();

router.post("/checkout/:id", checkoutController.checkProductinStock);

module.exports = router;
