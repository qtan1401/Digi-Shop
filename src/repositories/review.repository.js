// ===== REVIEW REPOSITORY =====
// Prisma persistence for Product reviews and the Verified reviewer lookup.

const { getPrismaClient } = require("../db/prisma");

const toIsoString = (value) =>
    value === undefined || value === null
        ? value
        : value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString();

const isUniqueViolation = (error) => error?.code === "P2002";
const isMissingRow = (error) => error?.code === "P2025";

const mapOwnReview = (row) => row
    ? {
        id: row.id,
        rating: row.rating ?? null,
        comment: row.comment ?? null,
        isHidden: Boolean(row.isHidden),
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt)
    }
    : null;

const findProduct = async (productId) => getPrismaClient().product.findUnique({
    where: { id: productId },
    select: { id: true, isDeleted: true }
});

/** A Verified reviewer has a DELIVERED Order containing any variant of the Product. */
const hasDeliveredOrderForProduct = async (userId, productId) => {
    const row = await getPrismaClient().orderItem.findFirst({
        where: {
            variant: { productId },
            order: { userId, orderStatus: "DELIVERED" }
        },
        select: { id: true }
    });
    return Boolean(row);
};

const findOwnReview = async (productId, userId) => mapOwnReview(
    await getPrismaClient().productReview.findUnique({
        where: { productId_userId: { productId, userId } }
    })
);

/** Returns the created review, or null when the user already has one for the Product. */
const createReview = async (productId, userId, { rating, comment }) => {
    try {
        const row = await getPrismaClient().productReview.create({
            data: { productId, userId, rating, comment }
        });
        return mapOwnReview(row);
    } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
    }
};

/** Returns the updated review, or null when the user has none. isHidden is untouched. */
const updateOwnReview = async (productId, userId, { rating, comment }) => {
    try {
        const row = await getPrismaClient().productReview.update({
            where: { productId_userId: { productId, userId } },
            data: { rating, comment }
        });
        return mapOwnReview(row);
    } catch (error) {
        if (isMissingRow(error)) return null;
        throw error;
    }
};

/** Returns true when a row was removed. */
const deleteOwnReview = async (productId, userId) => {
    const result = await getPrismaClient().productReview.deleteMany({ where: { productId, userId } });
    return result.count > 0;
};

const listVisible = async (productId, page, pageSize) => {
    const client = getPrismaClient();
    const where = { productId, isHidden: false };
    const [total, rows] = await Promise.all([
        client.productReview.count({ where }),
        client.productReview.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                rating: true,
                comment: true,
                createdAt: true,
                updatedAt: true,
                user: { select: { username: true } }
            }
        })
    ]);
    return {
        total,
        rows: rows.map((row) => ({
            id: row.id,
            username: row.user?.username || null,
            rating: row.rating ?? null,
            comment: row.comment ?? null,
            createdAt: toIsoString(row.createdAt),
            updatedAt: toIsoString(row.updatedAt)
        }))
    };
};

/** Visible reviews of one Product grouped by Rating (null = comment-only), plus the comment count. */
const getProductSummary = async (productId) => {
    const client = getPrismaClient();
    const [groups, commentCount] = await Promise.all([
        client.productReview.groupBy({
            by: ["rating"],
            where: { productId, isHidden: false, rating: { not: null } },
            _count: { _all: true }
        }),
        client.productReview.count({ where: { productId, isHidden: false, comment: { not: null } } })
    ]);
    return {
        counts: groups.map((group) => ({ rating: Number(group.rating), count: group._count._all })),
        commentCount
    };
};

/**
 * Rating totals for many Products in ONE grouped query.
 * Only non-hidden reviews with a Rating count. Returns Map<productId, {sum, count}>.
 */
const getRatingTotals = async (productIds) => {
    const totals = new Map();
    if (!productIds.length) return totals;
    const groups = await getPrismaClient().productReview.groupBy({
        by: ["productId", "rating"],
        where: { productId: { in: productIds }, isHidden: false, rating: { not: null } },
        _count: { _all: true }
    });
    for (const group of groups) {
        const entry = totals.get(group.productId) || { sum: 0, count: 0 };
        entry.sum += Number(group.rating) * group._count._all;
        entry.count += group._count._all;
        totals.set(group.productId, entry);
    }
    return totals;
};

/** The user's own reviews (hidden included) for many Products in ONE query. Returns Map<productId, rating|null>. */
const findOwnRatings = async (userId, productIds) => {
    const ratings = new Map();
    if (!productIds.length) return ratings;
    const rows = await getPrismaClient().productReview.findMany({
        where: { userId, productId: { in: productIds } },
        select: { productId: true, rating: true }
    });
    for (const row of rows) ratings.set(row.productId, row.rating ?? null);
    return ratings;
};

const mapAdminReview = (row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.product?.name ?? null,
    username: row.user?.username || null,
    rating: row.rating ?? null,
    comment: row.comment ?? null,
    isHidden: Boolean(row.isHidden),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
});

const ADMIN_SELECT = {
    id: true,
    productId: true,
    rating: true,
    comment: true,
    isHidden: true,
    createdAt: true,
    updatedAt: true,
    product: { select: { name: true } },
    user: { select: { username: true } }
};

const findAdminPage = async (where, page, pageSize) => {
    const client = getPrismaClient();
    const [total, rows] = await Promise.all([
        client.productReview.count({ where }),
        client.productReview.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: ADMIN_SELECT
        })
    ]);
    return { total, rows: rows.map(mapAdminReview) };
};

const findAdminReview = async (id) => {
    const row = await getPrismaClient().productReview.findUnique({ where: { id }, select: ADMIN_SELECT });
    return row ? mapAdminReview(row) : null;
};

/** Flag only; the row, its content and `updatedAt` (which means "edited by the customer") are kept. Returns null when the review is gone. */
const setHidden = async (id, isHidden) => {
    try {
        const current = await getPrismaClient().productReview.findUnique({ where: { id }, select: { updatedAt: true } });
        if (!current) return null;
        await getPrismaClient().productReview.update({ where: { id }, data: { isHidden, updatedAt: current.updatedAt } });
    } catch (error) {
        if (isMissingRow(error)) return null;
        throw error;
    }
    return findAdminReview(id);
};

module.exports = {
    findProduct,
    hasDeliveredOrderForProduct,
    findOwnReview,
    createReview,
    updateOwnReview,
    deleteOwnReview,
    listVisible,
    getProductSummary,
    getRatingTotals,
    findOwnRatings,
    findAdminPage,
    findAdminReview,
    setHidden
};
