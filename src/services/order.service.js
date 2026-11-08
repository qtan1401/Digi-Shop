// ===== ORDER SERVICE =====
// Business logic cho tra cứu và quản lý đơn hàng.

const orderRepository = require("../repositories/order.repository");
const reviewRepository = require("../repositories/review.repository");
const { NodemailerSmtpMailer } = require("../auth/mailer");
const { tokenMatches } = require("./guest-access");

const VALID_ORDER_STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
const VALID_PAYMENT_STATUSES = ["UNPAID", "PAID", "REFUNDED"];

// Keep the existing enum while preventing backwards/terminal state changes.
const ORDER_STATUS_TRANSITIONS = Object.freeze({
    PENDING: ["PENDING", "PROCESSING", "CANCELLED"],
    PROCESSING: ["PROCESSING", "SHIPPED", "CANCELLED"],
    SHIPPED: ["SHIPPED", "DELIVERED"],
    DELIVERED: ["DELIVERED"],
    CANCELLED: ["CANCELLED"]
});

const domainError = (code, statusCode, message) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
};

/**
 * Lấy chi tiết đơn hàng theo mã, chỉ cho chủ đơn, người giữ guest access token của đơn, hoặc Admin.
 * The repository owner field is requested only for this authorization check
 * and is removed before the order leaves the service boundary. A wrong guest token is
 * indistinguishable from an unknown order (404).
 */
const getOrderById = async (orderId, actor, { guestToken } = {}) => {
    if (!orderId) throw domainError("ORDER_NOT_FOUND", 404, "Không tìm thấy đơn hàng");
    const hasActor = Boolean(actor && actor.id);
    if (!hasActor && !guestToken) throw domainError("AUTH_REQUIRED", 401, "Authentication is required");

    const order = await orderRepository.getOrderById(orderId, { includeUserId: true, includeGuestAccess: true });
    if (!order) throw domainError("ORDER_NOT_FOUND", 404, "Không tìm thấy đơn hàng");

    const isAdmin = hasActor && actor.role === "admin";
    const isOwner = hasActor && Boolean(order.userId) && String(order.userId) === String(actor.id);
    const holdsToken = tokenMatches(guestToken, order.guestAccessTokenHash);
    if (!isAdmin && !isOwner && !holdsToken) {
        throw domainError("ORDER_NOT_FOUND", 404, "Không tìm thấy đơn hàng");
    }

    delete order.userId;
    delete order.customerEmail;
    delete order.guestAccessTokenHash;

    // Review state is for the owner only; administrators and guests viewing an order never get it.
    if (isOwner && !isAdmin && order.orderStatus === "DELIVERED") {
        const productIds = [...new Set(order.items.map((item) => item.productId).filter((id) => id !== undefined))];
        const ratings = await reviewRepository.findOwnRatings(String(actor.id), productIds);
        for (const item of order.items) {
            item.review = ratings.has(item.productId)
                ? { exists: true, rating: ratings.get(item.productId) }
                : { exists: false, rating: null };
        }
    }
    return order;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 1000000;

const parsePositive = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        throw domainError("INVALID_PAGINATION", 400, "Tham số phân trang không hợp lệ");
    }
    const parsed = Number(value);
    if (parsed > maximum) throw domainError("INVALID_PAGINATION", 400, "Tham số phân trang không hợp lệ");
    return parsed;
};

/**
 * The signed-in customer's own orders, newest first. Scoped by actor.id only;
 * the counts cover all of the customer's orders whatever the status filter.
 */
const listMyOrders = async (actor, query = {}) => {
    if (!actor || !actor.id) throw domainError("AUTH_REQUIRED", 401, "Authentication is required");

    const status = query.status === undefined ? "all" : query.status;
    if (status !== "all" && !VALID_ORDER_STATUSES.includes(status)) {
        throw domainError("INVALID_FILTER", 400, "Bộ lọc không hợp lệ");
    }
    const requestedPage = parsePositive(query.page, 1, MAX_PAGE);
    const pageSize = parsePositive(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const userId = String(actor.id);
    const counts = await orderRepository.countByStatus(userId);
    const total = counts[status];
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);

    const data = total === 0
        ? []
        : await orderRepository.listByUser(userId, {
            status: status === "all" ? undefined : status,
            skip: (page - 1) * pageSize,
            take: pageSize
        });
    return { data, meta: { page, pageSize, total, totalPages, counts } };
};

