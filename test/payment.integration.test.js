const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://payments.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.MOMO_PARTNER_CODE = "MOMOPARTNER";
process.env.MOMO_ACCESS_KEY = "momo-test-access";
process.env.MOMO_SECRET_KEY = "momo-test-secret";
process.env.VNPAY_TMN_CODE = "ABCD1234";
process.env.VNPAY_HASH_SECRET = "vnpay-test-secret";
process.env.VNPAY_PAY_URL = "https://pay.vnpay.vn/vpcpay.html";
process.env.VNPAY_IPN_URL = "https://payments.example.test/api/payments/vnpay/ipn";

let state;
let transactionTail = Promise.resolve();

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        if (Object.hasOwn(expected, "lte") && new Date(actual) > new Date(expected.lte)) return false;
        if (Object.hasOwn(expected, "gt") && new Date(actual) <= new Date(expected.gt)) return false;
        return true;
    }
    return actual === expected;
});

const withRelations = (row, args, current) => {
    if (!row) return undefined;
    const result = clone(row);
    if (args?.include?.items) {
        result.items = current.orderItems.filter((item) => item.orderId === row.id).map(clone);
    }
    if (args?.include?.order && row.orderId) {
        const order = current.orders.get(row.orderId);
        result.order = order ? clone(order) : null;
    }
    return result;
};

