// Never reach the SMTP server configured in .env: the real mailer runs on a fake transport.
require("nodemailer").createTransport = () => ({ sendMail: async () => {} });

const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://loyalty.example.test";
process.env.PAYMENT_ENV = "production";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.MOMO_PARTNER_CODE = "MOMOPARTNER";
process.env.MOMO_ACCESS_KEY = "momo-test-access";
process.env.MOMO_SECRET_KEY = "momo-test-secret";

const { userPointsMethods, lockUserRows } = require("../test-support/loyalty-fake");

// In-memory Prisma fake: transactions are serialized and rolled back by restoring a snapshot,
// and the voucher CHECK constraints (0 <= redeemed_count <= quantity) are enforced like the database does.
let state;
let transactionTail = Promise.resolve();

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const time = (value) => new Date(value).getTime();

const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected === null) return actual === null || actual === undefined;
    if (expected instanceof Date) return time(actual) === time(expected);
    if (expected && typeof expected === "object") {
        if (Object.hasOwn(expected, "in") && !expected.in.includes(actual)) return false;
        if (Object.hasOwn(expected, "lte") && !(time(actual) <= time(expected.lte))) return false;
        if (Object.hasOwn(expected, "gte") && !(time(actual) >= time(expected.gte))) return false;
        if (Object.hasOwn(expected, "gt") && !(actual > expected.gt)) return false;
        if (Object.hasOwn(expected, "not") && (expected.not === null ? actual == null : actual === expected.not)) return false;
        return true;
    }
    return actual === expected;
});

const checkVoucher = (row) => {
    if (row.redeemedCount < 0 || row.redeemedCount > row.quantity) {
        throw Object.assign(new Error("CHECK constraint vouchers_quantity_check"), { code: "CHECK_VIOLATION" });
    }
};

const applyCounter = (row, data) => {
    if (data.redeemedCount?.increment !== undefined) row.redeemedCount += data.redeemedCount.increment;
    if (data.redeemedCount?.decrement !== undefined) row.redeemedCount -= data.redeemedCount.decrement;
    checkVoucher(row);
};

// Status history rows are children of an order (foreign key) and always carry a status.
const recordStatus = (orderId, status) => {
    if (!state.orders.has(orderId)) throw new Error("FOREIGN KEY constraint order_status_history_order_id_fkey");
    if (typeof status !== "string" || status === "") throw new Error("order_status_history.status is required");
    const row = { id: state.orderStatusHistory.length + 1, orderId, status, createdAt: new Date() };
    state.orderStatusHistory.push(row);
    return row;
};

const dbNow = () => state.dbNow ? new Date(state.dbNow) : new Date();