/**
 * Lấy toàn bộ danh sách đơn hàng (Admin route).
 */
const getAllOrders = async () => await orderRepository.getAllOrders();

/**
 * Cập nhật trạng thái đơn hàng (orderStatus).
 * @param {string} orderId
 * @param {string} status
 */
const updateOrderStatus = async (orderId, status) => {
    if (!VALID_ORDER_STATUSES.includes(status)) {
        throw domainError(
            "INVALID_ORDER_STATUS",
            400,
            `Trạng thái đơn hàng không hợp lệ. Hợp lệ: ${VALID_ORDER_STATUSES.join(", ")}`
        );
    }

    const current = await orderRepository.getOrderById(orderId);
    if (!current) throw domainError("ORDER_NOT_FOUND", 404, "Không tìm thấy đơn hàng");

    const allowed = ORDER_STATUS_TRANSITIONS[current.orderStatus] || [];
    if (!allowed.includes(status)) {
        throw domainError(
            "INVALID_ORDER_TRANSITION",
            400,
            `Không thể chuyển trạng thái đơn hàng từ ${current.orderStatus} sang ${status}`
        );
    }
    if (current.orderStatus === status) return current;

    const order = await orderRepository.updateOrderStatus(orderId, status);
    if (!order) throw domainError("ORDER_NOT_FOUND", 404, "Không tìm thấy đơn hàng");
    return order;
};

/**
 * Admin payment-status override. Provider-owned payment updates are processed
 * through the payment service and its verified callbacks.
 */
const updatePaymentStatus = async (orderId, status) => {
    if (!VALID_PAYMENT_STATUSES.includes(status)) {
        throw domainError(
            "INVALID_PAYMENT_STATUS",
            400,
            `Trạng thái thanh toán không hợp lệ. Hợp lệ: ${VALID_PAYMENT_STATUSES.join(", ")}`
        );
    }
    const order = await orderRepository.updatePaymentStatus(orderId, status);
    if (!order) throw domainError("ORDER_NOT_FOUND", 404, "Không tìm thấy đơn hàng");
    return order;
};

/**
 * Who receives the confirmation: the email stored on a guest Order, otherwise the owner's account email.
 * Returning null skips the email.
 */
const resolveConfirmationRecipient = async (order) => order.customerEmail || orderRepository.getOwnerEmail(order.userId);

/**
 * Order confirmation email. The returned function never rejects: a missing owner is skipped and any
 * failure (SMTP down, mailer not configured) is logged, so callers can fire it after their transaction
 * commits without it ever failing a checkout or a payment callback. Like the auth service, the mailer
 * is injectable and created lazily.
 */
const createOrderConfirmationSender = ({ repository = orderRepository, mailer, resolveRecipient = resolveConfirmationRecipient, logger = console } = {}) => {
    // Built on first use and reused; a failed construction is not cached, so the next email tries again.
    let created;
    const getMailer = () => mailer || (created ||= new NodemailerSmtpMailer());
    return async (orderId) => {
        try {
            const order = await repository.getOrderById(orderId, { includeUserId: true });
            if (!order) return false;
            const to = await resolveRecipient(order);
            if (!to) return false;
            await getMailer().sendOrderConfirmationEmail({ to, order });
            return true;
        } catch (error) {
            logger.error(`Order confirmation email for ${orderId} failed:`, error?.message || error);
            return false;
        }
    };
};

const sendOrderConfirmation = createOrderConfirmationSender();

module.exports = {
    createOrderConfirmationSender,
    sendOrderConfirmation, getOrderById, listMyOrders, getAllOrders, updateOrderStatus, updatePaymentStatus };
