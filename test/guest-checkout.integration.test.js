const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

// Guest checkout through the real app, routes, services and repositories over an in-memory Prisma fake.
process.env.APP_ORIGIN = "https://guest.example.test";
process.env.PAYMENT_ENV = "production";
process.env.TRUST_PROXY = "1"; // each request gets its own client IP, so the per-IP rate limits do not couple tests
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.MOMO_PARTNER_CODE = "MOMOPARTNER";
process.env.MOMO_ACCESS_KEY = "momo-test-access";
process.env.MOMO_SECRET_KEY = "momo-test-secret";

// Emails go through the real mailer; only the SMTP transport underneath nodemailer is faked.
process.env.SMTP_HOST = "smtp.example.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "mailer";
process.env.SMTP_PASSWORD = "mailer-password";
process.env.MAIL_FROM = "Digi-Shop <shop@example.test>";
const nodemailer = require("nodemailer");
let sentMail;
nodemailer.createTransport = () => ({ sendMail: async (message) => { sentMail.push(message); } });

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


const tick = () => new Promise((resolve) => setImmediate(resolve));
const sameText = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const uniqueError = () => Object.assign(new Error("Unique constraint failed on users_email_unique"), { code: "P2002" });

// Users: the unique email index is case-insensitive like SQL Server's default collation, and every call yields to the
// event loop first so concurrent requests really interleave.
const userMethods = () => ({
    findUnique: async ({ where }) => { await tick(); return clone(state.users.get(where.id) || null); },
    findFirst: async ({ where }) => {
        await tick();
        const candidates = [...state.users.values()];
        const found = where.OR
            ? candidates.find((row) => where.OR.some((clause) => (clause.email !== undefined && sameText(row.email, clause.email)) ||
                (clause.username !== undefined && sameText(row.username, clause.username))))
            : candidates.find((row) => sameText(row.email, where.email));
        return clone(found || null);
    },
    create: async ({ data }) => {
        await tick();
        if (data.email && [...state.users.values()].some((row) => sameText(row.email, data.email))) throw uniqueError();
        const row = { username: null, passwordHash: null, emailVerifiedAt: null, passwordLockedAt: null, loyaltyPoints: 0, ...clone(data) };
        state.users.set(row.id, row);
        return clone(row);
    },
    update: async ({ where, data }) => { await tick(); Object.assign(state.users.get(where.id), clone(data)); return clone(state.users.get(where.id)); },
    updateMany: async ({ where, data }) => {
        await tick();
        if (where.authVersion === undefined) return userPointsMethods(() => state).updateMany({ where, data });
        const row = state.users.get(where.id);
        if (!row || row.authVersion !== where.authVersion) return { count: 0 };
        const { authVersion, ...rest } = clone(data);
        Object.assign(row, rest, { authVersion: row.authVersion + authVersion.increment });
        return { count: 1 };
    },
    deleteMany: async ({ where }) => {
        await tick();
        const row = state.users.get(where.id);
        const owns = row && [...state.orders.values()].some((order) => order.userId === row.id);
        if (!row || row.role !== where.role || row.passwordHash != null || owns) return { count: 0 };
        state.users.delete(row.id);
        return { count: 1 };
    }
});

