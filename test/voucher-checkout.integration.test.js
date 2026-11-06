const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://vouchers.example.test";
process.env.PAYMENT_ENV = "production";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.MOMO_PARTNER_CODE = "MOMOPARTNER";
process.env.MOMO_ACCESS_KEY = "momo-test-access";
process.env.MOMO_SECRET_KEY = "momo-test-secret";

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
        if (text.includes("[dbo].[orders]")) return state.orders.has(values[0]) ? [{ id: values[0] }] : [];
        if (text.includes("SYSUTCDATETIME()")) return [{ dbNow: dbNow() }];
        throw new Error(`Unexpected raw query: ${text}`);
    },
    user: { findUnique: async ({ where }) => clone(state.users.get(where.id) || null) },
    auditLog: {
        create: async ({ data }) => {
            const row = { ...clone(data), timestamp: new Date() };
            state.auditLogs.push(row);
            return clone(row);
        }
    },
    order: {
        create: async ({ data }) => {
            const { items: nestedItems, ...fields } = clone(data);
            const items = nestedItems.create.map((item, index) => ({ id: index + 1, orderId: data.id, ...item }));
            state.orders.set(fields.id, fields);
            state.orderItems.push(...items);
            return { ...clone(fields), items };
        },
        findUnique: async ({ where, include }) => {
            const row = state.orders.get(where.id);
            if (!row) return null;
            const result = clone(row);
            if (include?.items) result.items = state.orderItems.filter((item) => item.orderId === row.id).map(clone);
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
    orderItem: { findMany: async ({ where = {} }) => state.orderItems.filter((row) => matches(row, where)).map(clone) },
    orderVoucher: {
        findMany: async ({ where = {}, orderBy }) => {
            const rows = state.orderVouchers.filter((row) => matches(row, where));
            if (orderBy?.voucherId === "asc") rows.sort((a, b) => a.voucherId - b.voucherId);
            return rows.map(clone);
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
        voucher(1, "SALE10"),
        voucher(2, "BIG100", { percent: 100, maxDiscount: 500_000 }),
        voucher(3, "FREESHIP", { type: "FREE_SHIPPING", percent: null, maxDiscount: null }),
        voucher(4, "FREESHIP2", { type: "FREE_SHIPPING", percent: null, maxDiscount: null }),
        voucher(5, "OLDONE", { startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() - DAY) }),
        voucher(6, "LATER", { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 2 * DAY) }),
        voucher(7, "OFFONE", { isEnabled: false }),
        voucher(8, "FULLONE", { quantity: 1, redeemedCount: 1 }),
        voucher(9, "HIDDEN", { isListed: false }),
        voucher(10, "LASTONE", { type: "FREE_SHIPPING", percent: null, maxDiscount: null, quantity: 1 })
    ];
    return {
        dbNow: undefined,
        nextVoucherId: 100,
        vouchers: new Map(vouchers.map((entry) => [entry.id, entry])),
        orders: new Map(),
        orderItems: [],
        orderVouchers: [],
        auditLogs: [],
        paymentAttempts: new Map(),
        products: new Map([[1, { id: 1, brand: "x", deviceType: "phone", name: "Phone", slug: "phone", image: "/i.png", description: "d", isDeleted: false }]]),
        productVariants: new Map([
            [1, { id: 1, productId: 1, sku: "P-1", price: 200_000, stock: 10, isActive: true }],
            [2, { id: 2, productId: 1, sku: "P-2", price: 1_000, stock: 10, isActive: true }]
        ]),
        users: new Map([
            ["user-1", { id: "user-1", status: "ACTIVE", role: "user", authVersion: 1, forcePasswordChange: false }],
            ["admin-1", { id: "admin-1", status: "ACTIVE", role: "admin", authVersion: 1, forcePasswordChange: false }]
        ])
    };
};

const customer = { customerName: "Nguyen Van A", customerPhone: "0901234567", customerAddress: "123 Duong ABC" };
const cartCheckout = (voucherCodes, { variantId = 1, quantity = 1, paymentMethod = "COD", userId = "user-1" } = {}) =>
    checkoutService.processCartCheckout(userId, {
        items: [{ variantId, quantity }], paymentMethod, voucherCodes, ...customer
    });
