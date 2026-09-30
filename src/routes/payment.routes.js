const express = require("express");
const paymentController = require("../controllers/payment.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

router.post("/momo/callback", paymentController.momoCallback);
router.get("/vnpay/ipn", paymentController.vnpayIpn);
router.get("/attempts/:id", requireRole("user"), paymentController.getAttempt);
router.post("/orders/:orderId/attempts", requireRole("user"), requireCsrf, paymentController.createRetry);
router.get("/reconciliation", requireRole("admin"), paymentController.listReconciliation);

module.exports = router;