const orderListMethods = () => ({
    count: async ({ where }) => [...state.orders.values()].filter((row) => row.userId === where.userId).length,
    groupBy: async ({ where }) => {
        const groups = new Map();
        for (const row of state.orders.values()) if (row.userId === where.userId) groups.set(row.orderStatus, (groups.get(row.orderStatus) || 0) + 1);
        return [...groups].map(([orderStatus, count]) => ({ orderStatus, _count: { _all: count } }));
    },
    findMany: async ({ where, skip = 0, take }) => [...state.orders.values()]
        .filter((row) => row.userId === where.userId && (!where.orderStatus || row.orderStatus === where.orderStatus))
        .sort((a, b) => time(b.createdAt) - time(a.createdAt)).slice(skip, skip + take)
        .map((row) => {
            const items = state.orderItems.filter((item) => item.orderId === row.id);
            return { ...clone(row), items: items.slice(0, 3).map(clone), _count: { items: items.length, vouchers: 0 } };
        })
});

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
    user: userMethods(),
    refreshSession: {
        create: async ({ data }) => { state.refreshSessions.push(clone(data)); return clone(data); },
        updateMany: async ({ where, data }) => {
            const rows = state.refreshSessions.filter((row) => row.userId === where.userId && row.revokedAt == null);
            for (const row of rows) Object.assign(row, clone(data));
            return { count: rows.length };
        }
    },
    passwordResetToken: {
        create: async ({ data }) => { state.resetTokens.push({ usedAt: null, ...clone(data) }); return clone(data); },
        findUnique: async ({ where }) => clone(state.resetTokens.find((row) => row.tokenHash === where.tokenHash) || null),
        updateMany: async ({ where, data }) => {
            const rows = state.resetTokens.filter((row) => (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
                (where.userId === undefined || row.userId === where.userId) && row.usedAt == null &&
                (!where.expiresAt?.gt || time(row.expiresAt) > time(where.expiresAt.gt)));
            for (const row of rows) Object.assign(row, clone(data));
            return { count: rows.length };
        }
    },
    emailVerificationToken: {
        updateMany: async ({ where, data }) => {
            const rows = state.verificationTokens.filter((row) => (where.id ? row.id === where.id : row.userId === where.userId) &&
                row.usedAt == null && (!where.expiresAt?.gt || time(row.expiresAt) > time(where.expiresAt.gt)));
            for (const row of rows) Object.assign(row, clone(data));
            return { count: rows.length };
        },
        create: async ({ data }) => { state.verificationTokens.push({ usedAt: null, ...clone(data) }); return clone(data); },
        findUnique: async ({ where }) => clone(state.verificationTokens.find((row) => row.tokenHash === where.tokenHash) || null)
    },
    oAuthIdentity: {
        findUnique: async ({ where }) => {
            const { provider, providerSubject } = where.provider_providerSubject;
            const row = state.oauthIdentities.find((entry) => entry.provider === provider && entry.providerSubject === providerSubject);
            return row ? { ...clone(row), user: clone(state.users.get(row.userId)) } : null;
        },
        create: async ({ data }) => { state.oauthIdentities.push(clone(data)); return clone(data); }
    },
    auditLog: {
        create: async ({ data }) => {
            const row = { ...clone(data), timestamp: new Date() };
            state.auditLogs.push(row);
            return clone(row);
        }
    },
    order: {
        ...orderListMethods(),
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
    orderItem: {
        findMany: async ({ where = {} }) => state.orderItems.filter((row) => matches(row, where)).map(clone),
        groupBy: async ({ where }) => where.orderId.in.map((orderId) => ({
            orderId, _sum: { quantity: state.orderItems.filter((row) => row.orderId === orderId).reduce((sum, row) => sum + row.quantity, 0) }
        }))
    },
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
        findUnique: async ({ where, include }) => {
            const row = clone(state.paymentAttempts.get(where.id) || null);
            if (row && include?.order) {
                const order = state.orders.get(row.orderId);
                row.order = Object.fromEntries(Object.keys(include.order.select).map((key) => [key, order[key] ?? null]));
            }
            return row;
        },
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
const paymentService = require("../src/services/payment.service");
const orderService = require("../src/services/order.service");
const { createAuthService } = require("../src/services/auth.service");
const momo = require("../src/services/payment-providers/momo");

const makeState = () => ({
    dbNow: undefined,
    nextVoucherId: 100,
    vouchers: new Map([[1, {
        id: 1, code: "SALE1", description: "10%", type: "PERCENT", percent: 10, maxDiscount: 50_000,
        startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 86_400_000),
        quantity: 5, redeemedCount: 0, isEnabled: true, isListed: true, createdAt: new Date(), updatedAt: new Date()
    }]]),
    orders: new Map(),
    orderItems: [],
    orderVouchers: [],
    orderStatusHistory: [],
    auditLogs: [],
    paymentAttempts: new Map(),
    refreshSessions: [],
    verificationTokens: [],
    resetTokens: [],
    oauthIdentities: [],
    products: new Map([[1, { id: 1, brand: "x", deviceType: "phone", name: "Phone", slug: "phone", image: "/i.png", description: "d", isDeleted: false }]]),
    productVariants: new Map([[1, { id: 1, productId: 1, sku: "P-1", price: 200_000, stock: 10, isActive: true }]]),
    users: new Map([
        ["user-1", { id: "user-1", email: "khach@example.test", status: "ACTIVE", role: "user", authVersion: 1, forcePasswordChange: false, passwordHash: "x", fullName: "Khach Cu", loyaltyPoints: 7 }],
        ["user-2", { id: "user-2", email: "nguoila@example.test", status: "ACTIVE", role: "user", authVersion: 1, forcePasswordChange: false, passwordHash: "x" }],
        ["admin-1", { id: "admin-1", username: "boss", email: "boss@example.test", status: "ACTIVE", role: "admin", authVersion: 1, forcePasswordChange: false, passwordHash: "x" }]
    ])
});

const CSRF = "csrf-token-for-guest-tests";
const csrfCookieName = "__Host-csrf_token";
let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; };

