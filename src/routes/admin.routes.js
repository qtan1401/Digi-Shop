// ===== ADMIN CATALOG ROUTES =====
// Every route in this router is protected by the session-backed admin middleware.

const express = require("express");
const { requireRole, requireCsrf } = require("../middlewares/auth");
const adminController = require("../controllers/admin.controller");
const { uploadProductImages } = require("../middlewares/product-image-upload");

const router = express.Router();

router.use(requireRole("admin"));
router.post("/accounts", requireCsrf, adminController.createAccount);


// Static restore endpoint is intentionally declared before /products/:id.
// The :id/restore form is the documented restore contract; the static form accepts { productId }.
router.post("/products/restore", requireCsrf, adminController.restoreProduct);
router.post("/products/:id/restore", requireCsrf, adminController.restoreProduct);

// Product endpoints.
router.get("/products", adminController.listProducts);
router.get("/products/:id", adminController.getProduct);
router.post("/products", requireCsrf, uploadProductImages, adminController.createProduct);
router.put("/products/:id", requireCsrf, uploadProductImages, adminController.updateProduct);

// Audit trail.
router.get("/audit-logs", adminController.listAuditLogs);

module.exports = router;
