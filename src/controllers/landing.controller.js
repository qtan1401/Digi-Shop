// ===== LANDING CONTROLLER =====

const landingService = require("../services/landing.service");

/** [GET] /api/landing/highlights: New products, Best sellers and one strip per device type, in one call. */
const getHighlights = async (_req, res) => {
    const data = await landingService.getHighlights();
    res.json({ success: true, data });
};

module.exports = { getHighlights };