const makeClient = () => {
    const client = {
        $queryRaw: async (_strings, key) => {
            const product = state.products.get(key);
            if (product && typeof key === "number") return [clone(product)];
            return state.orders.has(key) ? [{ id: key }] : [];
        },
        user: {
            findUnique: async ({ where }) => clone(state.users.get(where.id) || null)
        },
        order: {
            create: async ({ data }) => {
                const { items: nestedItems, ...fields } = clone(data);
                const createdItems = nestedItems.create.map((item, index) => ({
                    id: index + 1,
                    orderId: data.id,
                    ...item
                }));
                const row = { ...fields, items: createdItems };
                state.orders.set(row.id, row);
                state.orderItems.push(...createdItems);
                return clone(row);
            },
            findUnique: async (args) => withRelations(state.orders.get(args.where.id), args, state),
            updateMany: async ({ where, data }) => {
                const row = state.orders.get(where.id);
                if (!row || !matches(row, where)) return { count: 0 };
                Object.assign(row, clone(data));
                return { count: 1 };
            }
        },
        orderItem: {
            findMany: async ({ where = {} }) => state.orderItems.filter((row) => matches(row, where)).map(clone)
        },
        product: {
            update: async ({ where, data }) => {
                const row = state.products.get(where.id);
                if (!row) throw new Error("product not found");
                if (data.stock?.increment !== undefined) row.stock += data.stock.increment;
                if (data.stock?.decrement !== undefined) row.stock -= data.stock.decrement;
                return clone(row);
            },
            updateMany: async ({ where, data }) => {
                const row = state.products.get(where.id);
                if (!row || (where.isDeleted !== undefined && row.isDeleted !== where.isDeleted) ||
                    (where.stock?.gte !== undefined && row.stock < where.stock.gte)) return { count: 0 };
                if (data.stock?.decrement !== undefined) row.stock -= data.stock.decrement;
                if (data.stock?.increment !== undefined) row.stock += data.stock.increment;
                return { count: 1 };
            }
        },
        paymentAttempt: {
            findUnique: async (args) => withRelations(state.paymentAttempts.get(args.where.id), args, state),
            findFirst: async (args) => {
                const row = [...state.paymentAttempts.values()].find((item) => matches(item, args.where));
                return withRelations(row, args, state);
            },
            findMany: async (args = {}) => {
                let rows = [...state.paymentAttempts.values()].filter((row) => matches(row, args.where));
                if (args.orderBy?.createdAt === "asc") rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                if (args.orderBy?.createdAt === "desc") rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                if (args.orderBy?.expiresAt === "asc") rows.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
                if (args.orderBy?.completedAt === "desc") rows.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
                if (args.take !== undefined) rows = rows.slice(0, args.take);
                return rows.map((row) => withRelations(row, args, state));
            },
            create: async ({ data }) => {
                const now = new Date();
                const row = { createdAt: now, updatedAt: now, ...clone(data) };
                state.paymentAttempts.set(row.id, row);
                return clone(row);
            },
            update: async ({ where, data }) => {
                const row = state.paymentAttempts.get(where.id);
                if (!row) throw new Error("payment attempt not found");
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
            const previousTransaction = transactionTail;
            let release;
            transactionTail = new Promise((resolve) => { release = resolve; });
            await previousTransaction;
            const previousState = state;
            state = clone(state);
            try {
                return await work(makeClient());
            } catch (error) {
                state = previousState;
                throw error;
            } finally {
                release();
            }
        }
    };
    return client;
};

const db = require("../src/db/prisma");
const fakePrisma = makeClient();
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

const makeState = ({ attemptId = "a".repeat(32), expiresAt = new Date(Date.now() - 1000), stock = 0 } = {}) => {
    const createdAt = new Date(Date.now() - 10_000);
    const order = {
        id: "ORD-TEST-01",
        userId: "user-test-01",
        subtotal: 100_000,
        shippingFee: 0,
        discount: 0,
        totalPrice: 100_000,
        customerName: "Test Buyer",
        customerPhone: "0901234567",
        customerAddress: "Test address",
        customerNote: null,
        paymentMethod: "MOMO",
        orderStatus: "PENDING",
        paymentStatus: "UNPAID",
        createdAt,
        updatedAt: createdAt
    };
    const attempt = {
        id: attemptId,
        orderId: order.id,
        provider: "MOMO",
        amount: 100_000,
        status: "PENDING",
        providerTransactionId: null,
        qrPayload: null,
        paymentUrl: null,
        expiresAt,
        inventoryReleasedAt: null,
        completedAt: null,
        createdAt,
        updatedAt: createdAt
    };
    return {
        orders: new Map([[order.id, order]]),
        orderItems: [{ orderId: order.id, productId: 1, quantity: 1, nameSnapshot: "Test item", imageSnapshot: "", unitPrice: 100_000, lineTotal: 100_000 }],
        products: new Map([[1, { id: 1, name: "Test item", image: "", price: 100_000, stock, isDeleted: false }]]),
        paymentAttempts: new Map([[attempt.id, attempt]]),
        users: new Map([
            ["user-test-01", { id: "user-test-01", status: "ACTIVE", role: "user", authVersion: 1, forcePasswordChange: false }],
            ["admin-test-01", { id: "admin-test-01", status: "ACTIVE", role: "admin", authVersion: 1, forcePasswordChange: false }]
        ])
    };
};

const tokenFor = (id, role = "user") => jwt.sign(
    { type: "access", ver: 1, role },
    process.env.JWT_ACCESS_SECRET,
    { subject: id, expiresIn: "10m" }
);

const headersFor = (id = "user-test-01", role = "user", csrf = false) => {
    const csrfValue = "csrf-token-for-payment-tests";
    const headers = {
        Cookie: `__Host-access_token=${tokenFor(id, role)}${csrf ? `; __Host-csrf_token=${csrfValue}` : ""}`
    };
    if (csrf) {
        headers.Origin = process.env.APP_ORIGIN;
        headers["x-csrf-token"] = csrfValue;
    }
    return headers;
};

const signMomo = (fields) => {
    const data = [
        `accessKey=${process.env.MOMO_ACCESS_KEY}`,
        `amount=${fields.amount}`,
        `extraData=${fields.extraData}`,
        `message=${fields.message}`,
        `orderId=${fields.orderId}`,
        `orderInfo=${fields.orderInfo}`,
        `orderType=${fields.orderType}`,
        `partnerCode=${fields.partnerCode}`,
        `payType=${fields.payType}`,
        `requestId=${fields.requestId}`,
        `responseTime=${fields.responseTime}`,
        `resultCode=${fields.resultCode}`,
        `transId=${fields.transId}`
    ].join("&");
    return crypto.createHmac("sha256", process.env.MOMO_SECRET_KEY).update(data).digest("hex");
};

const formEncode = (value) => encodeURIComponent(String(value))
    .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");

const signVnPay = (params) => {
    const canonical = Object.keys(params).filter((key) => key.startsWith("vnp_") && key !== "vnp_SecureHash")
        .sort().map((key) => `${formEncode(key)}=${formEncode(params[key])}`).join("&");
    return crypto.createHmac("sha512", process.env.VNPAY_HASH_SECRET).update(canonical).digest("hex");
};

const vnpayFields = (attemptId) => ({
    vnp_Amount: "10000000",
    vnp_BankCode: "VNPAYQR",
    vnp_CardType: "QR",
    vnp_OrderInfo: "Payment attempt",
    vnp_ResponseCode: "00",
    vnp_TmnCode: process.env.VNPAY_TMN_CODE,
    vnp_TxnRef: attemptId,
    vnp_TransactionNo: "987654321",
    vnp_TransactionStatus: "00"
});

let server;
let baseUrl;
before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
    state = makeState();
    transactionTail = Promise.resolve();
});

