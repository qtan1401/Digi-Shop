// ===== VOUCHER REPOSITORY =====
// Prisma/SQL persistence for Vouchers and their per-Order redemption rows.
// Every validity decision uses the database clock (SYSUTCDATETIME()), never the app server's.

const { Prisma } = require("@prisma/client");
const { getPrismaClient } = require("../db/prisma");
const { isCompliantCode } = require("../services/voucher-calculator");

const toNumber = (value) => value === undefined || value === null ? value : Number(value);
const toIso = (value) => value === undefined || value === null ? value : new Date(value).toISOString();

class VoucherUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = "VoucherUnavailableError";
        this.code = "VOUCHER_UNAVAILABLE";
        this.statusCode = 409;
    }
}

const LOCK_SELECT = Prisma.sql`
    SELECT
        v.[id], v.[code], v.[description], v.[type], v.[percent],
        v.[max_discount] AS [maxDiscount], v.[starts_at] AS [startsAt], v.[ends_at] AS [endsAt],
        v.[quantity], v.[redeemed_count] AS [redeemedCount],
        v.[is_enabled] AS [isEnabled], v.[is_listed] AS [isListed],
        SYSUTCDATETIME() AS [dbNow]
    FROM [dbo].[vouchers] AS v WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
`;

// Voucher shape used by the calculator and availability checks (dates stay Date).
const mapRaw = (row) => ({
    id: Number(row.id),
    code: row.code,
    description: row.description,
    type: row.type,
    percent: toNumber(row.percent) ?? null,
    maxDiscount: toNumber(row.maxDiscount) ?? null,
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
    quantity: Number(row.quantity),
    redeemedCount: Number(row.redeemedCount),
    isEnabled: Boolean(row.isEnabled),
    isListed: Boolean(row.isListed)
});

const mapRow = (row) => row && ({
    ...mapRaw(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
});

// Admin-facing shape: derived remaining/status. Vouchers never expire, so no validity dates are exposed.
// "legacy": a row from before the 5-character / no-expiry rules (longer code, or an end date already past). It stays
// visible to the administrator but customers cannot redeem it, so it must not be reported as running.
const statusOf = (voucher, now) => {
    if (!voucher.isEnabled) return "disabled";
    if (!isCompliantCode(voucher.code) || new Date(voucher.endsAt) < now) return "legacy";
    if (voucher.redeemedCount >= voucher.quantity) return "exhausted";
    return "active";
};

const toAdminVoucher = (voucher, now) => ({
    id: voucher.id,
    code: voucher.code,
    description: voucher.description,
    type: voucher.type,
    percent: voucher.percent,
    maxDiscount: voucher.maxDiscount,
    quantity: voucher.quantity,
    redeemedCount: voucher.redeemedCount,
    remaining: voucher.quantity - voucher.redeemedCount,
    isEnabled: voucher.isEnabled,
    isListed: voucher.isListed,
    status: statusOf(voucher, now),
    createdAt: toIso(voucher.createdAt),
    updatedAt: toIso(voucher.updatedAt)
});

const databaseNow = async (client = getPrismaClient()) => {
    const rows = await client.$queryRaw`SELECT SYSUTCDATETIME() AS [dbNow]`;
    return new Date(rows[0].dbNow);
};

// ── Transaction-level helpers (caller owns the transaction) ─────────────────

const lockVoucher = async (transaction, id) => {
    const rows = await transaction.$queryRaw(Prisma.sql`${LOCK_SELECT} WHERE v.[id] = ${id}`);
    return rows[0] ? { voucher: mapRaw(rows[0]), now: new Date(rows[0].dbNow) } : undefined;
};

/**
 * Resolve codes to ids, then lock the rows in ascending id order (the same order everywhere,
 * so concurrent checkouts cannot deadlock). Returns the vouchers in the caller's code order.
 * An unknown code raises VoucherUnavailableError naming it.
 */
const lockByCodes = async (transaction, codes) => {
    if (codes.length === 0) return { vouchers: [], now: undefined };
    const found = await transaction.voucher.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true }
    });
    const idByCode = new Map(found.map((row) => [row.code, row.id]));
    for (const code of codes) {
        if (!idByCode.has(code)) throw new VoucherUnavailableError(`Voucher ${code} không tồn tại.`);
    }
    const byId = new Map();
    let now;
    for (const id of [...new Set(idByCode.values())].sort((a, b) => a - b)) {
        const locked = await lockVoucher(transaction, id);
        if (!locked) throw new VoucherUnavailableError("Voucher không còn tồn tại.");
        byId.set(id, locked.voucher);
        now = locked.now;
    }
    return { vouchers: codes.map((code) => byId.get(idByCode.get(code))), now };
};