const makeClient = () => ({
    $queryRaw: async (first, ...rest) => {
        const text = Array.isArray(first) ? first.join("?") : first.strings.join("?");
        const values = Array.isArray(first) ? rest : first.values;
        if (text.includes("[dbo].[vouchers]")) {
            const voucher = state.vouchers.get(values[0]);
            return voucher ? [{ ...clone(voucher), dbNow: dbNow() }] : [];
        }
        if (text.includes("[dbo].[product_variants]")) {
            const variant = state.productVariants.get(values[0]);
            const product = variant && state.products.get(variant.productId);
            return product ? [{ ...clone(product), ...clone(variant), id: variant.id }] : [];
        }
        if (text.includes("[dbo].[users]")) return lockUserRows(state, values[0]);
        if (text.includes("[dbo].[orders]")) return state.orders.has(values[0]) ? [{ id: values[0] }] : [];
        if (text.includes("SYSUTCDATETIME()")) return [{ dbNow: dbNow() }];
        throw new Error(`Unexpected raw query: ${text}`);
    },
    user: { findUnique: async ({ where }) => clone(state.users.get(where.id) || null), ...userPointsMethods(() => state) },
    auditLog: {
        create: async ({ data }) => {
            const row = { ...clone(data), timestamp: new Date() };
            state.auditLogs.push(row);
            return clone(row);
        }
    },
    order: {
        create: async ({ data }) => {
            const { items: nestedItems, statusHistory: nestedHistory, ...fields } = clone(data);
            const items = nestedItems.create.map((item, index) => ({ id: index + 1, orderId: data.id, ...item }));
            state.orders.set(fields.id, { createdAt: new Date(), ...fields });
            state.orderItems.push(...items);
            for (const entry of nestedHistory?.create || []) recordStatus(fields.id, entry.status);
            return { ...clone(fields), items };
        },
        findUnique: async ({ where, include }) => {
            const row = state.orders.get(where.id);
            if (!row) return null;
            const result = clone(row);
            if (include?.items) result.items = state.orderItems.filter((item) => item.orderId === row.id).map(clone);
            if (include?.statusHistory) {
                result.statusHistory = state.orderStatusHistory.filter((entry) => entry.orderId === row.id)
                    .sort((a, b) => b.id - a.id).map(clone);
            }
            if (include?.vouchers) result.vouchers = state.orderVouchers.filter((entry) => entry.orderId === row.id).map(clone);
            return result;
        },
        updateMany: async ({ where, data }) => {
            const row = state.orders.get(where.id);
            if (!row || !matches(row, where)) return { count: 0 };
            Object.assign(row, clone(data));
            return { count: 1 };
        }
    },
    orderStatusHistory: {
        create: async ({ data }) => clone(recordStatus(data.orderId, data.status))
    },
    orderItem: { findMany: async ({ where = {} }) => state.orderItems.filter((row) => matches(row, where)).map(clone) },
    orderVoucher: {
        findMany: async ({ where = {}, orderBy, include, take }) => {
            let rows = state.orderVouchers.filter((row) => matches(row, where));
            if (orderBy?.voucherId === "asc") rows.sort((a, b) => a.voucherId - b.voucherId);
            if (orderBy?.order?.createdAt === "desc") rows.sort((a, b) => time(state.orders.get(b.orderId).createdAt) - time(state.orders.get(a.orderId).createdAt));
            if (take !== undefined) rows = rows.slice(0, take);
            return rows.map((row) => {
                const result = clone(row);
                if (include?.order) {
                    const order = state.orders.get(row.orderId);
                    const user = order.userId ? state.users.get(order.userId) : null;
                    const picked = Object.fromEntries(Object.keys(include.order.select).map((key) => [key, order[key]]));
                    result.order = clone({ ...picked, ...(include.order.select.user ? { user: user ? { email: user.email ?? null } : null } : {}) });
                }
                return result;
            });
        },
        updateMany: async ({ where, data }) => {
            const rows = state.orderVouchers.filter((row) => matches(row, where));
            for (const row of rows) Object.assign(row, clone(data));
            return { count: rows.length };
        },
        createMany: async ({ data }) => {
            for (const entry of data) {
                if (state.orderVouchers.some((row) => row.orderId === entry.orderId && row.voucherId === entry.voucherId)) {
                    throw Object.assign(new Error("unique"), { code: "P2002" });
                }
                state.orderVouchers.push({ releasedAt: null, ...clone(entry) });
            }
            return { count: data.length };
        },
        count: async ({ where }) => state.orderVouchers.filter((row) => matches(row, where)).length
    },
    voucher: {
        findMany: async ({ where = {}, select }) => [...state.vouchers.values()]
            .filter((row) => matches(row, where))
            .map((row) => select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : clone(row)),
        findUnique: async ({ where }) => clone(state.vouchers.get(where.id) || null),
        create: async ({ data }) => {
            if ([...state.vouchers.values()].some((row) => row.code === data.code)) {
                throw Object.assign(new Error("unique"), { code: "P2002" });
            }
            const row = {
                id: state.nextVoucherId++, redeemedCount: 0, createdAt: new Date(), updatedAt: new Date(), ...clone(data)
            };
            checkVoucher(row);
            state.vouchers.set(row.id, row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = state.vouchers.get(where.id);
            Object.assign(row, clone(data), { updatedAt: new Date() });
            return clone(row);
        },
        updateMany: async ({ where, data }) => {
            const row = state.vouchers.get(where.id);
            if (!row || !matches(row, where)) return { count: 0 };
            applyCounter(row, data);
            return { count: 1 };
        },
        delete: async ({ where }) => { state.vouchers.delete(where.id); }
    },
    productVariant: {
        findUnique: async ({ where, include }) => {
            const row = state.productVariants.get(where.id);
            if (!row) return null;
            const result = { ...clone(row), optionValues: [] };
            if (include?.product) result.product = clone(state.products.get(row.productId));
            return result;
        },
        update: async ({ where, data }) => {
            const row = state.productVariants.get(where.id);
            if (data.stock?.increment !== undefined) row.stock += data.stock.increment;
            return clone(row);
        },
        updateMany: async ({ where, data }) => {
            const row = state.productVariants.get(where.id);
            const product = row && state.products.get(row.productId);
            if (!row || !product || (where.isActive !== undefined && row.isActive !== where.isActive) ||
                (where.product?.isDeleted !== undefined && product.isDeleted !== where.product.isDeleted) ||
                (where.stock?.gte !== undefined && row.stock < where.stock.gte)) return { count: 0 };
            if (data.stock?.decrement !== undefined) row.stock -= data.stock.decrement;
            if (data.stock?.increment !== undefined) row.stock += data.stock.increment;
            return { count: 1 };
        }
    },
    paymentAttempt: {
        findUnique: async ({ where }) => clone(state.paymentAttempts.get(where.id) || null),
        findFirst: async ({ where }) => clone([...state.paymentAttempts.values()].find((row) => matches(row, where)) || null),
        findMany: async ({ where = {} } = {}) => [...state.paymentAttempts.values()]
            .filter((row) => matches(row, where)).sort((a, b) => time(a.createdAt) - time(b.createdAt)).map(clone),
        create: async ({ data }) => {
            const row = { createdAt: new Date(), updatedAt: new Date(), inventoryReleasedAt: null, completedAt: null, ...clone(data) };
            state.paymentAttempts.set(row.id, row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = state.paymentAttempts.get(where.id);
            Object.assign(row, clone(data), { updatedAt: new Date() });
            return clone(row);
        },
        updateMany: async ({ where, data }) => {
            const row = state.paymentAttempts.get(where.id);
            if (!row || !matches(row, where)) return { count: 0 };
            Object.assign(row, clone(data), { updatedAt: new Date() });
            return { count: 1 };
        }
    },
    $transaction: async (work) => {
        const previous = transactionTail;
        let release;
        transactionTail = new Promise((resolve) => { release = resolve; });
        await previous;
        const snapshot = state;
        state = clone(state);
        try {
            return await work(fakePrisma);
        } catch (error) {
            state = snapshot;
            throw error;
        } finally {
            release();
        }
    }
});

const db = require("../src/db/prisma");
const fakePrisma = makeClient();
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");
const checkoutService = require("../src/services/checkout.service");
const paymentService = require("../src/services/payment.service");
const orderService = require("../src/services/order.service");
const paymentRepository = require("../src/repositories/payment.repository");
const momo = require("../src/services/payment-providers/momo");

const DAY = 86_400_000;
const voucher = (id, code, overrides = {}) => ({
    id, code, description: `Voucher ${code}`, type: "PERCENT", percent: 10, maxDiscount: 50_000,
    startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + DAY),
    quantity: 5, redeemedCount: 0, isEnabled: true, isListed: true,
    createdAt: new Date(), updatedAt: new Date(), ...overrides
});

const makeState = () => {
    const vouchers = [
        voucher(1, "SALE1"),
        voucher(2, "BIG10", { percent: 100, maxDiscount: 500_000 }),
        voucher(3, "FSHIP", { type: "FREE_SHIPPING", percent: null, maxDiscount: null }),
        voucher(4, "FSHP2", { type: "FREE_SHIPPING", percent: null, maxDiscount: null }),
        voucher(5, "OLD01", { startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() - DAY) }),
        voucher(6, "LATER", { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 2 * DAY) }),
        voucher(7, "OFF01", { isEnabled: false }),
        voucher(8, "FULL1", { quantity: 1, redeemedCount: 1 }),
        voucher(9, "HIDEN", { isListed: false }),
        voucher(10, "LAST1", { type: "FREE_SHIPPING", percent: null, maxDiscount: null, quantity: 1 })
    ];
    return {
        dbNow: undefined,
        nextVoucherId: 100,
        vouchers: new Map(vouchers.map((entry) => [entry.id, entry])),
        orders: new Map(),
        orderItems: [],
        orderVouchers: [],
        orderStatusHistory: [],
        auditLogs: [],
        paymentAttempts: new Map(),
        products: new Map([[1, { id: 1, brand: "x", deviceType: "phone", name: "Phone", slug: "phone", image: "/i.png", description: "d", isDeleted: false }]]),
        productVariants: new Map([
            [1, { id: 1, productId: 1, sku: "P-1", price: 200_000, stock: 10, isActive: true }],
            [2, { id: 2, productId: 1, sku: "P-2", price: 1_000, stock: 10, isActive: true }]
        ]),
        users: new Map([
            ["user-1", { id: "user-1", email: "khach@example.test", status: "ACTIVE", role: "user", authVersion: 1, forcePasswordChange: false }],
            ["admin-1", { id: "admin-1", status: "ACTIVE", role: "admin", authVersion: 1, forcePasswordChange: false }]
        ])
    };
};

