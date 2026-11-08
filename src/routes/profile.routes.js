const express = require("express");
const controller = require("../controllers/auth.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

router.get("/", requireRole("user"), controller.getProfile);
router.put("/", requireRole("user"), requireCsrf, controller.updateProfile);

module.exports = router;
