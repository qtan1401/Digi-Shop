// ===== LANDING ROUTES =====
// Mounted at /api/landing. Public: the landing page works without signing in.

const express = require("express");
const controller = require("../controllers/landing.controller");

const router = express.Router();

router.get("/highlights", controller.getHighlights);

module.exports = router;
