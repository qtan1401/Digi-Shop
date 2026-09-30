// ===== ADMIN CATALOG ROUTES =====
// Every route in this router is protected by the session-backed admin middleware.

const express = require("express");
const { requireRole, requireCsrf } = require("../middlewares/auth");
const adminController = require("../controllers/admin.controller");
const categoryController = require("../controllers/category.controller");

const router = express.Router();

router.use(requireRole("admin"));
router.post("/accounts", requireCsrf, adminController.createAccount);

// Category endpoints.
router.post("/categories", requireCsrf, categoryController.create);
router.delete("/categories/:id", requireCsrf, categoryController.remove);

// Static restore endpoint is intentionally declared before /products/:id.
// The :id/restore form is the documented G3 contract; the static form accepts
// { productId, newCategoryId } for clients that submit the id in the body.
router.post("/products/restore", requireCsrf, adminController.restoreProduct);
router.post("/products/:id/restore", requireCsrf, adminController.restoreProduct);

// Product endpoints.
router.get("/products", adminController.listProducts);
router.get("/products/:id", adminController.getProduct);
router.post("/products", requireCsrf, adminController.createProduct);
router.put("/products/:id", requireCsrf, adminController.updateProduct);
router.delete("/products/:id", requireCsrf, adminController.deleteProduct);

// Audit trail.
router.get("/audit-logs", adminController.listAuditLogs);

module.exports = router;