const customer = { customerName: "Nguyen Van A", customerPhone: "0901234567", customerAddress: "123 Duong ABC" };
const cartCheckout = (voucherCodes, { variantId = 1, quantity = 1, paymentMethod = "COD", userId = "user-1", pointsToUse } = {}) =>
    checkoutService.processCartCheckout(userId, {
        items: [{ variantId, quantity }], paymentMethod, voucherCodes, pointsToUse, ...customer
    });
const stateSnapshot = () => JSON.stringify({
    orders: [...state.orders.keys()], stock: [...state.productVariants.values()].map((row) => row.stock),
    vouchers: [...state.vouchers.values()].map((row) => row.redeemedCount), links: state.orderVouchers.length
});
const redeemed = (id) => state.vouchers.get(id).redeemedCount;

const tokenFor = (id, role) => jwt.sign({ type: "access", ver: 1, role }, process.env.JWT_ACCESS_SECRET, { subject: id, expiresIn: "10m" });
const headersFor = (id, role, csrf = true) => {
    const headers = { Cookie: `__Host-access_token=${tokenFor(id, role)}${csrf ? "; __Host-csrf_token=csrf-token-for-loyalty-tests" : ""}`, "Content-Type": "application/json" };
    if (csrf) {
        headers.Origin = process.env.APP_ORIGIN;
        headers["x-csrf-token"] = "csrf-token-for-loyalty-tests";
    }
    return headers;
};