const accessTokenFor = (id, role) => jwt.sign({ type: "access", ver: 1, role }, process.env.JWT_ACCESS_SECRET, { subject: id, expiresIn: "10m" });

/** A request with the CSRF cookie and header; `as` adds a signed-in cookie, `token` a guest order token. */
const send = (method, path, body, { csrf = true, as, token, ip = nextIp(), cookie = "" } = {}) => {
    const cookies = [];
    if (as) cookies.push(`__Host-access_token=${accessTokenFor(...as)}`);
    if (csrf) cookies.push(`${csrfCookieName}=${CSRF}`);
    if (cookie) cookies.push(cookie);
    const headers = { "Content-Type": "application/json", "X-Forwarded-For": ip, Origin: process.env.APP_ORIGIN };
    if (cookies.length) headers.Cookie = cookies.join("; ");
    if (csrf) headers["x-csrf-token"] = CSRF;
    if (token) headers["x-guest-order-token"] = token;
    return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};

const customer = { customerName: "Nguyen Van A", customerPhone: "0901234567", customerAddress: "123 Duong ABC" };
const cartBody = (email, extra = {}) => ({ email, items: [{ variantId: 1, quantity: 1 }], paymentMethod: "COD", ...customer, ...extra });
const buyNowBody = (email, extra = {}) => ({ email, variantId: 1, quantity: 1, paymentMethod: "COD", ...customer, ...extra });
const guestCart = (email, extra, options) => send("POST", "/api/guest/checkout/batch", cartBody(email, extra), options);
const guestBuyNow = (email, extra, options) => send("POST", "/api/guest/checkout", buyNowBody(email, extra), options);

const usersWithEmail = (email) => [...state.users.values()].filter((row) => row.email?.toLowerCase() === email.toLowerCase());
const mailsTo = (address) => sentMail.filter((message) => message.to === address);
const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isAccountEmail = (message) => /Tài khoản/.test(message.subject);
const isConfirmation = (message) => /Xác nhận đơn hàng/.test(message.subject);

let server;
let baseUrl;
let originalInitialize;
let originalMomoCreate;
before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    originalInitialize = paymentService.initializeAttempt;
    originalMomoCreate = momo.createPayment;
    // The provider call is not under test; keep the attempt PENDING like a healthy initiation.
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
    sentMail = [];
});

// ── New email ───────────────────────────────────────────────────────────────

test("a guest buys with COD and a new email: account, order and both emails, and the orders show after signing in", async () => {
    const response = await guestBuyNow("  New.Buyer@Example.TEST ");
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.orderStatus, "PENDING");
    assert.equal(body.data.totalPrice, 300_000);
    assert.equal(body.data.items.length, 1);
    assert.equal(typeof body.data.guestAccessToken, "string");
    assert.equal(response.headers.getSetCookie().some((cookie) => /access_token/.test(cookie)), false, "no session is issued");

    const [account] = usersWithEmail("new.buyer@example.test");
    assert.equal(account.email, "new.buyer@example.test");
    assert.equal(account.role, "user");
    assert.equal(account.status, "UNVERIFIED");
    assert.equal(account.passwordHash, null);
    assert.equal(account.fullName, "Nguyen Van A");
    const stored = state.orders.get(body.data.id);
    assert.equal(stored.userId, account.id);
    assert.equal(stored.customerEmail, "new.buyer@example.test");
    assert.equal(stored.guestAccessTokenHash, sha256(body.data.guestAccessToken), "only the hash of the token is stored");
    assert.notEqual(stored.guestAccessTokenHash, body.data.guestAccessToken);
    assert.equal(JSON.stringify(body).includes(stored.guestAccessTokenHash), false);
    assert.equal(state.productVariants.get(1).stock, 9);

    await waitFor(() => sentMail.length >= 2);
    assert.equal(sentMail.length, 2);
    const welcome = sentMail.filter(isAccountEmail);
    assert.equal(welcome.length, 1);
    assert.equal(welcome[0].to, "new.buyer@example.test");
    assert.match(welcome[0].text, /\/recover\.html/);
    assert.doesNotMatch(welcome[0].text + welcome[0].html, /tạm thời/);
    const confirmation = sentMail.filter(isConfirmation);
    assert.equal(confirmation.length, 1);
    assert.equal(confirmation[0].to, "new.buyer@example.test");
    assert.ok(confirmation[0].text.includes(body.data.id));

    // The mailbox owner proves access through the password link, which activates the password-less account.
    const recovery = await send("POST", "/api/auth/recover", { email: "new.buyer@example.test" });
    assert.equal(recovery.status, 202);
    await waitFor(() => sentMail.some((message) => /reset-password\.html/.test(message.text)));
    const link = sentMail.find((message) => /reset-password\.html/.test(message.text));
    assert.ok(link, "a password link is mailed");
    assert.doesNotMatch(link.text, /tạm thời/);
    const password = "chosen-by-the-buyer-1";
    const set = await send("POST", "/api/auth/reset-password", { token: new URL(link.text.match(/https:\/\/\S+/)[0]).searchParams.get("token"), newPassword: password });
    assert.equal(set.status, 200);
    const login = await send("POST", "/api/auth/login", { identifier: "new.buyer@example.test", password });
    assert.equal(login.status, 200);
    assert.equal(state.users.get(account.id).status, "ACTIVE");
    const accessCookie = login.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-access_token="));
    const mine = await send("GET", "/api/orders/mine", undefined, { cookie: accessCookie.split(";")[0] });
    const mineBody = await mine.json();
    assert.equal(mine.status, 200);
    assert.deepEqual(mineBody.data.map((entry) => entry.id), [body.data.id]);
});

