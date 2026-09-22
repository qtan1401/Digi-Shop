const express = require("express");
const controller = require("../controllers/auth.controller");
const { requireAuth, requireCsrf, requireGoogleCsrf, rateLimitAuth } = require("../middlewares/auth");

const router = express.Router();

router.post("/register", requireCsrf, controller.register);
router.post("/verify-email", requireCsrf, controller.verifyEmail);
router.post("/resend-verification", rateLimitAuth("resend"), requireCsrf, controller.resendVerification);
router.post("/login", rateLimitAuth("login"), requireCsrf, controller.login);
router.post("/google", rateLimitAuth("login"), requireGoogleCsrf, controller.loginGoogle);
router.post("/refresh", rateLimitAuth("refresh"), requireCsrf, controller.refresh);
router.post("/logout", requireCsrf, controller.logout);
router.get("/session", controller.session);
router.post("/recover", rateLimitAuth("recover"), requireCsrf, controller.recover);
router.post("/change-password", requireAuth, requireCsrf, controller.changePassword);

module.exports = router;