let server;
let baseUrl;
let originalInitialize;
let originalMomoCreate;
before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    originalInitialize = paymentService.initializeAttempt;
    // The provider call is not under test; keep the attempt PENDING like a healthy initiation.
    originalMomoCreate = momo.createPayment;
    momo.createPayment = async () => ({ qrPayload: "000201TESTQR", paymentUrl: "https://payment.momo.vn/pay/test" });
    paymentService.initializeAttempt = async (_order, attempt) => ({ id: attempt.id, amount: attempt.amount, status: "PENDING" });
});
after(async () => {
    paymentService.initializeAttempt = originalInitialize;
    momo.createPayment = originalMomoCreate;
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
    state = makeState();
    transactionTail = Promise.resolve();
});

const call = (method, path, body, who = ["admin-1", "admin"]) =>
    fetch(`${baseUrl}${path}`, { method, headers: headersFor(...who), body: body === undefined ? undefined : JSON.stringify(body) });
// ── Loyalty points ──────────────────────────────────────────────────────────
// 1 point = 1,000đ. An order earns floor(totalPrice * 10% / 1000) points. Variant 1 costs 200,000 (+100,000 shipping).

const { earnedPoints, maxUsablePoints, redeemPoints } = require("../src/services/loyalty-calculator");

const balance = (id = "user-1") => state.users.get(id).loyaltyPoints ?? 0;
const setBalance = (points, id = "user-1") => { state.users.get(id).loyaltyPoints = points; };
const snapshot = () => JSON.stringify({
    orders: [...state.orders.keys()], stock: [...state.productVariants.values()].map((row) => row.stock),
    vouchers: [...state.vouchers.values()].map((row) => row.redeemedCount), balances: [...state.users.values()].map((row) => row.loyaltyPoints ?? 0),
    attempts: state.paymentAttempts.size
});
const withPoints = (points, extra = {}) => ({ items: [{ variantId: 1, quantity: 1 }], paymentMethod: "COD", pointsToUse: points, ...customer, ...extra });
const deliver = async (orderId) => {
    await orderService.updateOrderStatus(orderId, "PROCESSING");
    await orderService.updateOrderStatus(orderId, "SHIPPED");
    return orderService.updateOrderStatus(orderId, "DELIVERED");
};
const later = () => new Date(Date.now() + 10 * 60_000);
const asUser = { id: "user-1", role: "user" };

test("the spec example: an order of 1,000,000đ earns 100 points, worth 100,000đ", () => {
    assert.equal(earnedPoints(1_000_000), 100);
    assert.equal(earnedPoints(9_999), 0);
    assert.equal(earnedPoints(10_000), 1);
    assert.equal(earnedPoints(19_999), 1);
    assert.equal(earnedPoints(0), 0);
});

test("a COD order earns nothing at checkout: points are stored, credited on delivery, then usable; computed on 1,000,000đ", async () => {
    state.productVariants.get(1).price = 900_000; // + 100,000 shipping = 1,000,000đ
    const { order } = await cartCheckout([]);
    assert.equal(order.totalPrice, 1_000_000);
    assert.equal(order.pointsEarned, 100);
    assert.equal(order.pointsCredited, false);
    assert.equal(balance(), 0, "unpaid COD produces no spendable points");
    assert.equal(state.orders.get(order.id).pointsEarned, 100);
    assert.equal(state.orders.get(order.id).pointsCreditedAt ?? null, null);

    // Nothing to spend before delivery.
    await assert.rejects(checkoutService.processCartCheckout("user-1", withPoints(100)), { code: "POINTS_INSUFFICIENT" });

    const delivered = await deliver(order.id);
    assert.equal(delivered.pointsCredited, true);
    assert.equal(balance(), 100);
    assert.ok(state.orders.get(order.id).pointsCreditedAt);

    // 100 points = 100,000đ off the next order.
    const next = await checkoutService.processCartCheckout("user-1", withPoints(100));
    assert.equal(next.order.pointsRedeemed, 100);
    assert.equal(next.order.pointsDiscount, 100_000);
    assert.equal(next.order.totalPrice, 900_000);
    assert.equal(balance(), 0, "spent 100; the 90 earned on the 900,000đ wait for delivery");
});

test("DELIVERED credits exactly once; a repeat, or PAID then DELIVERED, never double-credits", async () => {
    const { order } = await cartCheckout([]); // earns 30
    await deliver(order.id);
    assert.equal(balance(), 30);
    await orderService.updateOrderStatus(order.id, "DELIVERED");
    await orderService.updatePaymentStatus(order.id, "PAID");
    await orderService.updatePaymentStatus(order.id, "PAID");
    assert.equal(balance(), 30, "PAID after delivery finds the credit already claimed");

    const second = await cartCheckout([]);
    await orderService.updatePaymentStatus(second.order.id, "PAID");
    assert.equal(balance(), 60);
    await deliver(second.order.id);
    assert.equal(balance(), 60, "DELIVERED after PAID finds the credit already claimed");
});

