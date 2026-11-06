const express = require("express");
const controller = require("../controllers/catalog-seo.controller");
const router = express.Router();
router.get("/danh-muc/:category", controller.category);
router.get("/the/:tag", controller.tag);
router.get("/sitemap.xml", controller.sitemap);
router.get("/robots.txt", controller.robots);
module.exports = router;
