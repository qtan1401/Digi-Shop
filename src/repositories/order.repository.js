// ===== ORDER REPOSITORY =====
// Prisma persistence only; checkout sequencing remains in the checkout service.

const { getPrismaClient } = require("../db/prisma");
const voucherRepository = require("./voucher.repository");
const loyaltyRepository = require("./loyalty.repository");

const CANCELLABLE_STATUSES = ["PENDING", "PROCESSING"];

const toIsoString = (value) =>
    value === undefined || value === null
        ? value
        : value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString();

const toDate = (value) =>
    value === undefined || value === null || value instanceof Date
        ? value
        : new Date(value);

const toNumber = (value) =>
    value === undefined || value === null ? value : Number(value);

const parseOptions = (value) => {
    if (value && typeof value === "object") return value;
    try {
        return JSON.parse(value || "{}");
    } catch {
        return {};
    }
};

const mapOrderItem = (row) => {
    const item = {
        variantId: toNumber(row.variantId),
        sku: row.skuSnapshot,
        options: parseOptions(row.optionsSnapshot),
        name: row.nameSnapshot,
        image: row.imageSnapshot,
        unitPrice: toNumber(row.unitPrice),
        quantity: row.quantity,
        lineTotal: toNumber(row.lineTotal)
    };
    // Only present when the variant->product link was loaded (detail reads).
    if (row.variant) {
        item.productId = toNumber(row.variant.productId);
        item.productAvailable = Boolean(row.variant.product) && row.variant.product.isDeleted !== true;
    }
    return item;
};


/**
 * An order that has no stored history (it predates the table and was never backfilled, or was inserted around it) still
 * gets a timeline from what it does record: placed as PENDING, and the current status at the last change. Newest first.
 */
const legacyStatusHistory = (row) => {
    const timeline = [];
    if (row.orderStatus !== "PENDING") {
        timeline.push({ status: row.orderStatus, at: toIsoString(row.cancelledAt && row.orderStatus === "CANCELLED" ? row.cancelledAt : row.updatedAt) });
    }
    timeline.push({ status: "PENDING", at: toIsoString(row.createdAt) });
    return timeline;
};

const mapOrder = (row, { includeUserId = false, includeGuestAccess = false } = {}) => {
    if (!row) return undefined;

    const order = {
        id: row.id,
        items: (row.items || []).map(mapOrderItem),
        subtotal: toNumber(row.subtotal),
        shippingFee: toNumber(row.shippingFee),
        discount: toNumber(row.discount),
        pointsRedeemed: row.pointsRedeemed ?? 0,
        pointsDiscount: toNumber(row.pointsDiscount ?? 0),
        pointsEarned: row.pointsEarned ?? 0,
        pointsCredited: Boolean(row.pointsCreditedAt),
        totalPrice: toNumber(row.totalPrice),
        customer: {
            name: row.customerName,
            phone: row.customerPhone,
            address: row.customerAddress,
            note: row.customerNote
        },
        paymentMethod: row.paymentMethod,
        orderStatus: row.orderStatus,
        paymentStatus: row.paymentStatus,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        cancelledAt: row.cancelledAt ? toIsoString(row.cancelledAt) : null
    };
    if (includeUserId) {
        order.userId = row.userId;
        order.customerEmail = row.customerEmail ?? null;
    }
    if (includeGuestAccess) order.guestAccessTokenHash = row.guestAccessTokenHash ?? null;
    // Detail reads only: every status the order entered, most recent first.
    if (row.statusHistory) {
        order.statusHistory = row.statusHistory.length > 0
            ? row.statusHistory.map((entry) => ({ status: entry.status, at: toIsoString(entry.createdAt) }))
            : legacyStatusHistory(row);
    }
    if (row.vouchers) {
        order.vouchers = row.vouchers.map((entry) => ({
            code: entry.codeSnapshot,
            type: entry.typeSnapshot,
            percent: entry.percentSnapshot ?? null,
            amount: toNumber(entry.discountAmount)
        }));
    }
    // Only present on detail reads: the latest payment attempt (stored statuses PENDING, SUCCEEDED, FAILED, EXPIRED,
    // LATE_SUCCESS), with a PENDING attempt past its deadline reported as EXPIRED (the expiry sweep may not have run yet).
    if (row.paymentAttempts) {
        const attempt = row.paymentAttempts[0];
        order.paymentAttempt = attempt
            ? {
                provider: attempt.provider,
                status: attempt.status === "PENDING" && new Date(attempt.expiresAt) <= new Date() ? "EXPIRED" : attempt.status,
                expiresAt: toIsoString(attempt.expiresAt)
            }
            : null;
    }
    return order;
};

const itemsInclude = {
    items: {
        orderBy: { id: "asc" }
    },
    vouchers: {
        orderBy: { voucherId: "asc" }
    }
};

const detailInclude = {
    items: {
        orderBy: { id: "asc" },
        include: {
            variant: { select: { productId: true, product: { select: { isDeleted: true } } } }
        }
    },
    vouchers: {
        orderBy: { voucherId: "asc" }
    },
    statusHistory: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    },
    paymentAttempts: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { provider: true, status: true, expiresAt: true }
    }
};