const stateSnapshot = () => JSON.stringify({
    orders: [...state.orders.keys()], stock: [...state.productVariants.values()].map((row) => row.stock),
    vouchers: [...state.vouchers.values()].map((row) => row.redeemedCount), links: state.orderVouchers.length
});
const redeemed = (id) => state.vouchers.get(id).redeemedCount;

const tokenFor = (id, role) => jwt.sign({ type: "access", ver: 1, role }, process.env.JWT_ACCESS_SECRET, { subject: id, expiresIn: "10m" });
const headersFor = (id, role, csrf = true) => {
    const headers = { Cookie: `__Host-access_token=${tokenFor(id, role)}${csrf ? "; __Host-csrf_token=csrf-token-for-voucher-tests" : ""}`, "Content-Type": "application/json" };
    if (csrf) {
        headers.Origin = process.env.APP_ORIGIN;
        headers["x-csrf-token"] = "csrf-token-for-voucher-tests";
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

// ── Checkout ────────────────────────────────────────────────────────────────

test("cart checkout redeems vouchers: totals, snapshots, counters, and payment amount match", async () => {
    const { order } = await cartCheckout(["sale10", " FREESHIP "], { quantity: 1, paymentMethod: "MOMO" });
    // 10% of 200,000 = 20,000 (cap 50,000) + free shipping 100,000.
    assert.equal(order.discount, 120_000);
    assert.equal(order.totalPrice, 180_000);
    assert.deepEqual(order.vouchers.map((entry) => [entry.code, entry.amount]), [["SALE10", 20_000], ["FREESHIP", 100_000]]);
    assert.equal(state.orders.get(order.id).totalPrice, 180_000);
    assert.equal(state.orders.get(order.id).discount, 120_000);
    assert.equal(order.paymentAttempt.amount, 180_000);
    assert.equal([...state.paymentAttempts.values()][0].amount, 180_000);
    assert.deepEqual(
        state.orderVouchers.map((entry) => [entry.voucherId, entry.codeSnapshot, entry.typeSnapshot, entry.percentSnapshot, entry.discountAmount, entry.releasedAt]),
        [[1, "SALE10", "PERCENT", 10, 20_000, null], [3, "FREESHIP", "FREE_SHIPPING", null, 100_000, null]]
    );
    assert.equal(redeemed(1), 1);
    assert.equal(redeemed(3), 1);
    assert.equal(state.productVariants.get(1).stock, 9);
});

test("buy-now checkout shares the same voucher pricing", async () => {
    const { order } = await checkoutService.processCheckout("user-1", {
        variantId: 1, quantity: 2, paymentMethod: "MOMO", voucherCodes: ["BIG100"], ...customer
    });
    // subtotal 400,000: 100% capped at 500,000 then by subtotal -> 400,000.
    assert.equal(order.discount, 400_000);
    assert.equal(order.totalPrice, 100_000);
    assert.equal(order.paymentAttempt.amount, 100_000);
    assert.equal(redeemed(2), 1);
});

test("a heavily discounted cheap cart still yields a payable total of at least 1,000", async () => {
    const { order } = await cartCheckout(["BIG100", "SALE10", "FREESHIP"], { variantId: 2, paymentMethod: "MOMO" });
    assert.equal(order.totalPrice, 1_000);
    assert.equal(order.discount, 100_000);
    assert.equal(order.paymentAttempt.amount, 1_000);
    assert.equal(order.discount, order.vouchers.reduce((sum, entry) => sum + entry.amount, 0));
});

test("an unusable voucher blocks checkout with VOUCHER_UNAVAILABLE and persists nothing", async () => {
    const cases = [
        ["OLDONE", /đã hết hạn/],
        ["LATER", /chưa đến thời gian/],
        ["OFFONE", /vô hiệu hóa/],
        ["FULLONE", /hết lượt/],
        ["NOPE123", /không tồn tại/]
    ];
    for (const [code, message] of cases) {
        const before = stateSnapshot();
        await assert.rejects(cartCheckout(["SALE10", code]), (error) => {
            assert.equal(error.code, "VOUCHER_UNAVAILABLE");
            assert.equal(error.statusCode, 409);
            assert.match(error.message, message);
            assert.ok(error.message.includes(code));
            return true;
        });
        assert.equal(stateSnapshot(), before, `${code} must leave no trace`);
    }
});

test("validity is judged by the database clock, inclusive at both boundaries", async () => {
    const start = new Date("2030-01-01T00:00:00.000Z");
    const end = new Date("2030-01-02T00:00:00.000Z");
    state.vouchers.get(1).startsAt = start;
    state.vouchers.get(1).endsAt = end;
    const attemptAt = async (instant) => {
        state.dbNow = new Date(instant);
        return cartCheckout(["SALE10"]);
    };
    await assert.rejects(attemptAt(start.getTime() - 1), { code: "VOUCHER_UNAVAILABLE" });
    assert.equal((await attemptAt(start.getTime())).order.discount, 20_000);
    assert.equal((await attemptAt(end.getTime())).order.discount, 20_000);
    await assert.rejects(attemptAt(end.getTime() + 1), { code: "VOUCHER_UNAVAILABLE" });
    assert.equal(redeemed(1), 2);
});

test("combination rules are enforced at checkout before anything is locked", async () => {
    for (const [codes, code] of [
        [["SALE10", "sale10"], "VOUCHER_DUPLICATE"],
        [["SALE10", "BIG100", "FREESHIP", "LASTONE"], "VOUCHER_LIMIT_EXCEEDED"],
        [["FREESHIP", "FREESHIP2"], "VOUCHER_FREE_SHIPPING_LIMIT"]
    ]) {
        const before = stateSnapshot();
        await assert.rejects(cartCheckout(codes), (error) => error.code === code && error.statusCode === 422);
        assert.equal(stateSnapshot(), before);
    }
});

test("two customers taking the last unit: exactly one order, nothing left behind by the loser", async () => {
    state.users.set("user-2", { id: "user-2", status: "ACTIVE", role: "user", authVersion: 1, forcePasswordChange: false });
    const results = await Promise.allSettled([
        cartCheckout(["LASTONE"], { userId: "user-1" }),
        cartCheckout(["LASTONE"], { userId: "user-2" })
    ]);
    assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
    const loser = results.find((entry) => entry.status === "rejected");
    assert.equal(loser.reason.code, "VOUCHER_UNAVAILABLE");
    assert.equal(state.orders.size, 1);
    assert.equal(state.orderVouchers.length, 1);
    assert.equal(redeemed(10), 1);
    assert.equal(state.productVariants.get(1).stock, 9);
});

// ── Give back and re-reserve ────────────────────────────────────────────────

test("attempt expiry and failure give back exactly once, and a later cancel does not give back again", async () => {
    const { order } = await cartCheckout(["SALE10", "FREESHIP"], { paymentMethod: "MOMO" });
    const attemptId = [...state.paymentAttempts.keys()][0];
    const later = new Date(Date.now() + 10 * 60_000);

    await paymentRepository.expireAttempt(attemptId, later);
    assert.equal(redeemed(1), 0);
    assert.equal(redeemed(3), 0);
    assert.ok(state.orderVouchers.every((entry) => entry.releasedAt));
    assert.equal(state.productVariants.get(1).stock, 10);

    await paymentRepository.expireAttempt(attemptId, later);
    await paymentRepository.failAttempt(attemptId, later);
    assert.equal(redeemed(1), 0);

    // Administrator cancel after expiry: R4 - must not go below zero or give back twice.
    state.vouchers.get(1).redeemedCount = 1; // another order holds the unit now
    await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(redeemed(1), 1, "released rows are never given back a second time");
});

test("failing an attempt gives the vouchers back", async () => {
    await cartCheckout(["SALE10"], { paymentMethod: "MOMO" });
    const attemptId = [...state.paymentAttempts.keys()][0];
    await paymentRepository.failAttempt(attemptId);
    assert.equal(redeemed(1), 0);
    assert.equal(state.paymentAttempts.get(attemptId).status, "FAILED");
});

test("administrator cancel gives back once, is idempotent, and does not restore stock (R1)", async () => {
    const { order } = await cartCheckout(["SALE10", "BIG100"]);
    assert.equal(redeemed(1), 1);
    assert.equal(redeemed(2), 1);
    const cancelled = await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(cancelled.orderStatus, "CANCELLED");
    assert.equal(redeemed(1), 0);
    assert.equal(redeemed(2), 0);
    assert.equal(state.productVariants.get(1).stock, 9, "existing gap kept: cancel does not restore stock");

    await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(redeemed(1), 0);
    assert.equal(redeemed(2), 0);
});

test("cancel rolls back the status change when the give-back fails", async () => {
    const { order } = await cartCheckout(["SALE10"]);
    const original = fakePrisma.voucher.updateMany;
    fakePrisma.voucher.updateMany = async () => { throw new Error("boom"); };
    try {
        await assert.rejects(orderService.updateOrderStatus(order.id, "CANCELLED"), /boom/);
    } finally {
        fakePrisma.voucher.updateMany = original;
    }
    assert.equal(state.orders.get(order.id).orderStatus, "PENDING");
    assert.equal(redeemed(1), 1);
    assert.equal(state.orderVouchers[0].releasedAt, null);
});

test("retry after expiry re-takes the vouchers and the retry amount is the discounted total", async () => {
    const { order } = await cartCheckout(["SALE10"], { paymentMethod: "MOMO" });
    const first = [...state.paymentAttempts.keys()][0];
    const later = new Date(Date.now() + 10 * 60_000);
    await paymentRepository.expireAttempt(first, later);
    assert.equal(redeemed(1), 0);

    // The validity period is NOT re-checked on retry: the Discount was fixed at creation.
    state.vouchers.get(1).endsAt = new Date(Date.now() - DAY);
    const retry = await paymentService.createRetry(order.id, "MOMO", { id: "user-1", role: "user" });
    assert.equal(retry.amount, order.totalPrice);
    assert.equal(redeemed(1), 1);
    assert.equal(state.orderVouchers[0].releasedAt, null);
    assert.equal(state.productVariants.get(1).stock, 9);
});

test("retry is blocked and fully rolled back when the voucher ran out or was disabled", async () => {
    for (const makeUnavailable of [
        (entry) => { entry.isEnabled = false; },
        (entry) => { entry.quantity = 1; entry.redeemedCount = 1; } // someone else took the unit
    ]) {
        state = makeState();
        transactionTail = Promise.resolve();
        const { order } = await cartCheckout(["SALE10"], { paymentMethod: "MOMO" });
        await paymentRepository.expireAttempt([...state.paymentAttempts.keys()][0], new Date(Date.now() + 10 * 60_000));
        makeUnavailable(state.vouchers.get(1));
        const before = stateSnapshot();
        const attempts = state.paymentAttempts.size;

        await assert.rejects(
            paymentService.createRetry(order.id, "MOMO", { id: "user-1", role: "user" }),
            (error) => error.code === "PAYMENT_VOUCHER_UNAVAILABLE" && error.statusCode === 409 && error.message.includes("SALE10")
        );
        assert.equal(stateSnapshot(), before, "stock decrement and voucher counter must roll back");
        assert.equal(state.paymentAttempts.size, attempts);
        assert.ok(state.orderVouchers[0].releasedAt);
    }
});

test("expire -> late success -> retry: LATE_SUCCESS never re-consumes or double-releases a voucher (R2)", async () => {
    const { order } = await cartCheckout(["SALE10"], { paymentMethod: "MOMO" });
    const attemptId = [...state.paymentAttempts.keys()][0];
    const late = new Date(Date.now() + 10 * 60_000);

    // A pre-discount amount must be rejected: the attempt amount is the discounted total.
    const mismatch = await paymentRepository.processCallback({
        provider: "MOMO", providerReference: attemptId, amount: 300_000, successful: true, now: late
    });
    assert.equal(mismatch.outcome, "AMOUNT_MISMATCH");

    const lateSuccess = await paymentRepository.processCallback({
        provider: "MOMO", providerReference: attemptId, amount: order.totalPrice, successful: true, now: late
    });
    assert.equal(lateSuccess.outcome, "LATE_SUCCESS");
    assert.equal(state.orders.get(order.id).paymentStatus, "UNPAID");
    assert.equal(redeemed(1), 0, "voucher was released at expiry and stays released");
    assert.equal(state.productVariants.get(1).stock, 10);

    const duplicate = await paymentRepository.processCallback({
        provider: "MOMO", providerReference: attemptId, amount: order.totalPrice, successful: true, now: late
    });
    assert.equal(duplicate.outcome, "LATE_SUCCESS");
    assert.equal(redeemed(1), 0);

    const retry = await paymentService.createRetry(order.id, "MOMO", { id: "user-1", role: "user" });
    assert.equal(retry.amount, order.totalPrice);
    assert.equal(redeemed(1), 1);
});

test("fail -> retry -> pay keeps the voucher consumed after success", async () => {
    const { order } = await cartCheckout(["SALE10"], { paymentMethod: "MOMO" });
    await paymentRepository.failAttempt([...state.paymentAttempts.keys()][0]);
    assert.equal(redeemed(1), 0);
    const retry = await paymentService.createRetry(order.id, "MOMO", { id: "user-1", role: "user" });
    assert.equal(redeemed(1), 1);
    const paid = await paymentRepository.processCallback({
        provider: "MOMO", providerReference: retry.id, amount: order.totalPrice, successful: true
    });
    assert.equal(paid.outcome, "SUCCEEDED");
    assert.equal(redeemed(1), 1);
});

// ── Quote ───────────────────────────────────────────────────────────────────

test("quote prices the cart, lists only listed applicable vouchers, and hides quantities", async () => {
    const response = await call("POST", "/api/vouchers/quote", { items: [{ variantId: 1, quantity: 1 }], codes: ["SALE10"] }, ["user-1", "user"]);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.subtotal, 200_000);
    assert.equal(body.data.shippingFee, 100_000);
    assert.equal(body.data.discount, 20_000);
    assert.equal(body.data.totalPrice, 280_000);
    assert.deepEqual(body.data.applied, [{ code: "SALE10", type: "PERCENT", percent: 10, amount: 20_000, description: "Voucher SALE10" }]);

    const listedCodes = body.data.listed.map((entry) => entry.code).sort();
    assert.deepEqual(listedCodes, ["BIG100", "FREESHIP", "FREESHIP2", "LASTONE"]); // no HIDDEN, expired, disabled, full, future, applied
    const big = body.data.listed.find((entry) => entry.code === "BIG100");
    assert.equal(big.estimatedDiscount, 180_000, "goods Discount is capped by the subtotal: 200,000 - 20,000 already given");
    assert.equal(body.data.listed.find((entry) => entry.code === "FREESHIP").estimatedDiscount, 100_000);
    assert.doesNotMatch(JSON.stringify(body), /remaining|quantity|redeemed/i);
    assert.equal(stateSnapshot(), stateSnapshot());
    assert.equal(state.productVariants.get(1).stock, 10);
    assert.equal(redeemed(1), 0, "quote never consumes a voucher");
});

test("quote marks listed vouchers unselectable once a free-shipping voucher or three vouchers apply", async () => {
    const quote = async (codes) => (await (await call("POST", "/api/vouchers/quote", { items: [{ variantId: 1, quantity: 1 }], codes }, ["user-1", "user"])).json()).data;

    const withFreeShip = await quote(["FREESHIP"]);
    const other = withFreeShip.listed.find((entry) => entry.code === "FREESHIP2");
    assert.equal(other.selectable, false);
    assert.match(other.reason, /một voucher miễn phí vận chuyển/);
    assert.equal(other.estimatedDiscount, 0);
    assert.equal(withFreeShip.listed.find((entry) => entry.code === "BIG100").selectable, true);

    const three = await quote(["SALE10", "BIG100", "FREESHIP"]);
    assert.ok(three.listed.length > 0);
    assert.ok(three.listed.every((entry) => entry.selectable === false && /tối đa 3 voucher/.test(entry.reason)));
});

test("quote rejects bad typed codes with one exact reason each but still prices the valid ones", async () => {
    const response = await call("POST", "/api/vouchers/quote", {
        items: [{ variantId: 1, quantity: 1 }],
        codes: ["NOPE", "OLDONE", "OFFONE", "FULLONE", "LATER", "SALE10", "sale10", "HIDDEN", "FREESHIP", "FREESHIP2", "BIG100"]
    }, ["user-1", "user"]);
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error.code, "VOUCHER_REJECTED");
    const reasons = Object.fromEntries(body.error.details.map((entry) => [entry.code, entry.reason]));
    assert.match(reasons.NOPE, /không tồn tại/);
    assert.match(reasons.OLDONE, /đã hết hạn/);
    assert.match(reasons.OFFONE, /vô hiệu hóa/);
    assert.match(reasons.FULLONE, /hết lượt/);
    assert.match(reasons.LATER, /chưa đến thời gian/);
    assert.match(reasons.SALE10, /đã được áp dụng/);
    assert.match(reasons.FREESHIP2, /tối đa 3 voucher/, "the 3-voucher limit is reported before the free-shipping limit");
    assert.equal(reasons.HIDDEN, undefined, "unlisted vouchers are accepted by code");
    assert.deepEqual(body.data.applied.map((entry) => entry.code), ["SALE10", "HIDDEN", "FREESHIP"]);
    assert.match(reasons.BIG100, /tối đa 3 voucher/);
    assert.equal(body.data.discount, 20_000 + 20_000 + 100_000);
});