test("MoMo retry API creates a unique QR attempt, confirms only a signed callback, and remains idempotent", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (_url, options) => {
        const request = JSON.parse(options.body);
        const response = {
            partnerCode: request.partnerCode,
            orderId: request.orderId,
            requestId: request.requestId,
            amount: request.amount,
            message: "Successful.",
            payUrl: "https://payment.momo.vn/pay/test",
            responseTime: Date.now(),
            resultCode: 0,
            qrCodeUrl: "000201010212TESTQR"
        };
        const signatureData = [
            `accessKey=${process.env.MOMO_ACCESS_KEY}`,
            `amount=${response.amount}`,
            `message=${response.message}`,
            `orderId=${response.orderId}`,
            `partnerCode=${response.partnerCode}`,
            `payUrl=${response.payUrl}`,
            `requestId=${response.requestId}`,
            `responseTime=${response.responseTime}`,
            `resultCode=${response.resultCode}`
        ].join("&");
        response.signature = crypto.createHmac("sha256", process.env.MOMO_SECRET_KEY).update(signatureData).digest("hex");
        return { ok: true, json: async () => response };
    };

    try {
        const response = await originalFetch(`${baseUrl}/api/payments/orders/ORD-TEST-01/attempts`, {
            method: "POST",
            headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "MOMO" })
        });
        assert.equal(response.status, 201);
        const { data: attempt } = await response.json();
        assert.notEqual(attempt.id, "a".repeat(32));
        assert.equal(attempt.provider, "MOMO");
        assert.equal(attempt.status, "PENDING");
        assert.match(attempt.qrDataUrl, /^data:image\/png;base64,/);
        assert.equal(attempt.paymentUrl, "https://payment.momo.vn/pay/test");
        const remainingMs = Date.parse(attempt.expiresAt) - Date.now();
        assert.ok(remainingMs > 295_000 && remainingMs <= 300_000);
        const activeRetry = await originalFetch(`${baseUrl}/api/payments/orders/ORD-TEST-01/attempts`, {
            method: "POST",
            headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "VNPAY" })
        });
        assert.equal(activeRetry.status, 409);
        assert.equal((await activeRetry.json()).error.code, "PAYMENT_ATTEMPT_ACTIVE");
        assert.equal(state.paymentAttempts.size, 2);
        assert.equal(state.paymentAttempts.get("a".repeat(32)).status, "EXPIRED");
        assert.equal(state.products.get(1).stock, 0);

        const callback = {
            amount: 100_000,
            partnerCode: process.env.MOMO_PARTNER_CODE,
            orderId: attempt.id,
            requestId: attempt.id,
            extraData: "",
            message: "Successful.",
            orderInfo: "Payment attempt",
            orderType: "momo_wallet",
            payType: "qr",
            responseTime: Date.now(),
            resultCode: 0,
            transId: 987654321
        };
        callback.signature = signMomo(callback);
        const paid = await originalFetch(`${baseUrl}/api/payments/momo/callback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(callback)
        });
        assert.equal(paid.status, 204);
        assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "PAID");
        assert.equal(state.paymentAttempts.get(attempt.id).status, "SUCCEEDED");
        assert.equal(state.products.get(1).stock, 0);

        const duplicate = await originalFetch(`${baseUrl}/api/payments/momo/callback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(callback)
        });
        assert.equal(duplicate.status, 204);
        assert.equal(state.products.get(1).stock, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test("VNPay signed success after expiry releases stock once and stays in reconciliation", async () => {
    const attemptId = "a".repeat(32);
    state.paymentAttempts.get(attemptId).provider = "VNPAY";
    const fields = vnpayFields(attemptId);
    fields.vnp_SecureHash = signVnPay(fields);
    const query = new URLSearchParams(fields);

    const callback = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${query}`);
    assert.equal(callback.status, 200);
    assert.equal((await callback.json()).RspCode, "00");
    assert.equal(state.paymentAttempts.get(attemptId).status, "LATE_SUCCESS");
    assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "UNPAID");
    assert.equal(state.products.get(1).stock, 1);

    const duplicate = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${query}`);
    assert.equal((await duplicate.json()).RspCode, "00");
    assert.equal(state.products.get(1).stock, 1);

    const reconciliation = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: headersFor("admin-test-01", "admin")
    });
    assert.equal(reconciliation.status, 200);
    const entries = (await reconciliation.json()).data;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, attemptId);
    assert.equal(entries[0].orderPaymentStatus, "UNPAID");
});

