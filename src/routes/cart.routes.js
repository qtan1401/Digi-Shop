// ===== CART ROUTES =====
// Guest validation/shipping remain public; account cart state is user-scoped.

const express = require("express");
const cartController = require("../controllers/cart.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

// Guest endpoints — preserve existing validation and shipping behavior.
router.post("/validate", cartController.validateCart);
router.post("/shipping", cartController.getShippingFee);

// Account cart endpoints derive identity exclusively from req.user.id.
router.get("/", requireRole("user"), cartController.getAccountCart);
router.put("/items/:variantId", requireRole("user"), requireCsrf, cartController.setAccountCartQuantity);
router.delete("/items/:variantId", requireRole("user"), requireCsrf, cartController.removeAccountCartItem);
router.post("/merge", requireRole("user"), requireCsrf, cartController.mergeGuestCart);

module.exports = router;