test("a guest cart checkout works the same way and stores the points for the new account (credited on delivery)", async () => {
    const response = await guestCart("Cart.Buyer@example.test");
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.data.pointsEarned, 30);
    const [account] = usersWithEmail("cart.buyer@example.test");
    assert.equal(state.orders.get(body.data.id).userId, account.id);
    assert.equal(account.loyaltyPoints, 0, "a COD order is credited on delivery, not at creation");
});

test("an invalid or missing email is rejected before anything is created", async () => {
    for (const email of ["", "not-an-email", undefined, 42, `${"a".repeat(320)}@example.test`]) {
        const response = await guestBuyNow(email);
        assert.equal(response.status, 400, String(email).slice(0, 20));
        assert.equal((await response.json()).error.code, "GUEST_EMAIL_INVALID");
    }
    assert.equal(state.orders.size, 0);
    assert.equal(state.users.size, 3);
    assert.equal(state.productVariants.get(1).stock, 10);
    assert.equal(sentMail.length, 0);
});

test("pointsToUse is rejected for a guest, even on an account that has points", async () => {
    const response = await guestCart("khach@example.test", { pointsToUse: 5 });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "GUEST_POINTS_NOT_ALLOWED");
    assert.equal(state.orders.size, 0);
    assert.equal(state.users.get("user-1").loyaltyPoints, 7);
    const quote = await send("POST", "/api/guest/vouchers/quote", { email: "khach@example.test", items: [{ variantId: 1, quantity: 1 }], pointsToUse: 5 });
    assert.equal(quote.status, 400);
});

test("a checkout that fails after the account was created leaves it, and the first successful order then sends its welcome mail", async () => {
    const response = await guestCart("fails@example.test", { voucherCodes: ["NOSUCH"] });
    assert.ok(response.status >= 400 && response.status < 500, `status ${response.status}`);
    const [account] = usersWithEmail("fails@example.test");
    assert.ok(account, "the account stays: deleting it would race a concurrent order for the same email");
    assert.equal(state.orders.size, 0);
    assert.equal(sentMail.length, 0);

    assert.equal((await guestCart("fails@example.test")).status, 201);
    assert.equal(usersWithEmail("fails@example.test").length, 1);
    await waitFor(() => mailsTo("fails@example.test").length >= 2);
    assert.equal(mailsTo("fails@example.test").filter(isAccountEmail).length, 1);

    assert.equal((await guestCart("fails@example.test")).status, 201);
    await waitFor(() => mailsTo("fails@example.test").length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(mailsTo("fails@example.test").filter(isAccountEmail).length, 1, "only the first order sends it");
});

// ── Existing email ──────────────────────────────────────────────────────────

test("an existing customer email gets the order attached, no session, and the same response shape as a new email", async () => {
    const created = await (await guestCart("brand.new@example.test")).json();
    const attached = await guestCart("khach@example.test");
    const body = await attached.json();
    assert.equal(attached.status, 201);
    assert.equal(attached.headers.getSetCookie().some((cookie) => /access_token|refresh_token/.test(cookie)), false);
    assert.equal(state.orders.get(body.data.id).userId, "user-1");
    assert.equal(state.orders.get(body.data.id).pointsEarned, 30);
    assert.equal(state.users.get("user-1").loyaltyPoints, 7, "credited on delivery, not at creation");

    const shape = (value) => Array.isArray(value) ? value.map(shape)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort().map(([key, inner]) => [key, shape(inner)]))
            : typeof value;
    assert.deepEqual(shape(body), shape(created));

    // Nothing about the existing account reaches the guest.
    const text = JSON.stringify(body);
    for (const secret of ["user-1", "Khach Cu"]) assert.equal(text.includes(secret), false, secret);
    await waitFor(() => mailsTo("khach@example.test").length >= 1);
    assert.equal(mailsTo("khach@example.test").filter(isAccountEmail).length, 0, "an existing account gets no account email");
    assert.equal(mailsTo("khach@example.test").filter(isConfirmation).length, 1);
});