test("expiry racing a signed provider success releases inventory once and never pays late", async () => {
    const attemptId = "a".repeat(32);
    state.paymentAttempts.get(attemptId).provider = "VNPAY";
    const fields = vnpayFields(attemptId);
    fields.vnp_SecureHash = signVnPay(fields);
    const query = new URLSearchParams(fields);

    const [statusResponse, callbackResponse] = await Promise.all([
        fetch(`${baseUrl}/api/payments/attempts/${attemptId}`, { headers: headersFor() }),
        fetch(`${baseUrl}/api/payments/vnpay/ipn?${query}`)
    ]);

    assert.equal(statusResponse.status, 200);
    assert.ok(["EXPIRED", "LATE_SUCCESS"].includes((await statusResponse.json()).data.status));
    assert.equal((await callbackResponse.json()).RspCode, "00");
    assert.equal(state.paymentAttempts.get(attemptId).status, "LATE_SUCCESS");
    assert.ok(state.paymentAttempts.get(attemptId).inventoryReleasedAt);
    assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "UNPAID");
    assert.equal(state.products.get(1).stock, 1);
});

test("timely signed VNPay success marks the order paid idempotently", async () => {
    const attemptId = "a".repeat(32);
    state.paymentAttempts.get(attemptId).provider = "VNPAY";
    state.paymentAttempts.get(attemptId).expiresAt = new Date(Date.now() + 60_000);
    const fields = vnpayFields(attemptId);
    fields.vnp_SecureHash = signVnPay(fields);

    const response = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${new URLSearchParams(fields)}`);
    assert.equal((await response.json()).RspCode, "00");
    assert.equal(state.paymentAttempts.get(attemptId).status, "SUCCEEDED");
    assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "PAID");
    assert.equal(state.products.get(1).stock, 0);

    const duplicate = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${new URLSearchParams(fields)}`);
    assert.equal((await duplicate.json()).RspCode, "00");
    assert.equal(state.products.get(1).stock, 0);
});

test("VNPay retry API regenerates a hosted VNPAYQR payment URL for the same order", async () => {
    const response = await fetch(`${baseUrl}/api/payments/orders/ORD-TEST-01/attempts`, {
        method: "POST",
        headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "VNPAY" })
    });
    assert.equal(response.status, 201, await response.clone().text());
    const { data: attempt } = await response.json();
    assert.equal(attempt.orderId, "ORD-TEST-01");
    assert.equal(attempt.provider, "VNPAY");
    assert.equal(attempt.status, "PENDING");
    const paymentUrl = new URL(attempt.paymentUrl);
    assert.equal(paymentUrl.origin, "https://pay.vnpay.vn");
    assert.equal(paymentUrl.pathname, "/vpcpay.html");
    assert.equal(paymentUrl.searchParams.get("vnp_BankCode"), "VNPAYQR");
    assert.equal(paymentUrl.searchParams.get("vnp_TxnRef"), attempt.id);
    assert.equal(paymentUrl.searchParams.get("vnp_Amount"), "10000000");
    const signedParams = Object.fromEntries(paymentUrl.searchParams.entries());
    const generatedSignature = signedParams.vnp_SecureHash;
    delete signedParams.vnp_SecureHash;
    assert.equal(generatedSignature, signVnPay(signedParams));
    assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "UNPAID");
    assert.equal(state.products.get(1).stock, 0);
});

