// ===== ADMIN CATALOG ROUTES =====
// Every route in this router is protected by the shared admin-key middleware.

const express = require("express");
const { requireRole } = require("../middlewares/auth");
const adminController = require("../controllers/admin.controller");
const categoryController = require("../controllers/category.controller");

const router = express.Router();

router.use(requireRole("admin"));

// Category endpoints.
router.post("/categories", categoryController.create);
router.delete("/categories/:id", categoryController.remove);

// Static restore endpoint is intentionally declared before /products/:id.
// The :id/restore form is the documented G3 contract; the static form accepts
// { productId, newCategoryId } for clients that submit the id in the body.
router.post("/products/restore", adminController.restoreProduct);
router.post("/products/:id/restore", adminController.restoreProduct);

// Product endpoints.
router.get("/products", adminController.listProducts);
router.get("/products/:id", adminController.getProduct);
router.post("/products", adminController.createProduct);
router.put("/products/:id", adminController.updateProduct);
router.delete("/products/:id", adminController.deleteProduct);

// Audit trail.
router.get("/audit-logs", adminController.listAuditLogs);

module.exports = router;