const createOrder = async (orderData) => {
    const customer = orderData.customer || {};
    const data = {
        id: String(orderData.id),
        subtotal: orderData.subtotal,
        shippingFee: orderData.shippingFee,
        discount: orderData.discount,
        pointsRedeemed: orderData.pointsRedeemed ?? 0,
        pointsDiscount: orderData.pointsDiscount ?? 0,
        pointsEarned: orderData.pointsEarned ?? 0,
        totalPrice: orderData.totalPrice,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        customerNote: customer.note,
        paymentMethod: orderData.paymentMethod,
        orderStatus: orderData.orderStatus,
        paymentStatus: orderData.paymentStatus,
        statusHistory: { create: [{ status: orderData.orderStatus }] },
        items: {
            create: (orderData.items || []).map((item) => ({
                variantId: item.variantId,
                nameSnapshot: item.name,
                imageSnapshot: item.image,
                skuSnapshot: item.sku,
                optionsSnapshot: JSON.stringify(item.options || {}),
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                lineTotal: item.lineTotal
            }))
        }
    };
    if (orderData.createdAt !== undefined) data.createdAt = toDate(orderData.createdAt);
    if (orderData.updatedAt !== undefined) data.updatedAt = toDate(orderData.updatedAt);

    const row = await getPrismaClient().order.create({
        data,
        include: itemsInclude
    });
    return mapOrder(row);
};

const adminOrderWhere = ({ status, paymentStatus, from, to, search } = {}) => {
    const where = {};
    if (status) where.orderStatus = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = from;
        if (to) where.createdAt.lt = to;
    }
    if (search) {
        where.OR = [
            { id: { contains: search } },
            { customerName: { contains: search } },
            { customerPhone: { contains: search } }
        ];
    }
    return where;
};

/** Order counts per status for the admin list, inside the payment filter, date range and search but whatever the status filter. */
const countAllByStatus = async ({ paymentStatus, from, to, search } = {}) => {
    const rows = await getPrismaClient().order.groupBy({
        by: ["orderStatus"],
        where: adminOrderWhere({ paymentStatus, from, to, search }),
        _count: { _all: true }
    });
    const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
    let all = 0;
    for (const row of rows) {
        counts[row.orderStatus] = row._count._all;
        all += row._count._all;
    }
    return { all, ...counts };
};

/** One page of every customer's orders for administrators, newest first, with items and vouchers. */
const listAllOrders = async ({ status, paymentStatus, from, to, search, skip, take }) => {
    const rows = await getPrismaClient().order.findMany({
        where: adminOrderWhere({ status, paymentStatus, from, to, search }),
        include: itemsInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take
    });
    return rows.map((row) => mapOrder(row));
};

const getOrderById = async (id, options = {}) => {
    if (id === undefined || id === null) return undefined;

    const row = await getPrismaClient().order.findUnique({
        where: { id: String(id) },
        include: detailInclude
    });
    return mapOrder(row, options);
};

const ORDER_STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
const LIST_ITEM_PREVIEW = 3;

/** Order counts per status for one user (all statuses, one grouped query). */
const countByStatus = async (userId) => {
    const rows = await getPrismaClient().order.groupBy({
        by: ["orderStatus"],
        where: { userId },
        _count: { _all: true }
    });
    const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
    let all = 0;
    for (const row of rows) {
        counts[row.orderStatus] = row._count._all;
        all += row._count._all;
    }
    return { all, ...counts };
};

/**
 * One page of a user's orders, newest first. Three queries total, independent of page size:
 * the page (with first items), and the quantity sums of the page's orders.
 */
const listByUser = async (userId, { status, skip, take }) => {
    const where = status ? { userId, orderStatus: status } : { userId };
    const rows = await getPrismaClient().order.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        select: {
            id: true,
            createdAt: true,
            orderStatus: true,
            paymentStatus: true,
            paymentMethod: true,
            totalPrice: true,
            items: {
                orderBy: { id: "asc" },
                take: LIST_ITEM_PREVIEW,
                select: { nameSnapshot: true, imageSnapshot: true, optionsSnapshot: true, quantity: true }
            },
            _count: { select: { items: true, vouchers: true } }
        }
    });
    const orderIds = rows.map((row) => row.id);
    const quantities = orderIds.length
        ? await getPrismaClient().orderItem.groupBy({ by: ["orderId"], where: { orderId: { in: orderIds } }, _sum: { quantity: true } })
        : [];
    const quantityByOrder = new Map(quantities.map((row) => [row.orderId, row._sum.quantity || 0]));
    return rows.map((row) => ({
        id: row.id,
        createdAt: toIsoString(row.createdAt),
        orderStatus: row.orderStatus,
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod,
        totalPrice: toNumber(row.totalPrice),
        itemCount: quantityByOrder.get(row.id) || 0,
        lineCount: row._count.items,
        items: row.items.map((item) => ({
            name: item.nameSnapshot,
            image: item.imageSnapshot,
            options: parseOptions(item.optionsSnapshot),
            quantity: item.quantity
        })),
        voucherCount: row._count.vouchers
    }));
};

