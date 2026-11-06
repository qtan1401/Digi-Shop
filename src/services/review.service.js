// ===== REVIEW SERVICE =====
// Business rules for Product reviews: Verified reviewer eligibility, Rating/comment
// validation, one review per customer per Product, moderation and rating aggregates.

const reviewRepository = require("../repositories/review.repository");
const auditRepository = require("../repositories/audit.repository");

const COMMENT_MAX_LENGTH = 1000;
const PUBLIC_PAGE_SIZE_DEFAULT = 5;
const PUBLIC_PAGE_SIZE_MAX = 20;
const ADMIN_PAGE_SIZE_DEFAULT = 20;
const ADMIN_PAGE_SIZE_MAX = 100;
const FALLBACK_USERNAME = "Khach hang";
const MAX_INT32 = 2147483647;

class ReviewError extends Error {
    constructor(code, statusCode, message, errors = []) {
        super(message);
        this.name = "ReviewError";
        this.code = code;
        this.statusCode = statusCode;
        this.errors = errors;
    }
}

const productNotFound = () => new ReviewError("PRODUCT_NOT_FOUND", 404, "Không tìm thấy sản phẩm");
const reviewNotFound = () => new ReviewError("REVIEW_NOT_FOUND", 404, "Không tìm thấy đánh giá");
const reviewExists = () => new ReviewError("REVIEW_EXISTS", 409, "Bạn đã đánh giá sản phẩm này rồi");

const parseId = (value, makeError) => {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw makeError();
    const id = Number(value);
    if (id > MAX_INT32) throw makeError();
    return id;
};

const invalidPagination = () =>
    new ReviewError("INVALID_PAGINATION", 400, "Tham số phân trang không hợp lệ");

const parsePositive = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw invalidPagination();
    const parsed = Number(value);
    if (parsed > maximum) throw invalidPagination();
    return parsed;
};

/** Average of Ratings rounded to one decimal; null when there are none. */
const roundAverage = (sum, count) => count > 0 ? Math.round((sum / count) * 10) / 10 : null;

/**
 * Add ratingAverage / ratingCount to Product objects using a single grouped query.
 * Mutates and returns the same array of products.
 */
const attachRatings = async (products) => {
    const list = products.filter(Boolean);
    const totals = await reviewRepository.getRatingTotals(list.map((product) => product.id));
    for (const product of list) {
        const entry = totals.get(product.id);
        product.ratingAverage = entry ? roundAverage(entry.sum, entry.count) : null;
        product.ratingCount = entry ? entry.count : 0;
    }
    return products;
};

const requireVisibleProduct = async (productIdParam) => {
    const productId = parseId(productIdParam, productNotFound);
    const product = await reviewRepository.findProduct(productId);
    if (!product || product.isDeleted === true) throw productNotFound();
    return productId;
};

const validateReviewInput = (body) => {
    const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const errors = [];
    let rating = null;
    let comment = null;

    if (input.rating !== undefined && input.rating !== null) {
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
            errors.push({ field: "rating", message: "Số sao phải là số nguyên từ 1 đến 5" });
        } else {
            rating = input.rating;
        }
    }
    if (input.comment !== undefined && input.comment !== null) {
        if (typeof input.comment !== "string") {
            errors.push({ field: "comment", message: "Nhận xét không hợp lệ" });
        } else {
            const trimmed = input.comment.trim();
            if (trimmed.length > COMMENT_MAX_LENGTH) {
                errors.push({ field: "comment", message: `Nhận xét tối đa ${COMMENT_MAX_LENGTH} ký tự` });
            } else if (trimmed.length > 0) {
                comment = trimmed;
            }
        }
    }
    if (!errors.length && rating === null && comment === null) {
        errors.push({ field: "rating", message: "Hãy chọn số sao hoặc viết nhận xét" });
    }
    if (errors.length) {
        throw new ReviewError("VALIDATION_FAILED", 422, "Dữ liệu đánh giá không hợp lệ", errors);
    }
    return { rating, comment };
};

const isCustomer = (user) => Boolean(user?.id) && user.role === "user";

const assertCustomer = (user) => {
    if (!isCustomer(user)) throw new ReviewError("FORBIDDEN", 403, "Bạn không có quyền thực hiện thao tác này");
};

// ===== Customer API =====

const listProductReviews = async (productIdParam, query = {}) => {
    const productId = await requireVisibleProduct(productIdParam);
    const page = parsePositive(query.page, 1, MAX_INT32);
    const pageSize = parsePositive(query.pageSize, PUBLIC_PAGE_SIZE_DEFAULT, PUBLIC_PAGE_SIZE_MAX);

    let result = await reviewRepository.listVisible(productId, page, pageSize);
    const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
    let actualPage = page;
    if (page > totalPages) {
        actualPage = totalPages;
        result = await reviewRepository.listVisible(productId, actualPage, pageSize);
    }

    const summary = await reviewRepository.getProductSummary(productId);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let ratingCount = 0;
    for (const { rating, count } of summary.counts) {
        distribution[rating] += count;
        sum += rating * count;
        ratingCount += count;
    }

    return {
        data: result.rows.map(({ username, ...review }) => ({
            ...review,
            username: username || FALLBACK_USERNAME
        })),
        meta: { page: actualPage, pageSize, total: result.total, totalPages },
        summary: {
            ratingAverage: roundAverage(sum, ratingCount),
            ratingCount,
            distribution,
            commentCount: summary.commentCount
        }
    };
};