test("a bank-transfer order earns on delivery like COD; the points follow the voucher-reduced total", async () => {
    const { order } = await cartCheckout(["SALE1"], { paymentMethod: "BANKING" }); // 300,000 - 20,000
    assert.equal(order.totalPrice, 280_000);
    assert.equal(balance(), 0);
    await deliver(order.id);
    assert.equal(balance(), 28);
});

test("an unpaid MoMo/VNPay order delivered earns nothing then; an administrator PAID credits it once afterwards", async () => {
    const { order } = await cartCheckout([], { paymentMethod: "MOMO" });
    await deliver(order.id);
    assert.equal(balance(), 0);
    assert.equal(state.orders.get(order.id).pointsCreditedAt ?? null, null);
    await orderService.updatePaymentStatus(order.id, "PAID");
    assert.equal(balance(), 30);
    await orderService.updatePaymentStatus(order.id, "PAID");
    assert.equal(balance(), 30);
});

test("a paid MoMo order delivered after its success is not credited twice", async () => {
    const { order } = await cartCheckout([], { paymentMethod: "VNPAY" });
    await paymentRepository.processCallback({
        provider: "VNPAY", providerReference: [...state.paymentAttempts.keys()][0], amount: order.totalPrice, successful: true
    });
    assert.equal(balance(), 30);
    await deliver(order.id);
    assert.equal(balance(), 30);
});

test("the payment-status override: PAID credits earned points, re-takes released ones (clamped), and is idempotent", async () => {
    setBalance(100);
    const { order } = await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 100 }); // pays 200,000, earns 20
    await paymentRepository.expireAttempt([...state.paymentAttempts.keys()][0], later());
    assert.equal(balance(), 100, "redeemed points given back by the expiry");

    const paid = await orderService.updatePaymentStatus(order.id, "PAID");
    assert.equal(paid.paymentStatus, "PAID");
    assert.equal(paid.pointsCredited, true);
    assert.equal(balance(), 20, "100 given back, re-taken, plus 20 earned");
    assert.equal(state.orders.get(order.id).pointsReleasedAt, null);

    await orderService.updatePaymentStatus(order.id, "PAID");
    assert.equal(balance(), 20, "a repeat PAID changes nothing");
    await deliver(order.id);
    assert.equal(balance(), 20);

    // The customer already spent the released points: take what is there, never block, never below zero.
    setBalance(100);
    const second = await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 100 });
    await paymentRepository.expireAttempt([...state.paymentAttempts.keys()].at(-1), later());
    setBalance(30); // spent 70 of the given-back points elsewhere
    const clamped = await orderService.updatePaymentStatus(second.order.id, "PAID");
    assert.equal(clamped.paymentStatus, "PAID");
    assert.equal(balance(), 0, "the 20 earned are credited first, then min(50, 100) = 50 re-taken: clamped at 0, never blocked");
    assert.equal(state.orders.get(second.order.id).pointsReleasedAt, null);
});

test("the payment-status override: values other than PAID leave the ledger alone", async () => {
    const { order } = await cartCheckout([]);
    await orderService.updatePaymentStatus(order.id, "UNPAID");
    await orderService.updatePaymentStatus(order.id, "REFUNDED");
    assert.equal(balance(), 0);
    assert.equal(state.orders.get(order.id).pointsCreditedAt ?? null, null);
});

test("a MoMo/VNPay order earns only on the first success: never on LATE_SUCCESS or a repeated callback", async () => {
    const { order } = await cartCheckout([], { paymentMethod: "MOMO" });
    const attemptId = [...state.paymentAttempts.keys()][0];
    assert.equal(order.pointsEarned, 30);
    assert.equal(order.pointsCredited, false);
    assert.equal(balance(), 0, "nothing is credited while the payment is pending");

    const first = await paymentRepository.processCallback({ provider: "MOMO", providerReference: attemptId, amount: order.totalPrice, successful: true });
    assert.equal(first.outcome, "SUCCEEDED");
    assert.equal(first.firstTransition, true);
    assert.equal(balance(), 30);

    const repeat = await paymentRepository.processCallback({ provider: "MOMO", providerReference: attemptId, amount: order.totalPrice, successful: true });
    assert.equal(repeat.outcome, "SUCCEEDED");
    assert.equal(repeat.firstTransition, undefined);
    assert.equal(balance(), 30);

    // A success after expiry is LATE_SUCCESS and credits nothing.
    const second = await cartCheckout([], { paymentMethod: "VNPAY" });
    const secondAttempt = [...state.paymentAttempts.keys()].at(-1);
    const lateSuccess = await paymentRepository.processCallback({
        provider: "VNPAY", providerReference: secondAttempt, amount: second.order.totalPrice, successful: true, now: later()
    });
    assert.equal(lateSuccess.outcome, "LATE_SUCCESS");
    assert.equal(lateSuccess.firstTransition, undefined);
    assert.equal(balance(), 30);
});

test("a failed online payment earns nothing", async () => {
    await cartCheckout([], { paymentMethod: "MOMO" });
    await paymentRepository.failAttempt([...state.paymentAttempts.keys()][0]);
    assert.equal(balance(), 0);
});