test("quote requires an authenticated customer with CSRF", async () => {
    const noAuth = await fetch(`${baseUrl}/api/vouchers/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noAuth.status, 401);
    const admin = await call("POST", "/api/vouchers/quote", { items: [{ variantId: 1, quantity: 1 }] }, ["admin-1", "admin"]);
    assert.equal(admin.status, 403);
    const noCsrf = await fetch(`${baseUrl}/api/vouchers/quote`, {
        method: "POST", headers: headersFor("user-1", "user", false), body: JSON.stringify({ items: [{ variantId: 1, quantity: 1 }] })
    });
    assert.equal(noCsrf.status, 403);
});

// ── Administrator ───────────────────────────────────────────────────────────

const newVoucher = (overrides = {}) => ({
    code: " welcome20 ", description: "Chào mừng", type: "PERCENT", percent: 20, maxDiscount: 100_000,
    startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString(), quantity: 3, ...overrides
});

test("administrator creates vouchers: uppercase code, defaults, audit log", async () => {
    const response = await call("POST", "/api/admin/vouchers", newVoucher());
    assert.equal(response.status, 201);
    const { data } = await response.json();
    assert.equal(data.code, "WELCOME20");
    assert.equal(data.isEnabled, true);
    assert.equal(data.isListed, true);
    assert.equal(data.remaining, 3);
    assert.equal(state.auditLogs.at(-1).action, "CREATE");
    assert.equal(state.auditLogs.at(-1).entity, "voucher");
    assert.equal(state.auditLogs.at(-1).actor, "admin-1");
});

test("voucher validation rules", async () => {
    const invalid = [
        [{ code: "ab" }, "code"], [{ code: "has space" }, "code"], [{ code: "A".repeat(21) }, "code"],
        [{ percent: 0 }, "percent"], [{ percent: 101 }, "percent"], [{ percent: 10.5 }, "percent"],
        [{ maxDiscount: 999 }, "maxDiscount"], [{ maxDiscount: 500_001 }, "maxDiscount"],
        [{ endsAt: new Date(Date.now() - 2 * DAY).toISOString() }, "endsAt"],
        [{ quantity: 0 }, "quantity"], [{ type: "FIXED" }, "type"],
        [{ type: "FREE_SHIPPING" }, "percent"]
    ];
    for (const [overrides, field] of invalid) {
        const response = await call("POST", "/api/admin/vouchers", newVoucher(overrides));
        assert.equal(response.status, 400, JSON.stringify(overrides));
        const body = await response.json();
        assert.equal(body.error.code, "VALIDATION_FAILED");
        assert.ok(body.error.details.some((entry) => entry.field === field), JSON.stringify(overrides));
    }
    const free = await call("POST", "/api/admin/vouchers", newVoucher({ code: "SHIPFREE", type: "FREE_SHIPPING", percent: undefined, maxDiscount: undefined }));
    assert.equal(free.status, 201);
    const freeData = (await free.json()).data;
    assert.equal(freeData.percent, null);
    assert.equal(freeData.maxDiscount, null);

    const duplicate = await call("POST", "/api/admin/vouchers", newVoucher({ code: "sale10" }));
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "VOUCHER_CODE_TAKEN");
});

test("redeemed vouchers lock type/percent/maxDiscount, keep quantity >= redeemed, and cannot be deleted", async () => {
    await cartCheckout(["SALE10"]);
    const put = (body) => call("PUT", "/api/admin/vouchers/1", body);

    const locked = await put({ percent: 50 });
    assert.equal(locked.status, 409);
    assert.equal((await locked.json()).error.code, "VOUCHER_LOCKED");
    assert.equal((await put({ type: "FREE_SHIPPING" })).status, 409);
    assert.equal((await put({ maxDiscount: 60_000 })).status, 409);
    assert.equal(state.vouchers.get(1).percent, 10);

    assert.equal((await put({ quantity: 0 })).status, 400);
    state.vouchers.get(1).quantity = 5;
    state.vouchers.get(1).redeemedCount = 3;
    const tooLow = await put({ quantity: 2 });
    assert.equal(tooLow.status, 409);
    assert.equal((await tooLow.json()).error.code, "VOUCHER_QUANTITY_TOO_LOW");
    assert.equal((await put({ quantity: 3, description: "Mô tả mới" })).status, 200);
    assert.equal((await put({ quantity: 50 })).status, 200);

    const remove = await call("DELETE", "/api/admin/vouchers/1");
    assert.equal(remove.status, 409);
    assert.equal((await remove.json()).error.code, "VOUCHER_IN_USE");
    assert.ok(state.vouchers.has(1));

    const disable = await put({ isEnabled: false });
    assert.equal(disable.status, 200);
    assert.equal(state.auditLogs.at(-1).action, "DISABLE");
    assert.equal((await put({ isEnabled: true })).status, 200);
    assert.equal(state.auditLogs.at(-1).action, "ENABLE");
});

test("an order-voucher row alone (given back, redeemedCount 0) still blocks delete and type changes", async () => {
    const { order } = await cartCheckout(["SALE10"]);
    await orderService.updateOrderStatus(order.id, "CANCELLED");
    assert.equal(redeemed(1), 0);
    assert.equal((await call("DELETE", "/api/admin/vouchers/1")).status, 409);
    assert.equal((await call("PUT", "/api/admin/vouchers/1", { percent: 30 })).status, 409);
});

test("unreferenced voucher can be edited and deleted, each with an audit entry", async () => {
    assert.equal((await call("PUT", "/api/admin/vouchers/4", { type: "PERCENT", percent: 5, maxDiscount: 10_000 })).status, 200);
    assert.equal(state.auditLogs.at(-1).action, "UPDATE");
    assert.equal(JSON.parse(state.auditLogs.at(-1).changesJson).percent.new, 5);
    const removed = await call("DELETE", "/api/admin/vouchers/4");
    assert.equal(removed.status, 200);
    assert.equal(state.vouchers.has(4), false);
    assert.equal(state.auditLogs.at(-1).action, "DELETE");
    assert.equal((await call("DELETE", "/api/admin/vouchers/4")).status, 404);
    assert.equal((await call("GET", "/api/admin/vouchers/9999")).status, 404);
});

test("voucher administration needs an administrator and CSRF on mutations", async () => {
    const asUser = await call("POST", "/api/admin/vouchers", newVoucher(), ["user-1", "user"]);
    assert.equal(asUser.status, 403);
    const noCsrf = await fetch(`${baseUrl}/api/admin/vouchers`, { method: "POST", headers: headersFor("admin-1", "admin", false), body: JSON.stringify(newVoucher()) });
    assert.equal(noCsrf.status, 403);
    const one = await call("GET", "/api/admin/vouchers/2");
    assert.equal((await one.json()).data.remaining, 5);
});