test("the email is normalised like sign-in: case and padding attach to the same account", async () => {
    const response = await guestBuyNow("  KHACH@Example.Test  ");
    assert.equal(response.status, 201);
    assert.equal(state.users.size, 3, "no duplicate account");
    assert.equal(state.orders.get((await response.json()).data.id).userId, "user-1");
});

test("two simultaneous guest orders for a new email end with one account and one account email", async () => {
    const [first, second] = await Promise.all([guestBuyNow("Race@Example.test"), guestCart("  race@example.TEST")]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const [account, ...extra] = usersWithEmail("race@example.test");
    assert.equal(extra.length, 0);
    const owners = [...state.orders.values()].map((order) => order.userId);
    assert.deepEqual(owners, [account.id, account.id]);
    await waitFor(() => sentMail.length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sentMail.filter(isAccountEmail).length, 1);
    assert.equal(sentMail.filter(isConfirmation).length, 2);
});

test("an administrator's email leaves the order unattached and uncredited with an identical response, but still gets the confirmation", async () => {
    const response = await guestCart("BOSS@example.test");
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(response.headers.getSetCookie().some((cookie) => /access_token/.test(cookie)), false);
    assert.equal(state.orders.get(body.data.id).userId, null);
    const ordinary = await (await guestCart("ordinary.buyer@example.test")).json();
    assert.equal(body.data.pointsEarned, ordinary.data.pointsEarned, "the response never tells an administrator email from a customer one");
    assert.ok(body.data.pointsEarned > 0);
    const keys = (value) => Object.keys(value).sort();
    assert.deepEqual(keys(body.data), keys(ordinary.data));
    assert.equal(usersWithEmail("boss@example.test").length, 1, "no account is created for it");
    assert.equal(state.users.get("admin-1").loyaltyPoints ?? 0, 0, "and nothing is credited");
    await waitFor(() => mailsTo("boss@example.test").length >= 1);
    assert.equal(mailsTo("boss@example.test").filter(isAccountEmail).length, 0);
    assert.equal(mailsTo("boss@example.test").filter(isConfirmation).length, 1);

    const online = await (await guestBuyNow("boss@example.test", { paymentMethod: "MOMO" })).json();
    const read = await send("GET", `/api/payments/attempts/${online.data.paymentAttempt.id}`, undefined, { token: online.data.guestAccessToken });
    assert.equal(read.status, 200, "the token still authorises an order that has no owner");
    assert.equal((await send("GET", `/api/payments/attempts/${online.data.paymentAttempt.id}`)).status, 401);
});

// ── Guest quote, CSRF and rate limits ───────────────────────────────────────

test("the guest quote prices a cart with vouchers and never shows an account's points", async () => {
    const response = await send("POST", "/api/guest/vouchers/quote", { email: "khach@example.test", items: [{ variantId: 1, quantity: 1 }], codes: ["SALE1"] });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.discount, 20_000);
    assert.equal(body.data.totalPrice, 280_000);
    assert.equal(body.data.points.balance, 0);
    const invalid = await send("POST", "/api/guest/vouchers/quote", { email: "nope", items: [{ variantId: 1, quantity: 1 }] });
    assert.equal(invalid.status, 400);
    assert.equal(state.users.size, 3);
});

test("a guest voucher is redeemed once per order, like a signed-in one", async () => {
    const response = await guestCart("voucher.buyer@example.test", { voucherCodes: ["SALE1"] });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.data.discount, 20_000);
    assert.equal(state.vouchers.get(1).redeemedCount, 1);
});

