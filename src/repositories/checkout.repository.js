// ===== CHECKOUT REPOSITORY =====
// Locks variant inventory, decrements it, and writes immutable order snapshots atomically.

const { getPrismaClient } = require("../db/prisma");
const voucherRepository = require("./voucher.repository");
const { calculateDiscount, unusableReason } = require("../services/voucher-calculator");

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

const optionValuesFor = (variant) => {
    const values = {};
    for (const link of variant.optionValues || []) {
        const optionValue = link.optionValue;
        if (optionValue?.option?.isActive !== false && optionValue?.isActive !== false) {
            values[optionValue.option.name] = optionValue.value;
        }
    }
    return values;
};

const mapLockedVariant = (row, configuration) => row ? {
    id: Number(row.id),
    variantId: Number(row.id),
    productId: Number(row.productId),
    sku: row.sku,
    stock: toNumber(row.stock),
    price: toNumber(row.price),
    isActive: Boolean(row.isActive),
    name: row.name,
    image: row.image,
    description: row.description,
    isDeleted: Boolean(row.isDeleted),
    deletedAt: row.deletedAt,
    optionValues: optionValuesFor(configuration),
    optionsSnapshot: JSON.stringify(optionValuesFor(configuration))
} : undefined;

const mapOrderItem = (row) => ({
    variantId: toNumber(row.variantId),
    productId: row.variant?.productId === undefined ? undefined : toNumber(row.variant.productId),
    sku: row.skuSnapshot,
    options: parseOptions(row.optionsSnapshot),
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
    constructor(variant, quantity) {
        super("Checkout stock changed before it could be decremented");
        this.name = "CheckoutStockConflictError";
        this.variant = variant;
        this.quantity = quantity;
    }
}

const normalizeRequestedItems = (requestedItems) => {
    const quantities = new Map();
    for (const item of requestedItems) {
        const variantId = Number(item.variantId);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(variantId) || variantId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
            throw new TypeError("Checkout repository requires normalized variant IDs and quantities");
        }
        quantities.set(variantId, (quantities.get(variantId) || 0) + quantity);
    }

    return [...quantities.entries()]
        .map(([variantId, quantity]) => ({ variantId, quantity }))
        .sort((left, right) => left.variantId - right.variantId);
};

const lockVariant = async (transaction, variantId) => {
    // SQL Server retains UPDLOCK/HOLDLOCK through commit. Deterministic ID order
    // avoids opposing lock order for multi-variant carts.
    const rows = await transaction.$queryRaw`
        SELECT
            variant.[id], variant.[product_id] AS [productId], variant.[sku],
            variant.[stock], variant.[price], variant.[is_active] AS [isActive],
            product.[name], product.[image], product.[description],
            product.[is_deleted] AS [isDeleted], product.[deleted_at] AS [deletedAt]
        FROM [dbo].[product_variants] AS variant WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        INNER JOIN [dbo].[products] AS product WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            ON product.[id] = variant.[product_id]
        WHERE variant.[id] = ${variantId}
    `;
    if (!rows[0]) return undefined;
    const configuration = await transaction.productVariant.findUnique({
        where: { id: variantId },
        include: {
            optionValues: {
                include: { optionValue: { include: { option: true } } }
            }
        }
    });
    return mapLockedVariant(rows[0], configuration);
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
 * Execute checkout atomically. Business validation/calculation runs after every
 * requested variant has been locked and read, before stock mutation.
 */
const checkout = async (requestedItems, userId, buildOrder, { voucherCodes = [] } = {}) => {
    if (typeof userId !== "string" || userId.trim().length === 0) {
        throw new TypeError("Checkout repository requires an authenticated user ID");
    }
    const normalizedItems = normalizeRequestedItems(requestedItems);

    return getPrismaClient().$transaction(async (transaction) => {
        const lockedItems = [];
        for (const item of normalizedItems) {
            lockedItems.push({
                ...item,
                variant: await lockVariant(transaction, item.variantId)
            });
        }

        // buildOrder prices the Order by calling redeemVouchers({ subtotal, shippingFee }) exactly
        // once. Vouchers are locked (ascending id), validated against the database clock and
        // counted here, still before any stock decrement or Order insert; any throw rolls back all.
        let redemption;
        const redeemVouchers = async ({ subtotal, shippingFee }) => {
            const { vouchers, now } = await voucherRepository.lockByCodes(transaction, voucherCodes);
            for (const voucher of vouchers) {
                const unusable = unusableReason(voucher, now);
                if (unusable) throw new voucherRepository.VoucherUnavailableError(unusable.message);
            }
            const pricing = calculateDiscount({ subtotal, shippingFee, vouchers });
            for (const voucher of [...vouchers].sort((left, right) => left.id - right.id)) {
                await voucherRepository.incrementRedeemed(transaction, voucher);
            }
            redemption = { vouchers, lines: pricing.lines };
            return pricing;
        };

        const orderData = {
            ...(await buildOrder(lockedItems, { redeemVouchers })),
            userId
        };
        if (!redemption) throw new TypeError("Checkout order builder must price the order through redeemVouchers");

        const remainingStockByVariantId = {};
        for (const { variantId, quantity, variant } of lockedItems) {
            const result = await transaction.productVariant.updateMany({
                where: {
                    id: variantId,
                    isActive: true,
                    stock: { gte: quantity }
                },
                data: {
                    stock: { decrement: quantity }
                }
            });

            if (result.count !== 1) {
                throw new CheckoutStockConflictError(variant, quantity);
            }
            remainingStockByVariantId[variantId] = variant.stock - quantity;
        }

        const row = await createOrder(transaction, orderData);
        await voucherRepository.insertOrderVouchers(transaction, row.id, redemption.vouchers, redemption.lines);
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
            order: {
                ...mapOrder(row),
                vouchers: redemption.vouchers.map((voucher, index) => ({
                    code: voucher.code,
                    type: voucher.type,
                    percent: voucher.percent,
                    amount: redemption.lines[index].amount
                }))
            },
            paymentAttempt,
            remainingStockByVariantId
        };
    });
};

module.exports = {
    checkout,
    CheckoutStockConflictError
};
