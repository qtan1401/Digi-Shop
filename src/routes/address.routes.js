const express = require("express");
const controller = require("../controllers/address.controller");
const { requireRole, requireCsrf } = require("../middlewares/auth");

const router = express.Router();

router.use(requireRole("user"));
router.get("/", controller.list);
router.post("/", requireCsrf, controller.create);
router.put("/:id", requireCsrf, controller.update);
router.delete("/:id", requireCsrf, controller.remove);
router.post("/:id/default", requireCsrf, controller.setDefault);

module.exports = router;