test("redeeming deducts the points and lowers the total; discount stays the voucher discount (buy-now and cart)", async () => {
    setBalance(50);
    const cart = await checkoutService.processCartCheckout("user-1", withPoints(50));
    assert.equal(cart.order.pointsRedeemed, 50);
    assert.equal(cart.order.pointsDiscount, 50_000);
    assert.equal(cart.order.discount, 0);
    assert.equal(cart.order.totalPrice, 250_000); // 200,000 + 100,000 - 50,000
    assert.equal(state.orders.get(cart.order.id).pointsDiscount, 50_000);
    assert.equal(cart.order.pointsEarned, 25, "earned on the amount actually payable");
    assert.equal(balance(), 0); // 50 - 50; the 25 earned wait for delivery

    setBalance(100);
    const buyNow = await checkoutService.processCheckout("user-1", {
        variantId: 1, quantity: 1, paymentMethod: "COD", voucherCodes: ["SALE1"], pointsToUse: "100", ...customer
    });
    assert.equal(buyNow.order.discount, 20_000);
    assert.equal(buyNow.order.pointsDiscount, 100_000);
    assert.equal(buyNow.order.totalPrice, 180_000); // 300,000 - 20,000 - 100,000
    assert.equal(balance(), 0); // 100 - 100; the 18 earned wait for delivery
});

test("a payment attempt for an online order carries the total after points", async () => {
    setBalance(100);
    const { order } = await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 100 });
    assert.equal(order.totalPrice, 200_000);
    assert.equal([...state.paymentAttempts.values()][0].amount, 200_000);
    assert.equal(balance(), 0);
});

test("omitting pointsToUse behaves as before: no points redeemed and the balance row is not locked", async () => {
    setBalance(40);
    const { order } = await cartCheckout([]);
    assert.equal(order.pointsRedeemed, 0);
    assert.equal(order.pointsDiscount, 0);
    assert.equal(order.totalPrice, 300_000);
    assert.equal(balance(), 40, "the 30 earned wait for delivery");
    assert.equal(state.userLocks, undefined);
});

test("invalid pointsToUse is rejected before anything is persisted", async () => {
    setBalance(100);
    const before = snapshot();
    for (const bad of [-1, 1.5, "abc", "1.5", "-3", NaN, {}, [], true, Infinity]) {
        await assert.rejects(checkoutService.processCartCheckout("user-1", withPoints(bad)), (error) => {
            assert.equal(error.code, "POINTS_INVALID", `value ${String(bad)}`);
            assert.equal(error.statusCode, 422);
            assert.match(error.message, /số nguyên không âm/);
            return true;
        });
    }
    assert.equal(snapshot(), before);
});

test("more points than the balance is rejected with a clear message and persists nothing", async () => {
    setBalance(10);
    const before = snapshot();
    await assert.rejects(checkoutService.processCartCheckout("user-1", withPoints(11)), (error) => {
        assert.equal(error.code, "POINTS_INSUFFICIENT");
        assert.equal(error.statusCode, 422);
        assert.match(error.message, /chỉ có 10 điểm/);
        return true;
    });
    await assert.rejects(checkoutService.processCheckout("user-1", { variantId: 1, quantity: 1, pointsToUse: 11, ...customer }), { code: "POINTS_INSUFFICIENT" });
    assert.equal(snapshot(), before);
});

test("points beyond the remaining payable amount are capped: only the needed points are spent", async () => {
    setBalance(1_000);
    const { order } = await cartCheckout([], { pointsToUse: 1_000 }); // 300,000đ payable
    assert.equal(order.pointsRedeemed, 300);
    assert.equal(order.pointsDiscount, 300_000);
    assert.equal(order.totalPrice, 0);
    assert.equal(balance(), 700, "the other 700 points stay in the balance; a zero total earns nothing");

    // The last point may overshoot a payable amount that is not a multiple of 1,000đ; the discount never exceeds it.
    state.productVariants.get(2).price = 1_500; // 101,500đ payable
    setBalance(500);
    const second = await cartCheckout([], { variantId: 2, pointsToUse: 500 });
    assert.equal(second.order.pointsRedeemed, 102);
    assert.equal(second.order.pointsDiscount, 101_500);
    assert.equal(second.order.totalPrice, 0);
    assert.equal(balance(), 398);

    assert.equal(maxUsablePoints(101_500, 500), 102);
    assert.deepEqual(redeemPoints({ payable: 5_000, balance: 3, requested: 3 }), { used: 3, discount: 3_000, totalPrice: 2_000 });
});

test("a zero total with MoMo or VNPay is rejected with a pointer to COD or fewer points, and rolls everything back", async () => {
    setBalance(1_000);
    for (const paymentMethod of ["MOMO", "VNPAY"]) {
        const before = snapshot();
        await assert.rejects(cartCheckout([], { paymentMethod, pointsToUse: 1_000 }), (error) => {
            assert.equal(error.code, "POINTS_TOTAL_ZERO");
            assert.equal(error.statusCode, 422);
            assert.match(error.message, /COD/);
            assert.match(error.message, /ít điểm hơn/);
            return true;
        });
        assert.equal(snapshot(), before, "points, stock, vouchers and orders are untouched");
    }
    // Fewer points are fine for the same method.
    const { order } = await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 299 });
    assert.equal(order.totalPrice, 1_000);
    assert.equal(order.paymentAttempt.amount, 1_000);
});