const getMyReview = async (productIdParam, user) => {
    const productId = await requireVisibleProduct(productIdParam);
    if (!isCustomer(user)) return { eligible: false, hasUsername: false, review: null };
    const [eligible, review] = await Promise.all([
        reviewRepository.hasDeliveredOrderForProduct(user.id, productId),
        reviewRepository.findOwnReview(productId, user.id)
    ]);
    return { eligible, hasUsername: Boolean(user.username), review };
};

const createReview = async (productIdParam, user, body) => {
    assertCustomer(user);
    const productId = await requireVisibleProduct(productIdParam);
    const input = validateReviewInput(body);
    if (!await reviewRepository.hasDeliveredOrderForProduct(user.id, productId)) {
        throw new ReviewError(
            "REVIEW_NOT_ELIGIBLE", 403,
            "Bạn chỉ có thể đánh giá sản phẩm sau khi đơn hàng chứa sản phẩm này đã được giao"
        );
    }
    if (!user.username) {
        throw new ReviewError("USERNAME_REQUIRED", 409, "Bạn cần đặt tên người dùng trước khi đánh giá");
    }
    const review = await reviewRepository.createReview(productId, user.id, input);
    if (!review) throw reviewExists();
    return review;
};

const updateMyReview = async (productIdParam, user, body) => {
    assertCustomer(user);
    const productId = await requireVisibleProduct(productIdParam);
    const input = validateReviewInput(body);
    const review = await reviewRepository.updateOwnReview(productId, user.id, input);
    if (!review) throw reviewNotFound();
    return review;
};

const deleteMyReview = async (productIdParam, user) => {
    assertCustomer(user);
    const productId = await requireVisibleProduct(productIdParam);
    if (!await reviewRepository.deleteOwnReview(productId, user.id)) throw reviewNotFound();
};

// ===== Admin API =====

const HIDDEN_FILTERS = ["all", "visible", "hidden"];

const listAdminReviews = async (query = {}) => {
    const page = parsePositive(query.page, 1, MAX_INT32);
    const pageSize = parsePositive(query.pageSize, ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX);
    const hidden = query.hidden === undefined ? "all" : query.hidden;
    if (!HIDDEN_FILTERS.includes(hidden)) {
        throw new ReviewError("INVALID_FILTER", 400, "Bộ lọc trạng thái không hợp lệ");
    }
    if (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 120)) {
        throw new ReviewError("INVALID_FILTER", 400, "Từ khóa tìm kiếm không hợp lệ");
    }

    const where = {};
    if (query.productId !== undefined) {
        where.productId = parseId(query.productId, () =>
            new ReviewError("INVALID_FILTER", 400, "Mã sản phẩm không hợp lệ"));
    }
    if (hidden !== "all") where.isHidden = hidden === "hidden";
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (q) {
        where.OR = [
            { comment: { contains: q } },
            { user: { username: { contains: q } } },
            { product: { name: { contains: q } } }
        ];
    }

    let result = await reviewRepository.findAdminPage(where, page, pageSize);
    const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
    let actualPage = page;
    if (page > totalPages) {
        actualPage = totalPages;
        result = await reviewRepository.findAdminPage(where, actualPage, pageSize);
    }
    return { data: result.rows, meta: { page: actualPage, pageSize, total: result.total, totalPages } };
};

const setReviewHidden = async (idParam, body, actor) => {
    const id = parseId(idParam, reviewNotFound);
    if (!body || typeof body.isHidden !== "boolean") {
        throw new ReviewError("VALIDATION_FAILED", 422, "Dữ liệu không hợp lệ", [
            { field: "isHidden", message: "isHidden phải là true hoặc false" }
        ]);
    }
    const before = await reviewRepository.findAdminReview(id);
    if (!before) throw reviewNotFound();
    const after = await reviewRepository.setHidden(id, body.isHidden);
    if (!after) throw reviewNotFound();
    await auditRepository.createLog({
        actor: actor || "admin",
        action: after.isHidden ? "HIDE" : "UNHIDE",
        entity: "review",
        entityId: id,
        changes: { isHidden: { old: before.isHidden, new: after.isHidden } }
    });
    return after;
};

module.exports = {
    ReviewError,
    COMMENT_MAX_LENGTH,
    attachRatings,
    listProductReviews,
    getMyReview,
    createReview,
    updateMyReview,
    deleteMyReview,
    listAdminReviews,
    setReviewHidden
};
