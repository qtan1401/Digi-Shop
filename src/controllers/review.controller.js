// ===== REVIEW CONTROLLER =====
// HTTP orchestration for customer-facing Product review endpoints.

const reviewService = require("../services/review.service");

const sendReviewError = (res, error) => {
    if (!(error instanceof reviewService.ReviewError)) throw error;
    const body = { code: error.code, message: error.message };
    if (error.errors.length) body.errors = error.errors;
    return res.status(error.statusCode).json({ success: false, error: body });
};

const handle = (work) => async (req, res) => {
    try {
        return await work(req, res);
    } catch (error) {
        return sendReviewError(res, error);
    }
};

/** [GET] /api/products/:id/reviews */
const list = handle(async (req, res) => {
    const result = await reviewService.listProductReviews(req.params.id, req.query);
    return res.json({ success: true, ...result });
});

/** [GET] /api/products/:id/reviews/mine */
const getMine = handle(async (req, res) => {
    const data = await reviewService.getMyReview(req.params.id, req.user);
    return res.json({ success: true, data });
});

/** [POST] /api/products/:id/reviews */
const create = handle(async (req, res) => {
    const data = await reviewService.createReview(req.params.id, req.user, req.body);
    return res.status(201).json({ success: true, data });
});

/** [PUT] /api/products/:id/reviews/mine */
const updateMine = handle(async (req, res) => {
    const data = await reviewService.updateMyReview(req.params.id, req.user, req.body);
    return res.json({ success: true, data });
});

/** [DELETE] /api/products/:id/reviews/mine */
const removeMine = handle(async (req, res) => {
    await reviewService.deleteMyReview(req.params.id, req.user);
    return res.json({ success: true });
});

module.exports = { list, getMine, create, updateMine, removeMine, sendReviewError };