test("the HTTP checkout reports points errors as 422 with a code", async () => {
    setBalance(10);
    const over = await call("POST", "/api/checkout/batch", withPoints(11), ["user-1", "user"]);
    assert.equal(over.status, 422);
    const body = await over.json();
    assert.equal(body.error.code, "POINTS_INSUFFICIENT");
    assert.match(body.message, /chỉ có 10 điểm/);

    const ok = await call("POST", "/api/checkout/batch", withPoints(10), ["user-1", "user"]);
    assert.equal(ok.status, 201);
    const created = (await ok.json()).data;
    assert.equal(created.pointsRedeemed, 10);
    assert.equal(created.totalPrice, 290_000);

    const single = await call("POST", "/api/checkout/1", { quantity: 1, paymentMethod: "COD", pointsToUse: "x", ...customer }, ["user-1", "user"]);
    assert.equal(single.status, 422);
    assert.equal((await single.json()).error.code, "POINTS_INVALID");
});

test("the balance row is locked in the checkout transaction, and concurrent checkouts cannot overspend it", async () => {
    setBalance(300);
    const results = await Promise.allSettled([
        checkoutService.processCartCheckout("user-1", withPoints(300)),
        checkoutService.processCartCheckout("user-1", withPoints(300))
    ]);
    assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(results.find((entry) => entry.status === "rejected").reason.code, "POINTS_INSUFFICIENT");
    assert.ok(state.userLocks.includes("user-1"), "the UPDLOCK query on users ran");
    assert.equal(balance(), 0);
    assert.equal(state.orders.size, 1);
});

test("a checkout that fails after the points were taken rolls the balance back", async () => {
    setBalance(80);
    const original = fakePrisma.productVariant.updateMany;
    fakePrisma.productVariant.updateMany = async () => ({ count: 0 });
    const before = snapshot();
    try {
        await assert.rejects(checkoutService.processCartCheckout("user-1", withPoints(80)));
    } finally {
        fakePrisma.productVariant.updateMany = original;
    }
    assert.equal(snapshot(), before);
    assert.equal(balance(), 80);
});

test("expiry, failure and cancel give redeemed points back exactly once", async () => {
    setBalance(100);
    const { order } = await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 100 });
    const attemptId = [...state.paymentAttempts.keys()][0];
    assert.equal(balance(), 0);

    await paymentRepository.expireAttempt(attemptId, later());
    assert.equal(balance(), 100);
    assert.ok(state.orders.get(order.id).pointsReleasedAt);

    await paymentRepository.expireAttempt(attemptId, later());
    await paymentRepository.failAttempt(attemptId, later());
    assert.equal(balance(), 100);

    setBalance(7); // spent elsewhere in the meantime
    await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(balance(), 7, "already given back: cancel returns nothing again");

    // Failing a fresh attempt gives back too.
    setBalance(100);
    await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 100 });
    assert.equal(balance(), 0);
    await paymentRepository.failAttempt([...state.paymentAttempts.keys()].at(-1));
    assert.equal(balance(), 100);
});

test("administrator cancel of a COD order before delivery returns redeemed points once; nothing to claw back", async () => {
    setBalance(100);
    const { order } = await cartCheckout([], { pointsToUse: 100 }); // pays 200,000, earns 20 (not credited)
    assert.equal(balance(), 0);
    const cancelled = await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(cancelled.orderStatus, "CANCELLED");
    assert.equal(balance(), 100, "the 100 redeemed given back; no earned points were ever credited");
    assert.equal(cancelled.pointsCredited, false);

    await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(balance(), 100);
});

test("the abuse is closed: points of an undelivered COD order cannot be spent, so a cancel cannot be exploited", async () => {
    state.productVariants.get(1).price = 9_900_000; // 10,000,000đ with shipping: would earn 1,000 points
    const big = await cartCheckout([]);
    assert.equal(big.order.pointsEarned, 1_000);
    await assert.rejects(checkoutService.processCartCheckout("user-1", withPoints(1_000)), { code: "POINTS_INSUFFICIENT" });
    await orderService.updateOrderStatus(big.order.id, "CANCELLED");
    assert.equal(balance(), 0);
});

test("cancel of a credited order claws back earned points but never below zero when they were already spent", async () => {
    const { order } = await cartCheckout([]); // earns 30
    await orderService.updatePaymentStatus(order.id, "PAID"); // admin confirms payment: credited while still cancellable
    assert.equal(balance(), 30);
    setBalance(12); // the customer spent 18 of them
    await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(balance(), 0);

    // An online order that was paid: credited on success, taken back on cancel, only once.
    const online = await cartCheckout([], { paymentMethod: "MOMO" });
    await paymentRepository.processCallback({
        provider: "MOMO", providerReference: [...state.paymentAttempts.keys()].at(-1), amount: online.order.totalPrice, successful: true
    });
    assert.equal(balance(), 30);
    await orderService.updateOrderStatus(online.order.id, "CANCELLED");
    assert.equal(balance(), 0);
    setBalance(9);
    await orderService.updateOrderStatus(online.order.id, "CANCELLED");
    assert.equal(balance(), 9, "taken back once only");
});

