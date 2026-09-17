// ===== CATEGORY ROUTES =====

const express = require("express");
const categoryController = require("../controllers/category.controller");

const router = express.Router();

// [GET] /api/categories — public category list for storefront/dropdowns.
router.get("/", categoryController.getAll);

module.exports = router;
