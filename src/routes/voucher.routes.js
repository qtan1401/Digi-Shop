// ===== VOUCHER ROUTES (customer) =====

const express = require("express");
const voucherController = require("../controllers/voucher.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

// [POST] /api/vouchers/quote → price a cart with voucher codes (no reservation)
router.post("/quote", requireRole("user"), requireCsrf, voucherController.quote);

module.exports = router;
