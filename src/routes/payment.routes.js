const express = require("express");
const paymentController = require("../controllers/payment.controller");
const { requireRole, requireRoleOrGuestToken, requireCsrf } = require("../middlewares/auth");
const { requireAdminExtras } = require("../middlewares/admin-extras");

const router = express.Router();

router.post("/momo/callback", paymentController.momoCallback);
router.get("/vnpay/ipn", paymentController.vnpayIpn);
router.get("/attempts/:id", requireRoleOrGuestToken("user"), paymentController.getAttempt);
router.post("/orders/:orderId/attempts", requireRoleOrGuestToken("user"), requireCsrf, paymentController.createRetry);
router.get("/reconciliation", requireRole("admin"), requireAdminExtras, paymentController.listReconciliation);

module.exports = router;
