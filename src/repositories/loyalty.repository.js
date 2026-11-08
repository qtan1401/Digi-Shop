// ===== LOYALTY REPOSITORY =====
// Transaction-level helpers for Loyalty points (the caller owns the transaction). The user's balance row is locked
// with UPDLOCK exactly like variants and vouchers, and the Order's two timestamps make every reversal idempotent
// (the same claim-first pattern as voucher.repository releaseForOrder): points_released_at for redeemed points given back,
// points_credited_at for earned points credited (never at checkout: on delivery, on first online success, or admin PAID). Callers that reverse an Order hold the order lock first.

const { getPrismaClient } = require("../db/prisma");
const { PointsError } = require("../services/loyalty-calculator");

/** The user's current balance outside any transaction (quote, profile); 0 when the user is unknown. */
const getBalance = async (userId) => {
    const user = await getPrismaClient().user.findUnique({ where: { id: String(userId) }, select: { loyaltyPoints: true } });
    return user?.loyaltyPoints ?? 0;
};

/** Lock the user's row and return its balance, or undefined when the user does not exist. */
const lockBalance = async (transaction, userId) => {
    const rows = await transaction.$queryRaw`
        SELECT [loyalty_points] AS [loyaltyPoints]
        FROM [dbo].[users] WITH (UPDLOCK, ROWLOCK)
        WHERE [id] = ${userId};
    `;
    return rows[0] ? Number(rows[0].loyaltyPoints) : undefined;
};

/** Spend points. The caller holds the user lock; the guard keeps the balance from ever going below zero. */
const deduct = async (transaction, userId, points) => {
    if (points <= 0) return;
    const result = await transaction.user.updateMany({
        where: { id: userId, loyaltyPoints: { gte: points } },
        data: { loyaltyPoints: { decrement: points } }
    });
    if (result.count !== 1) throw new PointsError("POINTS_INSUFFICIENT", "Số điểm hiện có không đủ để sử dụng.");
};

const add = async (transaction, userId, points) => {
    if (points <= 0) return;
    await transaction.user.updateMany({ where: { id: userId }, data: { loyaltyPoints: { increment: points } } });
};

/**
 * Credit the points an Order earned (stored at creation, never credited then): when its online payment first succeeds,
 * when a COD / bank-transfer Order is delivered, or when an administrator marks it PAID. Idempotent: the Order row is claimed
 * (points_credited_at IS NULL -> now) before the balance moves, so a repeat credits nothing.
 */
const creditForOrder = async (transaction, orderId, now) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order || !order.userId || !(order.pointsEarned > 0)) return 0;
    const claimed = await transaction.order.updateMany({
        where: { id: orderId, pointsCreditedAt: null },
        data: { pointsCreditedAt: now }
    });
    if (claimed.count !== 1) return 0;
    await add(transaction, order.userId, order.pointsEarned);
    return order.pointsEarned;
};

/** Give back the points an Order redeemed. Idempotent through points_released_at. */
const releaseForOrder = async (transaction, orderId, now) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order || !order.userId || !(order.pointsRedeemed > 0)) return 0;
    const claimed = await transaction.order.updateMany({
        where: { id: orderId, pointsReleasedAt: null },
        data: { pointsReleasedAt: now }
    });
    if (claimed.count !== 1) return 0;
    await add(transaction, order.userId, order.pointsRedeemed);
    return order.pointsRedeemed;
};

/**
 * Take back the points a cancelled Order had earned. Idempotent: the credit is claimed (points_credited_at -> NULL)
 * before the balance moves. The balance is clamped at 0 when the customer already spent them.
 */
const clawBackForOrder = async (transaction, orderId) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order || !order.userId || !order.pointsCreditedAt || !(order.pointsEarned > 0)) return 0;
    const claimed = await transaction.order.updateMany({
        where: { id: orderId, pointsCreditedAt: { not: null } },
        data: { pointsCreditedAt: null }
    });
    if (claimed.count !== 1) return 0;
    const balance = await lockBalance(transaction, order.userId);
    const taken = Math.min(balance ?? 0, order.pointsEarned);
    await deduct(transaction, order.userId, taken);
    return taken;
};

/**
 * Re-take the points given back from an Order for a payment retry. Returns { ok: true } or { ok: false } when the
 * balance no longer covers them; the caller throws so the surrounding transaction rolls back.
 */
const reserveReleasedForOrder = async (transaction, orderId) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order || !order.userId || !(order.pointsRedeemed > 0) || !order.pointsReleasedAt) return { ok: true };
    const balance = await lockBalance(transaction, order.userId);
    if (balance === undefined || balance < order.pointsRedeemed) return { ok: false, balance: balance ?? 0, points: order.pointsRedeemed };
    await deduct(transaction, order.userId, order.pointsRedeemed);
    await transaction.order.updateMany({ where: { id: orderId, pointsReleasedAt: { not: null } }, data: { pointsReleasedAt: null } });
    return { ok: true };
};

/**
 * Re-take the redeemed points that were given back from an Order whose payment the administrator now confirms as PAID.
 * Unlike reserveReleasedForOrder this never fails: the money has been received, so it takes min(balance, redeemed)
 * (clamped at 0 when the customer already spent them) and clears points_released_at. Idempotent through that claim.
 */
const retakeReleasedForOrder = async (transaction, orderId) => {
    const order = await transaction.order.findUnique({ where: { id: orderId } });
    if (!order || !order.userId || !(order.pointsRedeemed > 0) || !order.pointsReleasedAt) return 0;
    const claimed = await transaction.order.updateMany({ where: { id: orderId, pointsReleasedAt: { not: null } }, data: { pointsReleasedAt: null } });
    if (claimed.count !== 1) return 0;
    const balance = await lockBalance(transaction, order.userId);
    const taken = Math.min(balance ?? 0, order.pointsRedeemed);
    await deduct(transaction, order.userId, taken);
    return taken;
};

module.exports = { getBalance, lockBalance, deduct, creditForOrder, releaseForOrder, clawBackForOrder, reserveReleasedForOrder, retakeReleasedForOrder };
