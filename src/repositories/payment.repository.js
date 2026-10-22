const { getPrismaClient } = require("../db/prisma");

const ACTIVE = "PENDING";

class PaymentError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "PaymentError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const mapAttempt = (row) => row && ({
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    amount: Number(row.amount),
    status: row.status,
    providerTransactionId: row.providerTransactionId,
    qrPayload: row.qrPayload,
    paymentUrl: row.paymentUrl,
    expiresAt: new Date(row.expiresAt).toISOString(),
    inventoryReleasedAt: row.inventoryReleasedAt ? new Date(row.inventoryReleasedAt).toISOString() : null,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString()
});

const lockOrder = async (transaction, orderId) => {
    const rows = await transaction.$queryRaw`
        SELECT [id]
        FROM [dbo].[orders] WITH (UPDLOCK, ROWLOCK)
        WHERE [id] = ${orderId};
    `;
    if (rows.length === 0) throw new PaymentError("ORDER_NOT_FOUND", "Không tìm thấy đơn hàng", 404);
};

const restoreInventory = async (transaction, orderId) => {
    const items = await transaction.orderItem.findMany({
        where: { orderId },
        orderBy: { variantId: "asc" },
        select: { variantId: true, quantity: true }
    });
    for (const item of items) {
        await transaction.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } }
        });
    }
};


const releaseAttempt = async (transaction, attempt, status, now) => {
    if (attempt.status !== ACTIVE) return attempt;
    const changed = await transaction.paymentAttempt.updateMany({
        where: { id: attempt.id, status: ACTIVE },
        data: { status, inventoryReleasedAt: now, completedAt: now }
    });
    if (changed.count !== 1) return transaction.paymentAttempt.findUnique({ where: { id: attempt.id } });
    await restoreInventory(transaction, attempt.orderId);
    return transaction.paymentAttempt.findUnique({ where: { id: attempt.id } });
};

const expireAttemptInTransaction = async (transaction, attempt, now) => {
    if (attempt.status !== ACTIVE || new Date(attempt.expiresAt) > now) return attempt;
    return releaseAttempt(transaction, attempt, "EXPIRED", now);
};


const updateProviderData = async (id, { providerTransactionId, qrPayload, paymentUrl }) => {
    const row = await getPrismaClient().paymentAttempt.update({
        where: { id },
        data: { providerTransactionId, qrPayload, paymentUrl }
    });
    return mapAttempt(row);
};

const failAttempt = async (id, now = new Date()) => getPrismaClient().$transaction(async (transaction) => {
    const initial = await transaction.paymentAttempt.findUnique({ where: { id } });
    if (!initial) return undefined;
    await lockOrder(transaction, initial.orderId);
    const attempt = await transaction.paymentAttempt.findUnique({ where: { id } });
    return mapAttempt(await releaseAttempt(transaction, attempt, "FAILED", now));
});

const reserveInventory = async (transaction, orderId) => {
    const items = await transaction.orderItem.findMany({
        where: { orderId },
        orderBy: { variantId: "asc" },
        select: { variantId: true, quantity: true }
    });
    if (items.length === 0) throw new PaymentError("ORDER_ITEMS_MISSING", "Không thể tạo giao dịch cho đơn hàng này", 409);
    for (const item of items) {
        const result = await transaction.productVariant.updateMany({
            where: {
                id: item.variantId,
                isActive: true,
                product: { isDeleted: false },
                stock: { gte: item.quantity }
            },
            data: { stock: { decrement: item.quantity } }
        });
        if (result.count !== 1) {
            throw new PaymentError("PAYMENT_STOCK_UNAVAILABLE", "Một số phiên bản trong đơn không còn đủ hàng để thử thanh toán", 409);
        }
    }
};

const expireOrderAttempts = async (orderId, now) => getPrismaClient().$transaction(async (transaction) => {
    await lockOrder(transaction, orderId);
    const expired = await transaction.paymentAttempt.findMany({
        where: { orderId, status: ACTIVE, expiresAt: { lte: now } },
        orderBy: { createdAt: "asc" }
    });
    for (const attempt of expired) await expireAttemptInTransaction(transaction, attempt, now);
});

const createRetryAttempt = async ({ id, orderId, provider, amount, expiresAt, now = new Date() }) => {
    await expireOrderAttempts(orderId, now);
    return getPrismaClient().$transaction(async (transaction) => {
        await lockOrder(transaction, orderId);
        const order = await transaction.order.findUnique({ where: { id: orderId } });
        if (!order || order.paymentStatus !== "UNPAID" || order.orderStatus !== "PENDING") {
            throw new PaymentError("ORDER_NOT_PAYABLE", "Đơn hàng không còn ở trạng thái chờ thanh toán", 409);
        }

        const activeAttempt = await transaction.paymentAttempt.findFirst({
            where: { orderId, status: ACTIVE, expiresAt: { gt: now } },
            select: { id: true }
        });
        if (activeAttempt) throw new PaymentError("PAYMENT_ATTEMPT_ACTIVE", "Đơn hàng đang có một giao dịch chưa hết hạn", 409);

        await reserveInventory(transaction, orderId);
        const row = await transaction.paymentAttempt.create({
            data: { id, orderId, provider, amount, status: ACTIVE, expiresAt }
        });
        return mapAttempt(row);
    });
};