test("a cancel whose points reversal fails rolls the status change back", async () => {
    const { order } = await cartCheckout([]);
    await orderService.updatePaymentStatus(order.id, "PAID"); // credited, so the cancel has points to reverse
    const original = fakePrisma.user.updateMany;
    fakePrisma.user.updateMany = async () => { throw new Error("boom"); };
    try {
        await assert.rejects(orderService.updateOrderStatus(order.id, "CANCELLED"), /boom/);
    } finally {
        fakePrisma.user.updateMany = original;
    }
    assert.equal(state.orders.get(order.id).orderStatus, "PENDING");
    assert.equal(balance(), 30);
    assert.ok(state.orders.get(order.id).pointsCreditedAt);
});

test("a payment retry re-takes the points given back; the retry amount is the total after points", async () => {
    setBalance(100);
    const { order } = await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 100 });
    await paymentRepository.expireAttempt([...state.paymentAttempts.keys()][0], later());
    assert.equal(balance(), 100);

    const retry = await paymentService.createRetry(order.id, "MOMO", asUser);
    assert.equal(retry.amount, 200_000);
    assert.equal(balance(), 0);
    assert.equal(state.orders.get(order.id).pointsReleasedAt, null);

    const paid = await paymentRepository.processCallback({ provider: "MOMO", providerReference: retry.id, amount: order.totalPrice, successful: true });
    assert.equal(paid.outcome, "SUCCEEDED");
    assert.equal(balance(), 20, "earned on 200,000đ after the success; the redeemed points stay spent");
});

test("a retry fails cleanly and rolls back when the balance no longer covers the points", async () => {
    setBalance(100);
    const { order } = await cartCheckout([], { paymentMethod: "MOMO", pointsToUse: 100 });
    await paymentRepository.expireAttempt([...state.paymentAttempts.keys()][0], later());
    setBalance(40);
    const before = snapshot();

    await assert.rejects(paymentService.createRetry(order.id, "MOMO", asUser), (error) => {
        assert.equal(error.code, "PAYMENT_POINTS_UNAVAILABLE");
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /100 điểm/);
        return true;
    });
    assert.equal(snapshot(), before, "stock and balance untouched");
    assert.ok(state.orders.get(order.id).pointsReleasedAt);
});

test("quote shows the effect of the points before paying and never spends them", async () => {
    setBalance(50);
    const quote = async (body) => call("POST", "/api/vouchers/quote", { items: [{ variantId: 1, quantity: 1 }], codes: [], ...body }, ["user-1", "user"]);

    const plain = (await (await quote({})).json()).data;
    assert.equal(plain.totalPrice, 300_000);
    assert.deepEqual(plain.points, { balance: 50, requested: 0, used: 0, discount: 0, maxUsable: 50, earned: 30 });

    const using = (await (await quote({ pointsToUse: 20, codes: ["SALE1"] })).json()).data;
    assert.equal(using.discount, 20_000);
    assert.equal(using.points.discount, 20_000);
    assert.equal(using.totalPrice, 260_000);
    assert.equal(using.points.earned, 26);

    const capped = (await (await quote({ pointsToUse: 5_000 })).json()).data;
    assert.equal(capped.points.used, 50, "a request above the balance is capped in the quote");
    assert.equal(capped.totalPrice, 250_000);

    const invalid = await quote({ pointsToUse: -4 });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, "POINTS_INVALID");
    assert.equal(balance(), 50);
});

test("the profile exposes the points balance", async () => {
    setBalance(42);
    const response = await call("GET", "/api/profile", undefined, ["user-1", "user"]);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.profile.loyaltyPoints, 42);
    setBalance(0);
    assert.equal((await (await call("GET", "/api/profile", undefined, ["user-1", "user"])).json()).data.profile.loyaltyPoints, 0);
});

test("the order detail exposes points used, their value and points earned", async () => {
    setBalance(10);
    const { order } = await cartCheckout([], { pointsToUse: 10 });
    const response = await call("GET", `/api/orders/${order.id}`, undefined, ["user-1", "user"]);
    assert.equal(response.status, 200);
    const detail = (await response.json()).data;
    assert.equal(detail.pointsRedeemed, 10);
    assert.equal(detail.pointsDiscount, 10_000);
    assert.equal(detail.pointsEarned, 29);
    assert.equal(detail.pointsCredited, false, "credited on delivery");
    assert.equal(detail.totalPrice, 290_000);
    await deliver(order.id);
    const after = (await (await call("GET", `/api/orders/${order.id}`, undefined, ["user-1", "user"])).json()).data;
    assert.equal(after.pointsCredited, true);
});
