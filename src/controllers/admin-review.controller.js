// ===== ADMIN REVIEW CONTROLLER =====
// HTTP orchestration for review moderation.

const reviewService = require("../services/review.service");
const { sendReviewError } = require("./review.controller");

/** [GET] /api/admin/reviews */
const list = async (req, res) => {
    try {
        const result = await reviewService.listAdminReviews(req.query);
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendReviewError(res, error);
    }
};

/** [PATCH] /api/admin/reviews/:id */
const setHidden = async (req, res) => {
    try {
        const data = await reviewService.setReviewHidden(req.params.id, req.body, req.user && req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return sendReviewError(res, error);
    }
};

module.exports = { list, setHidden };