test("guest endpoints need the CSRF token and a same-origin request", async () => {
    for (const [path, payload] of [
        ["/api/guest/checkout", buyNowBody("csrf@example.test")],
        ["/api/guest/checkout/batch", cartBody("csrf@example.test")],
        ["/api/guest/vouchers/quote", { email: "csrf@example.test", items: [{ variantId: 1, quantity: 1 }] }]
    ]) {
        const response = await send("POST", path, payload, { csrf: false });
        assert.equal(response.status, 403, path);
        assert.equal((await response.json()).error.code, "CSRF_FAILED");
    }
    const foreign = await fetch(`${baseUrl}/api/guest/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example.test", Cookie: `${csrfCookieName}=${CSRF}`, "x-csrf-token": CSRF },
        body: JSON.stringify(buyNowBody("csrf@example.test"))
    });
    assert.equal(foreign.status, 403);
    assert.equal(state.orders.size, 0);
    assert.equal(usersWithEmail("csrf@example.test").length, 0);
});

test("guest checkout is rate limited per email and per IP", async () => {
    const ip = nextIp();
    const results = [];
    for (let count = 0; count < 12; count += 1) {
        // Each request is stopped by validation (empty cart), so only the limiter decides the 429.
        results.push((await send("POST", "/api/guest/checkout/batch", { ...cartBody("limited@example.test"), items: [] }, { ip })).status);
    }
    assert.deepEqual(results.slice(0, 10), Array(10).fill(400));
    assert.deepEqual(results.slice(10), [429, 429]);
    assert.equal((await guestCart("someone.else@example.test", {}, { ip })).status, 201, "another email is not blocked by that one");

    const crowded = nextIp();
    let blocked;
    for (let count = 0; count < 31 && !blocked; count += 1) {
        const response = await send("POST", "/api/guest/checkout/batch", { ...cartBody(`crowd${count}@example.test`), items: [] }, { ip: crowded });
        if (response.status === 429) blocked = count;
    }
    assert.ok(blocked >= 29 && blocked <= 31, `the per-IP limit stopped request ${blocked}`);
});

test("the guest quote is rate limited too, with a higher allowance", async () => {
    const ip = nextIp();
    let blockedAt;
    for (let count = 0; count < 130 && blockedAt === undefined; count += 1) {
        const response = await send("POST", "/api/guest/vouchers/quote", { email: "quoter@example.test", items: [] }, { ip });
        if (response.status === 429) blockedAt = count;
    }
    assert.equal(blockedAt, 120);
});

// ── Payment attempts for guests ─────────────────────────────────────────────

const onlineGuestOrder = async (email = "pay.guest@example.test") => {
    const response = await guestCart(email, { paymentMethod: "MOMO" });
    const body = await response.json();
    assert.equal(response.status, 201);
    return { order: body.data, attemptId: body.data.paymentAttempt.id, token: body.data.guestAccessToken };
};

test("a guest reads their payment attempt with the right token; wrong or missing token is refused", async () => {
    const { attemptId, token } = await onlineGuestOrder();
    const ok = await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { token });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.status, "PENDING");

    const unknown = await send("GET", "/api/payments/attempts/does-not-exist", undefined, { token });
    const wrong = await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { token: "wrong-token" });
    assert.equal(wrong.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await wrong.json(), await unknown.json(), "a wrong token looks like an unknown id");

    const missing = await send("GET", `/api/payments/attempts/${attemptId}`);
    assert.equal(missing.status, 401);
});

test("the token is a header only: it is not accepted in the URL or the body", async () => {
    const { attemptId, token } = await onlineGuestOrder();
    assert.equal((await send("GET", `/api/payments/attempts/${attemptId}?token=${token}`)).status, 401);
    assert.equal((await send("GET", `/api/payments/attempts/${attemptId}?guestAccessToken=${token}`, undefined, { as: ["user-2", "user"] })).status, 404);
});

test("a signed-in stranger is refused without the token; the signed-in owner is still accepted without it", async () => {
    const { attemptId, token } = await onlineGuestOrder("khach@example.test");
    assert.equal(state.orders.get([...state.orders.keys()][0]).userId, "user-1");
    const stranger = await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { as: ["user-2", "user"] });
    assert.equal(stranger.status, 404);
    assert.equal((await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { as: ["user-2", "user"], token: "wrong" })).status, 404);
    assert.equal((await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { as: ["user-1", "user"] })).status, 200);
    assert.equal((await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { as: ["admin-1", "admin"] })).status, 403, "an administrator session is not an owner");
    assert.equal((await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { as: ["user-2", "user"], token })).status, 200, "the token is the capability");
});

test("a guest retries payment after the attempt expired, with the right token only", async () => {
    const { order, attemptId, token } = await onlineGuestOrder();
    state.paymentAttempts.get(attemptId).expiresAt = new Date(Date.now() - 1000);
    assert.equal((await (await send("GET", `/api/payments/attempts/${attemptId}`, undefined, { token })).json()).data.status, "EXPIRED");
    assert.equal(state.productVariants.get(1).stock, 10, "expiry gave the stock back");

    const retryPath = `/api/payments/orders/${order.id}/attempts`;
    assert.equal((await send("POST", retryPath, { provider: "MOMO" })).status, 401);
    assert.equal((await send("POST", retryPath, { provider: "MOMO" }, { token: "wrong-token" })).status, 404);
    assert.equal((await send("POST", retryPath, { provider: "MOMO" }, { as: ["user-2", "user"] })).status, 404);
    assert.equal((await send("POST", retryPath, { provider: "MOMO" }, { as: ["user-2", "user"], token: "wrong-token" })).status, 404);
    assert.equal((await send("POST", retryPath, { provider: "MOMO" }, { token, csrf: false })).status, 403);
    assert.equal(state.paymentAttempts.size, 1, "none of the refused calls created an attempt");

    const retry = await send("POST", retryPath, { provider: "MOMO" }, { token });
    assert.equal(retry.status, 201);
    assert.equal(state.paymentAttempts.size, 2);
    assert.equal(state.productVariants.get(1).stock, 9);
});

test("confirmation of an online guest order goes to the typed email, only after payment", async () => {
    const { order, attemptId } = await onlineGuestOrder("online.guest@example.test");
    await waitFor(() => sentMail.length >= 1);
    assert.equal(sentMail.filter(isConfirmation).length, 0, "an online order is not confirmed while unpaid");
    const result = await require("../src/repositories/payment.repository").processCallback({
        provider: "MOMO", providerReference: attemptId, amount: order.totalPrice, successful: true
    });
    assert.equal(result.firstTransition, true);
    assert.equal(await orderService.sendOrderConfirmation(order.id), true);
    const confirmation = sentMail.filter(isConfirmation);
    assert.equal(confirmation.length, 1);
    assert.equal(confirmation[0].to, "online.guest@example.test");
    const [account] = usersWithEmail("online.guest@example.test");
    assert.equal(account.loyaltyPoints, 30, "the first success credits the account");
});

// ── Account lifecycle for guest accounts ────────────────────────────────────

test("recover keeps ignoring a registered account that never verified (it has a password), and unknown emails", async () => {
    state.users.set("user-3", { id: "user-3", email: "unverified@example.test", status: "UNVERIFIED", role: "user", authVersion: 1, forcePasswordChange: false, passwordHash: "x" });
    for (const email of ["unverified@example.test", "nobody@example.test"]) {
        assert.equal((await send("POST", "/api/auth/recover", { email })).status, 202);
    }
    assert.equal(sentMail.length, 0);
    assert.equal(state.users.get("user-3").status, "UNVERIFIED");
});

test("a guest account is never verified by link; Google sign-in resolves to the same account, so its orders appear after login", async () => {
    const order = await (await guestCart("verify.me@example.test")).json();
    sentMail = [];
    assert.equal((await send("POST", "/api/auth/resend-verification", { email: "verify.me@example.test" })).status, 202);
    assert.equal(sentMail.some((message) => /Verify your Digi-Shop email/.test(message.subject)), false);
    assert.equal(mailsTo("verify.me@example.test").filter(isAccountEmail).length, 1, "it gets the recover-flow email instead");

    const google = createAuthService({ googleVerifier: { verifyCredential: async () => ({ email: "google.guest@gmail.com", subject: "g-subject-1" }) } });
    await guestCart("Google.Guest@gmail.com");
    const [googleAccount] = usersWithEmail("google.guest@gmail.com");
    const signedIn = await google.loginGoogle({ credential: "credential" });
    assert.equal(signedIn.user.id, googleAccount.id, "Google links to the account the guest order created");
    assert.equal(state.users.get(googleAccount.id).status, "ACTIVE");
    assert.equal(state.oauthIdentities.length, 1);
    const mine = await orderService.listMyOrders({ id: googleAccount.id });
    assert.equal(mine.data.length, 1);
    assert.ok(order.data.id);
});

// ── Registering or resending on a guest email ───────────────────────────────

const registerBody = (email, extra = {}) => ({
    email, password: "typed-secret-1", username: "typed.name", fullName: "Nguyen Van A", address: "123 Duong ABC, Quan 1", ...extra
});
const isVerification = (message) => /Xác minh email/.test(message.subject);
const isPasswordLink = (message) => /reset-password\.html/.test(message.text);

test("registering on a guest email sends the password link, not a verification link, and stores no password", async () => {
    await guestCart("guest.reg@example.test");
    sentMail = [];
    const fresh = await send("POST", "/api/auth/register", registerBody("brand.new.reg@example.test"));
    const response = await send("POST", "/api/auth/register", registerBody("guest.reg@example.test"));
    assert.equal(response.status, fresh.status);
    assert.deepEqual(await response.json(), await fresh.json(), "no difference between a new and a guest email");
    await waitFor(() => sentMail.length >= 2);
    assert.equal(sentMail.some(isVerification), false);
    assert.equal(mailsTo("guest.reg@example.test").filter(isPasswordLink).length, 1);
    assert.equal(mailsTo("brand.new.reg@example.test").filter(isPasswordLink).length, 1);
    assert.equal(usersWithEmail("guest.reg@example.test")[0].passwordHash, null, "the typed password is not stored");
    const login = await send("POST", "/api/auth/login", { identifier: "guest.reg@example.test", password: "typed-secret-1" });
    assert.equal(login.status, 401);
});

test("resending verification to a guest email sends the account email and answers like any other email", async () => {
    await guestCart("guest.resend@example.test");
    sentMail = [];
    const guest = await send("POST", "/api/auth/resend-verification", { email: "guest.resend@example.test" });
    const unknown = await send("POST", "/api/auth/resend-verification", { email: "nobody.at.all@example.test" });
    assert.equal(guest.status, unknown.status);
    assert.deepEqual(await guest.json(), await unknown.json());
    assert.equal(sentMail.some(isVerification), false);
    assert.equal(mailsTo("guest.resend@example.test").filter(isAccountEmail).length, 1);
    assert.equal(state.users.get(usersWithEmail("guest.resend@example.test")[0].id).status, "UNVERIFIED");
});

test("a legacy unverified account with a password still gets the verification link on register and resend", async () => {
    state.users.set("legacy-1", { id: "legacy-1", email: "plain.reg@example.test", status: "UNVERIFIED", role: "user", authVersion: 1, forcePasswordChange: false, passwordHash: "x" });
    assert.equal((await send("POST", "/api/auth/register", registerBody("plain.reg@example.test"))).status < 300, true);
    await waitFor(() => mailsTo("plain.reg@example.test").length >= 1);
    assert.equal(mailsTo("plain.reg@example.test").filter(isVerification).length, 1);
    assert.match(mailsTo("plain.reg@example.test")[0].text, /\/verify-email\.html\?token=/);
    sentMail = [];
    await send("POST", "/api/auth/resend-verification", { email: "plain.reg@example.test" });
    assert.equal(mailsTo("plain.reg@example.test").filter(isVerification).length, 1);
    assert.equal(mailsTo("plain.reg@example.test").filter(isAccountEmail).length, 0);
});

// ── Order detail for a guest ────────────────────────────────────────────────

test("a guest reads the order detail with the right token; wrong, missing and stranger-without-token are refused", async () => {
    const { order, token } = await onlineGuestOrder();
    const ok = await send("GET", `/api/orders/${order.id}`, undefined, { token });
    assert.equal(ok.status, 200);
    const data = (await ok.json()).data;
    assert.equal(data.id, order.id);
    assert.equal(data.guestAccessTokenHash, undefined);
    assert.equal(data.customerEmail, undefined);

    const wrong = await send("GET", `/api/orders/${order.id}`, undefined, { token: "wrong-token" });
    const unknown = await send("GET", "/api/orders/does-not-exist", undefined, { token });
    assert.equal(wrong.status, 404);
    assert.deepEqual(await wrong.json(), await unknown.json());
    assert.equal((await send("GET", `/api/orders/${order.id}`)).status, 401);
    assert.equal((await send("GET", `/api/orders/${order.id}`, undefined, { as: ["user-2", "user"] })).status, 404);
    assert.equal((await send("GET", `/api/orders/${order.id}`, undefined, { as: ["user-2", "user"], token })).status, 200);
    assert.equal((await send("GET", `/api/orders/${order.id}?token=${token}`)).status, 401, "header only");
});

// ── Signed-in checkout is unaffected ────────────────────────────────────────

test("signed-in checkout still needs a session, issues no guest token and confirms to the account email", async () => {
    const anonymous = await send("POST", "/api/checkout/batch", { items: [{ variantId: 1, quantity: 1 }], paymentMethod: "COD", ...customer });
    assert.equal(anonymous.status, 401);
    assert.equal((await send("POST", "/api/vouchers/quote", { items: [{ variantId: 1, quantity: 1 }] })).status, 401);

    const response = await send("POST", "/api/checkout/batch", { items: [{ variantId: 1, quantity: 1 }], paymentMethod: "COD", ...customer }, { as: ["user-1", "user"] });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.data.guestAccessToken, undefined);
    const stored = state.orders.get(body.data.id);
    assert.equal(stored.userId, "user-1");
    assert.equal(stored.customerEmail, undefined);
    assert.equal(stored.guestAccessTokenHash, undefined);
    await waitFor(() => sentMail.length >= 1);
    assert.deepEqual(sentMail.map((message) => message.to), ["khach@example.test"]);
    assert.equal(state.users.get("user-1").loyaltyPoints, 7, "a COD order is credited on delivery");

    const withPoints = await send("POST", "/api/checkout/batch", { items: [{ variantId: 1, quantity: 1 }], paymentMethod: "COD", pointsToUse: 5, ...customer }, { as: ["user-1", "user"] });
    assert.equal((await withPoints.json()).data.pointsRedeemed, 5, "signed-in customers still spend points");
});
