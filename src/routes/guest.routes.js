// ===== GUEST ROUTES =====
// Purchases without signing in. They create accounts and send mail, so each one is rate limited (per IP and per email)
// and CSRF protected. Mounted at /api/guest; bodies are the signed-in ones plus a required `email`.

const express = require("express");
const checkoutController = require("../controllers/checkout.controller");
const voucherController = require("../controllers/voucher.controller");
const { requireCsrf, rateLimitAuth } = require("../middlewares/auth");

const router = express.Router();

const checkoutGuard = [rateLimitAuth("guestCheckout"), requireCsrf];

// [POST] /api/guest/vouchers/quote → price a cart with voucher codes (no reservation)
router.post("/vouchers/quote", rateLimitAuth("guestQuote"), requireCsrf, voucherController.guestQuote);

// [POST] /api/guest/checkout/batch → whole cart (before /:id)
router.post("/checkout/batch", ...checkoutGuard, checkoutController.guestCartCheckout);

// [POST] /api/guest/checkout/:id and /api/guest/checkout → buy now
router.post("/checkout/:id", ...checkoutGuard, checkoutController.guestProcessCheckout);
router.post("/checkout", ...checkoutGuard, checkoutController.guestProcessCheckout);

module.exports = router;