// The caller already holds the row lock and checked redeemedCount < quantity.
const incrementRedeemed = async (transaction, voucher) => {
    const result = await transaction.voucher.updateMany({
        where: { id: voucher.id, redeemedCount: voucher.redeemedCount },
        data: { redeemedCount: { increment: 1 } }
    });
    if (result.count !== 1) {
        throw new VoucherUnavailableError(`Voucher ${voucher.code} đã hết lượt sử dụng.`);
    }
};

const insertOrderVouchers = async (transaction, orderId, vouchers, lines) => {
    const amountById = new Map(lines.map((line) => [line.voucherId, line.amount]));
    const data = vouchers.map((voucher) => ({
        orderId,
        voucherId: voucher.id,
        codeSnapshot: voucher.code,
        typeSnapshot: voucher.type,
        percentSnapshot: voucher.percent,
        discountAmount: amountById.get(voucher.id)
    }));
    if (data.length > 0) await transaction.orderVoucher.createMany({ data });
};

/**
 * Give back one unit per unreleased row of the Order. Idempotent: the row is claimed first
 * (released_at IS NULL -> now), the counter is decremented only by the claimer, and never below 0.
 * The caller must hold the order lock.
 */
const releaseForOrder = async (transaction, orderId, now) => {
    const rows = await transaction.orderVoucher.findMany({
        where: { orderId, releasedAt: null },
        select: { voucherId: true },
        orderBy: { voucherId: "asc" }
    });
    for (const { voucherId } of rows) {
        const claimed = await transaction.orderVoucher.updateMany({
            where: { orderId, voucherId, releasedAt: null },
            data: { releasedAt: now }
        });
        if (claimed.count !== 1) continue;
        await transaction.voucher.updateMany({
            where: { id: voucherId, redeemedCount: { gt: 0 } },
            data: { redeemedCount: { decrement: 1 } }
        });
    }
    return rows.length;
};

/**
 * Re-take the released units of an Order for a payment retry. The validity period is NOT
 * re-checked (the Discount was fixed at creation); the voucher must still be enabled and have
 * quantity left. Returns { ok: true } or { ok: false, code } naming the first unusable voucher;
 * the caller throws so the surrounding transaction rolls back.
 */
const reserveReleasedForOrder = async (transaction, orderId) => {
    const rows = await transaction.orderVoucher.findMany({
        where: { orderId, releasedAt: { not: null } },
        select: { voucherId: true },
        orderBy: { voucherId: "asc" }
    });
    for (const { voucherId } of rows) {
        const locked = await lockVoucher(transaction, voucherId);
        if (!locked || !locked.voucher.isEnabled || locked.voucher.redeemedCount >= locked.voucher.quantity) {
            return { ok: false, code: locked ? locked.voucher.code : String(voucherId) };
        }
        await incrementRedeemed(transaction, locked.voucher);
        await transaction.orderVoucher.updateMany({
            where: { orderId, voucherId, releasedAt: { not: null } },
            data: { releasedAt: null }
        });
    }
    return { ok: true };
};

// ── Customer reads (quote) ──────────────────────────────────────────────────

const findByCodes = async (codes) => {
    if (codes.length === 0) return [];
    const rows = await getPrismaClient().voucher.findMany({ where: { code: { in: codes } } });
    return rows.map(mapRow);
};

const findListedInWindow = async (now) => {
    const rows = await getPrismaClient().voucher.findMany({
        where: { isEnabled: true, isListed: true, startsAt: { lte: now }, endsAt: { gte: now } },
        orderBy: [{ endsAt: "asc" }, { id: "asc" }]
    });
    return rows.map(mapRow).filter((voucher) => voucher.redeemedCount < voucher.quantity && isCompliantCode(voucher.code));
};

// ── Administrator CRUD ──────────────────────────────────────────────────────

// Same precedence as statusOf: disabled, then legacy (listed under "all" only), then exhausted / active.
const LEGACY_CONDITION = Prisma.sql`(LEN(v.[code]) <> 5 OR v.[code] LIKE '%[^A-Za-z0-9]%' OR v.[ends_at] < SYSUTCDATETIME())`;
const STATUS_PREDICATES = Object.freeze({
    disabled: () => Prisma.sql`v.[is_enabled] = 0`,
    exhausted: () => Prisma.sql`v.[is_enabled] = 1 AND NOT ${LEGACY_CONDITION} AND v.[redeemed_count] >= v.[quantity]`,
    active: () => Prisma.sql`v.[is_enabled] = 1 AND NOT ${LEGACY_CONDITION} AND v.[redeemed_count] < v.[quantity]`
});