test("retry rejects when inventory was sold after an expired attempt released its reservation", async () => {
    const attemptId = "a".repeat(32);
    const expiredResponse = await fetch(`${baseUrl}/api/payments/attempts/${attemptId}`, {
        headers: headersFor()
    });
    assert.equal(expiredResponse.status, 200);
    assert.equal((await expiredResponse.json()).data.status, "EXPIRED");
    assert.equal(state.products.get(1).stock, 1);

    state.products.get(1).stock = 0;
    const retry = await fetch(`${baseUrl}/api/payments/orders/ORD-TEST-01/attempts`, {
        method: "POST",
        headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "VNPAY" })
    });
    assert.equal(retry.status, 409);
    assert.equal((await retry.json()).error.code, "PAYMENT_STOCK_UNAVAILABLE");
    assert.equal(state.paymentAttempts.size, 1);
    assert.equal(state.paymentAttempts.get(attemptId).status, "EXPIRED");
    assert.equal(state.products.get(1).stock, 0);
});

test("callback rejects invalid signatures without changing order or inventory", async () => {
    const fields = vnpayFields("a".repeat(32));
    fields.vnp_SecureHash = "0".repeat(128);
    const response = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${new URLSearchParams(fields)}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).RspCode, "97");
    assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "UNPAID");
    assert.equal(state.paymentAttempts.get("a".repeat(32)).status, "PENDING");
    assert.equal(state.products.get(1).stock, 0);
});

test("signed VNPay amount mismatch and unknown attempt cannot mutate payment state", async () => {
    const attemptId = "a".repeat(32);
    state.paymentAttempts.get(attemptId).provider = "VNPAY";
    const wrongAmount = vnpayFields(attemptId);
    wrongAmount.vnp_Amount = "10000100";
    wrongAmount.vnp_SecureHash = signVnPay(wrongAmount);
    const mismatch = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${new URLSearchParams(wrongAmount)}`);
    assert.equal((await mismatch.json()).RspCode, "04");
    assert.equal(state.paymentAttempts.get(attemptId).status, "PENDING");
    assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "UNPAID");
    assert.equal(state.products.get(1).stock, 0);

    const unknownAttempt = vnpayFields("b".repeat(32));
    unknownAttempt.vnp_SecureHash = signVnPay(unknownAttempt);
    const notFound = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${new URLSearchParams(unknownAttempt)}`);
    assert.equal((await notFound.json()).RspCode, "01");
    assert.equal(state.paymentAttempts.get(attemptId).status, "PENDING");
    assert.equal(state.products.get(1).stock, 0);
});

