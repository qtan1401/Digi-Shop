// ===== CHECKOUT REPOSITORY =====
// Owns the SQL Server transaction that locks stock, decrements it, and writes
// the order header plus immutable order-item snapshots atomically.

const { getPrismaClient } = require("../db/prisma");

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

const mapLockedProduct = (row) => row
    ? {
        id: toNumber(row.id),
        name: row.name,
        stock: toNumber(row.stock),
        price: toNumber(row.price),
        image: row.image,
        isDeleted: Boolean(row.isDeleted)
    }
    : undefined;

const mapOrderItem = (row) => ({
    productId: toNumber(row.productId),
    name: row.nameSnapshot,
    image: row.imageSnapshot,
    unitPrice: toNumber(row.unitPrice),
    quantity: toNumber(row.quantity),
    lineTotal: toNumber(row.lineTotal)
});

const mapOrder = (row) => ({
    id: row.id,
    items: (row.items || []).map(mapOrderItem),
    subtotal: toNumber(row.subtotal),
    shippingFee: toNumber(row.shippingFee),
    discount: toNumber(row.discount),
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
    updatedAt: toIsoString(row.updatedAt)
});

class CheckoutStockConflictError extends Error {
    constructor(product, quantity) {
        super("Checkout stock changed before it could be decremented");
        this.name = "CheckoutStockConflictError";
        this.product = product;
        this.quantity = quantity;
    }
}

const normalizeRequestedItems = (requestedItems) => {
    const quantities = new Map();
    for (const item of requestedItems) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
            throw new TypeError("Checkout repository requires normalized product IDs and quantities");
        }
        quantities.set(productId, (quantities.get(productId) || 0) + quantity);
    }

    return [...quantities.entries()]
        .map(([productId, quantity]) => ({ productId, quantity }))
        .sort((left, right) => left.productId - right.productId);
};

const lockProduct = async (transaction, productId) => {
    // SQL Server UPDLOCK is held until transaction completion. HOLDLOCK also
    // protects a missing key/range, while deterministic ID order avoids the
    // opposite lock ordering that commonly causes multi-item deadlocks.
    const rows = await transaction.$queryRaw`
        SELECT
            [id], [name], [stock], [price], [image], [is_deleted] AS [isDeleted]
        FROM [dbo].[products] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        WHERE [id] = ${productId}
    `;
    return mapLockedProduct(rows[0]);
};

const createOrder = async (transaction, orderData) => {
    const customer = orderData.customer || {};
    const data = {
        userId: String(orderData.userId),
        id: String(orderData.id),
        subtotal: orderData.subtotal,
        shippingFee: orderData.shippingFee,
        discount: orderData.discount,
        totalPrice: orderData.totalPrice,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        customerNote: customer.note,
        paymentMethod: orderData.paymentMethod,
        orderStatus: orderData.orderStatus,
        paymentStatus: orderData.paymentStatus,
        items: {
            create: (orderData.items || []).map((item) => ({
                productId: item.productId,
                nameSnapshot: item.name,
                imageSnapshot: item.image,
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                lineTotal: item.lineTotal
            }))
        }
    };
    if (orderData.createdAt !== undefined) data.createdAt = toDate(orderData.createdAt);
    if (orderData.updatedAt !== undefined) data.updatedAt = toDate(orderData.updatedAt);

    return transaction.order.create({
        data,
        include: {
            items: {
                orderBy: { id: "asc" }
            }
        }
    });
};

/**
 * Execute one checkout as a single interactive transaction.
 * buildOrder owns business validation/calculation and runs only after every
 * product has been locked and read, but before the first mutation.
 */
const checkout = async (requestedItems, userId, buildOrder) => {
    if (typeof userId !== "string" || userId.trim().length === 0) {
        throw new TypeError("Checkout repository requires an authenticated user ID");
    }
    const normalizedItems = normalizeRequestedItems(requestedItems);

    return getPrismaClient().$transaction(async (transaction) => {
        const lockedItems = [];
        for (const item of normalizedItems) {
            lockedItems.push({
                ...item,
                product: await lockProduct(transaction, item.productId)
            });
        }

        const orderData = {
            ...(await buildOrder(lockedItems)),
            userId
        };

        const remainingStockByProductId = {};
        for (const { productId, quantity, product } of lockedItems) {
            const result = await transaction.product.updateMany({
                where: {
                    id: productId,
                    isDeleted: false,
                    stock: { gte: quantity }
                },
                data: {
                    stock: { decrement: quantity }
                }
            });

            if (result.count !== 1) {
                throw new CheckoutStockConflictError(product, quantity);
            }
            remainingStockByProductId[productId] = product.stock - quantity;
        }

        const row = await createOrder(transaction, orderData);
        let paymentAttempt;
        if (orderData.paymentAttempt) {
            const attempt = orderData.paymentAttempt;
            const created = await transaction.paymentAttempt.create({
                data: {
                    id: attempt.id,
                    orderId: row.id,
                    provider: attempt.provider,
                    amount: attempt.amount,
                    status: "PENDING",
                    expiresAt: toDate(attempt.expiresAt)
                }
            });
            paymentAttempt = {
                id: created.id,
                orderId: created.orderId,
                provider: created.provider,
                amount: Number(created.amount),
                status: created.status,
                expiresAt: toIsoString(created.expiresAt)
            };
        }
        return {
            order: mapOrder(row),
            paymentAttempt,
            remainingStockByProductId
        };
    });
};

module.exports = {
    checkout,
    CheckoutStockConflictError
};