const listAdmin = async ({ q, status = "all", page = 1, pageSize = 20 }) => {
    const client = getPrismaClient();
    const predicates = [Prisma.sql`1 = 1`];
    const term = typeof q === "string" ? q.trim() : "";
    if (term) {
        const like = `%${term.replace(/[[%_]/g, "[$&]")}%`;
        predicates.push(Prisma.sql`(v.[code] LIKE ${like} OR v.[description] LIKE ${like})`);
    }
    if (STATUS_PREDICATES[status]) predicates.push(STATUS_PREDICATES[status]());
    const where = Prisma.join(predicates, " AND ");
    const offset = (page - 1) * pageSize;

    const [countRows, ids, now] = await Promise.all([
        client.$queryRaw(Prisma.sql`SELECT COUNT(*) AS [total] FROM [dbo].[vouchers] AS v WHERE ${where}`),
        client.$queryRaw(Prisma.sql`
            SELECT v.[id] FROM [dbo].[vouchers] AS v WHERE ${where}
            ORDER BY v.[id] DESC OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`),
        databaseNow(client)
    ]);
    const order = new Map(ids.map((row, index) => [Number(row.id), index]));
    const rows = ids.length === 0 ? [] : await client.voucher.findMany({ where: { id: { in: [...order.keys()] } } });
    rows.sort((left, right) => order.get(left.id) - order.get(right.id));
    const total = Number(countRows[0].total);
    return {
        data: rows.map((row) => toAdminVoucher(mapRow(row), now)),
        meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
    };
};

const MAX_ORDERS_IN_DETAIL = 200;

const toOrderUse = (entry) => ({
    orderId: entry.order.id,
    createdAt: toIso(entry.order.createdAt),
    buyer: entry.order.customerName,
    buyerEmail: entry.order.user?.email ?? null,
    totalPrice: toNumber(entry.order.totalPrice),
    discountAmount: toNumber(entry.discountAmount),
    orderStatus: entry.order.orderStatus,
    released: Boolean(entry.releasedAt)
});

/** One voucher for the administrator, with the orders it was applied to (newest first). */
const getAdmin = async (id) => {
    const client = getPrismaClient();
    const [row, now, uses] = await Promise.all([
        client.voucher.findUnique({ where: { id } }),
        databaseNow(client),
        client.orderVoucher.findMany({
            where: { voucherId: id },
            include: {
                order: {
                    select: {
                        id: true, createdAt: true, customerName: true, totalPrice: true, orderStatus: true,
                        user: { select: { email: true } }
                    }
                }
            },
            orderBy: { order: { createdAt: "desc" } },
            take: MAX_ORDERS_IN_DETAIL
        })
    ]);
    return row ? { ...toAdminVoucher(mapRow(row), now), orders: uses.map(toOrderUse) } : undefined;
};

const create = async (data) => {
    const client = getPrismaClient();
    const row = await client.voucher.create({ data });
    return toAdminVoucher(mapRow(row), await databaseNow(client));
};

const isReferenced = async (transaction, voucher) =>
    voucher.redeemedCount > 0 || (await transaction.orderVoucher.count({ where: { voucherId: voucher.id } })) > 0;

/**
 * Lock the row, then let `decide(current, referenced)` validate and return the update data
 * (or throw). `current` is the locked row, `referenced` means redeemed or present on any order.
 */
const update = async (id, decide) => {
    const client = getPrismaClient();
    return client.$transaction(async (transaction) => {
        const locked = await lockVoucher(transaction, id);
        if (!locked) return undefined;
        const referenced = await isReferenced(transaction, locked.voucher);
        const data = decide(locked.voucher, referenced);
        const row = await transaction.voucher.update({ where: { id }, data });
        return {
            before: toAdminVoucher(locked.voucher, locked.now),
            after: toAdminVoucher(mapRow(row), locked.now)
        };
    });
};

/** Delete only when never referenced; `refuse()` builds the error otherwise. */
const remove = async (id, refuse) => {
    const client = getPrismaClient();
    return client.$transaction(async (transaction) => {
        const locked = await lockVoucher(transaction, id);
        if (!locked) return undefined;
        if (await isReferenced(transaction, locked.voucher)) throw refuse(locked.voucher);
        await transaction.voucher.delete({ where: { id } });
        return toAdminVoucher(locked.voucher, locked.now);
    });
};

module.exports = {
    VoucherUnavailableError,
    create,
    databaseNow,
    findByCodes,
    findListedInWindow,
    getAdmin,
    incrementRedeemed,
    insertOrderVouchers,
    listAdmin,
    lockByCodes,
    releaseForOrder,
    remove,
    reserveReleasedForOrder,
    toAdminVoucher,
    update
};