test("signed VNPay failure releases reserved stock once and leaves the order unpaid", async () => {
    const attemptId = "a".repeat(32);
    state.paymentAttempts.get(attemptId).provider = "VNPAY";
    state.paymentAttempts.get(attemptId).expiresAt = new Date(Date.now() + 60_000);
    const fields = vnpayFields(attemptId);
    fields.vnp_ResponseCode = "24";
    fields.vnp_TransactionStatus = "24";
    fields.vnp_SecureHash = signVnPay(fields);

    const failed = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${new URLSearchParams(fields)}`);
    assert.equal((await failed.json()).RspCode, "00");
    assert.equal(state.paymentAttempts.get(attemptId).status, "FAILED");
    assert.equal(state.orders.get("ORD-TEST-01").paymentStatus, "UNPAID");
    assert.equal(state.products.get(1).stock, 1);

    const duplicate = await fetch(`${baseUrl}/api/payments/vnpay/ipn?${new URLSearchParams(fields)}`);
    assert.equal((await duplicate.json()).RspCode, "00");
    assert.equal(state.products.get(1).stock, 1);
});

test("initial checkout keeps COD and BANKING compatible and passes VNPay checkout IP", async () => {
    state = makeState({ stock: 5 });
    const checkout = async (paymentMethod) => fetch(`${baseUrl}/api/checkout/1`, {
        method: "POST",
        headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
        body: JSON.stringify({
            quantity: 1,
            customerName: "Test Buyer",
            customerPhone: "0901234567",
            customerAddress: "123 Test Street",
            paymentMethod
        })
    });

    const codResponse = await checkout("COD");
    assert.equal(codResponse.status, 201);
    const codOrder = (await codResponse.json()).data;
    assert.equal(codOrder.paymentMethod, "Thanh toán khi nhận hàng (COD)");
    assert.equal(codOrder.paymentStatus, "UNPAID");
    assert.equal(codOrder.paymentAttempt, undefined);

    const bankingResponse = await checkout("BANKING");
    assert.equal(bankingResponse.status, 201);
    const bankingOrder = (await bankingResponse.json()).data;
    assert.equal(bankingOrder.paymentMethod, "Chuyển khoản ngân hàng");
    assert.equal(bankingOrder.paymentStatus, "UNPAID");
    assert.equal(bankingOrder.paymentAttempt, undefined);

    const vnPayResponse = await checkout("VNPAY");
    assert.equal(vnPayResponse.status, 201);
    const vnPayOrder = (await vnPayResponse.json()).data;
    assert.equal(vnPayOrder.paymentMethod, "VNPAY");
    assert.equal(vnPayOrder.paymentAttempt.status, "PENDING");
    assert.equal(new URL(vnPayOrder.paymentAttempt.paymentUrl).searchParams.get("vnp_IpAddr"), "127.0.0.1");
    assert.equal(vnPayOrder.orderStatus, "PENDING");
    assert.equal(vnPayOrder.paymentStatus, "UNPAID");
});

test("provider initialization failure preserves the same unpaid order and releases its reservation", async () => {
    state = makeState({ stock: 5 });
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("mock MoMo network outage"); };
    try {
        const response = await originalFetch(`${baseUrl}/api/checkout/1`, {
            method: "POST",
            headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
            body: JSON.stringify({
                quantity: 1,
                customerName: "Test Buyer",
                customerPhone: "0901234567",
                customerAddress: "123 Test Street",
                paymentMethod: "MOMO"
            })
        });
        assert.equal(response.status, 201);
        const order = (await response.json()).data;
        assert.equal(order.orderStatus, "PENDING");
        assert.equal(order.paymentStatus, "UNPAID");
        assert.equal(order.paymentAttempt.status, "FAILED");
        assert.equal(state.orders.get(order.id).paymentStatus, "UNPAID");
        assert.equal(state.products.get(1).stock, 5);
    } finally {
        global.fetch = originalFetch;
    }
});

test("MoMo rejects the screenshot-sized order before HTTP and the same order retries through VNPay", async () => {
    state = makeState({ stock: 7 });
    state.products.get(1).price = 34_990_000;
    const originalFetch = global.fetch;
    let providerRequests = 0;
    global.fetch = async () => {
        providerRequests += 1;
        throw new Error("MoMo should reject this amount before HTTP");
    };
    try {
        const checkout = await originalFetch(`${baseUrl}/api/checkout/1`, {
            method: "POST",
            headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
            body: JSON.stringify({
                quantity: 7,
                customerName: "Test Buyer",
                customerPhone: "0901234567",
                customerAddress: "123 Test Street",
                paymentMethod: "MOMO"
            })
        });
        assert.equal(checkout.status, 201);
        const order = (await checkout.json()).data;
        assert.equal(order.totalPrice, 245_030_000);
        assert.equal(order.orderStatus, "PENDING");
        assert.equal(order.paymentStatus, "UNPAID");
        assert.equal(order.paymentAttempt.provider, "MOMO");
        assert.equal(order.paymentAttempt.amount, 245_030_000);
        assert.equal(order.paymentAttempt.status, "FAILED");
        assert.equal(state.products.get(1).stock, 7);
        assert.equal(providerRequests, 0);

        const retry = await originalFetch(`${baseUrl}/api/payments/orders/${encodeURIComponent(order.id)}/attempts`, {
            method: "POST",
            headers: { ...headersFor("user-test-01", "user", true), "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "VNPAY" })
        });
        assert.equal(retry.status, 201, await retry.clone().text());
        const attempt = (await retry.json()).data;
        const paymentUrl = new URL(attempt.paymentUrl);
        assert.equal(attempt.orderId, order.id);
        assert.equal(attempt.provider, "VNPAY");
        assert.equal(attempt.amount, 245_030_000);
        assert.equal(attempt.status, "PENDING");
        assert.equal(paymentUrl.searchParams.get("vnp_Amount"), "24503000000");
        assert.equal(state.orders.get(order.id).paymentStatus, "UNPAID");
        assert.equal(state.products.get(1).stock, 0);
        assert.equal(providerRequests, 0);
    } finally {
        global.fetch = originalFetch;
    }
});