/** The account email of an order's owner, or null (no owner, or the account is gone). */
const getOwnerEmail = async (userId) => {
    if (userId === undefined || userId === null) return null;
    const user = await getPrismaClient().user.findUnique({ where: { id: String(userId) }, select: { email: true } });
    return user?.email || null;
};

const ONLINE_METHODS = ["MOMO", "VNPAY"];

/**
 * Status / payment-status update. Holds the order-row lock (the one cancelOrder and payment attempts take) and keeps
 * the Loyalty ledger in step in the same transaction:
 * - a transition to DELIVERED credits the earned points (COD / bank transfer; a MoMo/VNPay Order still unpaid earns nothing yet);
 * - a transition to PAID credits them too and re-takes redeemed points that were given back (clamped at 0, never blocks).
 * creditForOrder is idempotent, so DELIVERED after PAID, or a repeat, credits once. Other values change nothing else.
 */
const updateStatus = async (id, data) => {
    if (id === undefined || id === null) return null;

    const orderId = String(id);
    const prisma = getPrismaClient();
    const row = await prisma.$transaction(async (transaction) => {
        const locked = await transaction.$queryRaw`
            SELECT [id] FROM [dbo].[orders] WITH (UPDLOCK, ROWLOCK) WHERE [id] = ${orderId};
        `;
        if (locked.length === 0) return null;
        const before = await transaction.order.findUnique({ where: { id: orderId } });
        const result = await transaction.order.updateMany({
            where: { id: orderId },
            data
        });
        if (result.count === 0) return null;
        if (data.orderStatus) {
            await transaction.orderStatusHistory.create({ data: { orderId, status: data.orderStatus } });
        }
        const now = new Date();
        const status = data.orderStatus ?? before.orderStatus;
        const paymentStatus = data.paymentStatus ?? before.paymentStatus;
        if (status !== "CANCELLED") {
            if (data.paymentStatus === "PAID" && before.paymentStatus !== "PAID") {
                await loyaltyRepository.creditForOrder(transaction, orderId, now);
                await loyaltyRepository.retakeReleasedForOrder(transaction, orderId);
            }
            const unpaidOnline = ONLINE_METHODS.includes(before.paymentMethod) && paymentStatus !== "PAID";
            if (data.orderStatus === "DELIVERED" && before.orderStatus !== "DELIVERED" && !unpaidOnline) {
                await loyaltyRepository.creditForOrder(transaction, orderId, now);
            }
        }
        return transaction.order.findUnique({
            where: { id: orderId },
            include: itemsInclude
        });
    });
    return mapOrder(row);
};

/**
 * Administrator cancel: the status change, the Voucher give-back and the Loyalty points reversal commit together.
 * The order row is locked first (the same lock payment attempts take), so a concurrent
 * attempt expiry cannot interleave; give-back is idempotent through order_vouchers.released_at,
 * so cancelling twice, or cancelling after the attempt expired, gives nothing back twice.
 * Stock is deliberately not restored here (existing behaviour, out of scope).
 */
const cancelOrder = async (id) => {
    if (id === undefined || id === null) return null;
    const orderId = String(id);
    return getPrismaClient().$transaction(async (transaction) => {
        const locked = await transaction.$queryRaw`
            SELECT [id] FROM [dbo].[orders] WITH (UPDLOCK, ROWLOCK) WHERE [id] = ${orderId};
        `;
        if (locked.length === 0) return null;
        const current = await transaction.order.findUnique({ where: { id: orderId } });
        if (!CANCELLABLE_STATUSES.includes(current.orderStatus) && current.orderStatus !== "CANCELLED") {
            const error = new Error(`Không thể chuyển trạng thái đơn hàng từ ${current.orderStatus} sang CANCELLED`);
            error.code = "INVALID_ORDER_TRANSITION";
            error.statusCode = 400;
            throw error;
        }
        if (current.orderStatus !== "CANCELLED") {
            await transaction.order.updateMany({ where: { id: orderId }, data: { orderStatus: "CANCELLED", cancelledAt: new Date() } });
            await transaction.orderStatusHistory.create({ data: { orderId, status: "CANCELLED" } });
        }
        const now = new Date();
        await voucherRepository.releaseForOrder(transaction, orderId, now);
        // Points follow the vouchers: redeemed points go back once, earned points are taken back once (balance clamped at 0).
        await loyaltyRepository.releaseForOrder(transaction, orderId, now);
        await loyaltyRepository.clawBackForOrder(transaction, orderId);
        const row = await transaction.order.findUnique({ where: { id: orderId }, include: itemsInclude });
        return mapOrder(row);
    });
};

const updateOrderStatus = async (id, status) =>
    status === "CANCELLED" ? cancelOrder(id) : updateStatus(id, { orderStatus: status });

const updatePaymentStatus = async (id, status) =>
    updateStatus(id, { paymentStatus: status });

module.exports = {
    createOrder,
    countAllByStatus,
    listAllOrders,
    getOrderById,
    countByStatus,
    getOwnerEmail,
    listByUser,
    updateOrderStatus,
    updatePaymentStatus
};
