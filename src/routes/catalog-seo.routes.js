const express = require("express");
const controller = require("../controllers/catalog-seo.controller");
const categoryService = require("../services/category.service");
const tagService = require("../services/tag.service");
const { BRANDS } = require("../../public/js/catalog-taxonomy");
const router = express.Router();
router.get("/api/catalog/taxonomy", async (_req, res) => {
    const [categories, tags] = await Promise.all([categoryService.listCategories(), tagService.listTags()]);
    res.json({ categories, tags, brands: BRANDS });
});
router.get("/danh-muc/:category", controller.category);
router.get("/hang/:brand", controller.brand);
router.get("/the/:tag", controller.tag);
router.get("/sitemap.xml", controller.sitemap);
router.get("/robots.txt", controller.robots);
module.exports = router;