const getAttempt = async (id) => {
    const row = await getPrismaClient().paymentAttempt.findUnique({
        where: { id },
        include: { order: { select: { id: true, userId: true, orderStatus: true, paymentStatus: true } } }
    });
    return row && { ...mapAttempt(row), userId: row.order.userId, orderStatus: row.order.orderStatus, paymentStatus: row.order.paymentStatus };
};


const expireAttempt = async (id, now = new Date()) => getPrismaClient().$transaction(async (transaction) => {
    const initial = await transaction.paymentAttempt.findUnique({ where: { id } });
    if (!initial) return undefined;
    await lockOrder(transaction, initial.orderId);
    const attempt = await transaction.paymentAttempt.findUnique({ where: { id } });
    return mapAttempt(await expireAttemptInTransaction(transaction, attempt, now));
});

const expireDueAttempts = async (now = new Date(), limit = 100) => {
    const rows = await getPrismaClient().paymentAttempt.findMany({
        where: { status: ACTIVE, expiresAt: { lte: now } },
        select: { id: true },
        orderBy: { expiresAt: "asc" },
        take: limit
    });
    for (const row of rows) await expireAttempt(row.id, now);
    return rows.length;
};

const processCallback = async ({ provider, providerReference, amount, successful, providerTransactionId, now = new Date() }) => getPrismaClient().$transaction(async (transaction) => {
    const initial = await transaction.paymentAttempt.findFirst({ where: { id: providerReference, provider } });
    if (!initial) return { outcome: "NOT_FOUND" };
    await lockOrder(transaction, initial.orderId);
    const attempt = await transaction.paymentAttempt.findUnique({ where: { id: initial.id } });
    const order = await transaction.order.findUnique({ where: { id: attempt.orderId } });

    if (Number(attempt.amount) !== Number(amount)) return { outcome: "AMOUNT_MISMATCH" };
    if (attempt.status === "SUCCEEDED" || attempt.status === "LATE_SUCCESS") {
        return { outcome: attempt.status, attempt: mapAttempt(attempt) };
    }

    const isPastExpiry = new Date(attempt.expiresAt) <= now;
    if (attempt.status === ACTIVE && isPastExpiry) {
        await expireAttemptInTransaction(transaction, attempt, now);
    }
    const current = await transaction.paymentAttempt.findUnique({ where: { id: attempt.id } });

    if (successful) {
        if (current.status !== ACTIVE || isPastExpiry || order.paymentStatus !== "UNPAID" || order.orderStatus !== "PENDING") {
            const late = await transaction.paymentAttempt.update({
                where: { id: current.id },
                data: { status: "LATE_SUCCESS", providerTransactionId, completedAt: now }
            });
            return { outcome: "LATE_SUCCESS", attempt: mapAttempt(late) };
        }
        const changed = await transaction.order.updateMany({
            where: { id: order.id, paymentStatus: "UNPAID", orderStatus: "PENDING" },
            data: { paymentStatus: "PAID" }
        });
        if (changed.count !== 1) {
            const late = await transaction.paymentAttempt.update({ where: { id: current.id }, data: { status: "LATE_SUCCESS", providerTransactionId, completedAt: now } });
            return { outcome: "LATE_SUCCESS", attempt: mapAttempt(late) };
        }
        const paid = await transaction.paymentAttempt.update({
            where: { id: current.id },
            data: { status: "SUCCEEDED", providerTransactionId, completedAt: now }
        });
        return { outcome: "SUCCEEDED", attempt: mapAttempt(paid) };
    }

    if (current.status === ACTIVE) {
        const failed = await releaseAttempt(transaction, current, "FAILED", now);
        return { outcome: "FAILED", attempt: mapAttempt(failed) };
    }
    return { outcome: current.status, attempt: mapAttempt(current) };
});

const listReconciliation = async () => {
    const rows = await getPrismaClient().paymentAttempt.findMany({
        where: { status: "LATE_SUCCESS" },
        include: {
            order: {
                select: {
                    id: true,
                    paymentMethod: true,
                    paymentStatus: true,
                    totalPrice: true,
                    createdAt: true
                }
            }
        },
        orderBy: { completedAt: "desc" }
    });
    return rows.map((row) => ({
        ...mapAttempt(row),
        orderPaymentMethod: row.order.paymentMethod,
        orderPaymentStatus: row.order.paymentStatus,
        orderTotal: Number(row.order.totalPrice),
        orderCreatedAt: new Date(row.order.createdAt).toISOString()
    }));
};

module.exports = {
    PaymentError,
    createRetryAttempt,
    expireAttempt,
    expireDueAttempts,
    failAttempt,
    getAttempt,
    mapAttempt,
    processCallback,
    listReconciliation,
    updateProviderData
};
