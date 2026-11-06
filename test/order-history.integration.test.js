const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://orders.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";

// ===== In-memory Prisma fake: only the order-history paths, as strict as the real client =====
let users;
let products;
let variants;
let orders;
let orderItems;
let orderVouchers;
let paymentAttempts;
let reviews;
let calls;

const STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];

const unsupported = (what) => { throw new Error(`Fake Prisma: unsupported ${what}`); };

/** findUnique accepts exactly one unique field, like the real client. */
const uniqueId = (where, field = "id") => {
    const keys = Object.keys(where || {});
    if (keys.length !== 1 || keys[0] !== field) unsupported(`findUnique where ${JSON.stringify(where)}`);
    return where[field];
};

const byNewest = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const orderMatches = (row, where = {}) => {
    for (const [key, value] of Object.entries(where)) {
        if (key !== "userId" && key !== "orderStatus") unsupported(`order where.${key}`);
        if (row[key] !== value) return false;
    }
    return true;
};

const rowOf = (order) => ({
    ...order,
    createdAt: new Date(order.createdAt * 1000),
    updatedAt: new Date(order.createdAt * 1000),
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null
});

const itemsOf = (orderId) => orderItems.filter((item) => item.orderId === orderId).sort((a, b) => a.id - b.id);

const fakePrisma = {
    user: {
        findUnique: async ({ where }) => {
            const row = users.find((user) => user.id === uniqueId(where));
            return row ? { ...row } : null;
        }
    },
    order: {
        findUnique: async ({ where, include }) => {
            calls.push("order.findUnique");
            const order = orders.find((row) => row.id === uniqueId(where));
            if (!order) return null;
            const items = itemsOf(order.id).map((item) => {
                const variant = variants.find((row) => row.id === item.variantId);
                const product = products.find((row) => row.id === variant.productId);
                return {
                    ...item,
                    variant: include.items.include?.variant
                        ? { productId: variant.productId, product: product ? { isDeleted: product.isDeleted } : null }
                        : undefined
                };
            });
            const row = {
                ...rowOf(order),
                items,
                vouchers: orderVouchers.filter((entry) => entry.orderId === order.id)
            };
            if (include.paymentAttempts) {
                assert.equal(include.paymentAttempts.take, 1);
                row.paymentAttempts = paymentAttempts
                    .filter((attempt) => attempt.orderId === order.id)
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .slice(0, 1);
            }
            return row;
        },
        groupBy: async ({ by, where }) => {
            calls.push("order.groupBy");
            assert.deepEqual(by, ["orderStatus"]);
            const groups = new Map();
            for (const row of orders.filter((candidate) => orderMatches(candidate, where))) {
                groups.set(row.orderStatus, (groups.get(row.orderStatus) || 0) + 1);
            }
            return [...groups].map(([orderStatus, count]) => ({ orderStatus, _count: { _all: count } }));
        },
        findMany: async ({ where, orderBy, skip = 0, take, select }) => {
            calls.push("order.findMany");
            assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
            assert.ok(select, "list query must select explicit columns");
            assert.equal(select.customerPhone, undefined);
            assert.equal(select.customerAddress, undefined);
            return orders
                .filter((row) => orderMatches(row, where))
                .sort(byNewest)
                .slice(skip, skip + take)
                .map((order) => ({
                    ...rowOf(order),
                    items: itemsOf(order.id).slice(0, select.items.take),
                    _count: {
                        items: itemsOf(order.id).length,
                        vouchers: orderVouchers.filter((entry) => entry.orderId === order.id).length
                    }
                }));
        }
    },
    orderItem: {
        groupBy: async ({ by, where, _sum }) => {
            calls.push("orderItem.groupBy");
            assert.deepEqual(by, ["orderId"]);
            assert.deepEqual(_sum, { quantity: true });
            return where.orderId.in.map((orderId) => ({
                orderId,
                _sum: { quantity: itemsOf(orderId).reduce((total, item) => total + item.quantity, 0) }
            }));
        }
    },
    productReview: {
        findMany: async ({ where, select }) => {
            calls.push("productReview.findMany");
            assert.deepEqual(Object.keys(where).sort(), ["productId", "userId"]);
            return reviews
                .filter((row) => row.userId === where.userId && where.productId.in.includes(row.productId))
                .map((row) => ({ productId: row.productId, rating: select.rating ? row.rating : undefined }));
        }
    }
};

const db = require("../src/db/prisma");
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

// ===== Harness =====
let server;
let baseUrl;

const tokenFor = (id, role) => jwt.sign(
    { type: "access", ver: 1, role },
    process.env.JWT_ACCESS_SECRET,
    { subject: id, expiresIn: "10m" }
);

const get = (path, as) => fetch(`${baseUrl}${path}`, {
    headers: {
        Origin: process.env.APP_ORIGIN,
        ...(as ? { Cookie: `__Host-access_token=${tokenFor(as.id, as.role)}` } : {})
    }
});

const ALICE = { id: "alice", role: "user" };
const BOB = { id: "bob", role: "user" };
const ADMIN = { id: "admin-1", role: "admin" };

let clock;
let itemSeq;

const addOrder = (id, userId, orderStatus, variantQuantities = [[11, 1]], fields = {}) => {
    orders.push({
        id,
        userId,
        orderStatus,
        paymentStatus: "UNPAID",
        paymentMethod: "COD",
        subtotal: 100,
        shippingFee: 10,
        discount: 0,
        totalPrice: 110,
        customerName: "Ten",
        customerPhone: "0900000000",
        customerAddress: "Dia chi",
        customerNote: null,
        createdAt: ++clock,
        ...fields
    });
    for (const [variantId, quantity] of variantQuantities) {
        orderItems.push({
            id: ++itemSeq,
            orderId: id,
            variantId,
            nameSnapshot: `Item ${variantId}`,
            imageSnapshot: `/img/${variantId}.png`,
            skuSnapshot: `SKU-${variantId}`,
            optionsSnapshot: JSON.stringify({ Mau: "Den" }),
            unitPrice: 50,
            quantity,
            lineTotal: 50 * quantity
        });
    }
};

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
    const user = (id, role) => ({ id, email: `${id}@x.test`, username: id, role, status: "ACTIVE", authVersion: 1, forcePasswordChange: false });
    users = [user("alice", "user"), user("bob", "user"), user("admin-1", "admin")];
    products = [
        { id: 1, isDeleted: false },
        { id: 2, isDeleted: false },
        { id: 3, isDeleted: true }
    ];
    variants = [
        { id: 11, productId: 1 },
        { id: 12, productId: 1 },
        { id: 21, productId: 2 },
        { id: 31, productId: 3 }
    ];
    orders = [];
    orderItems = [];
    orderVouchers = [];
    paymentAttempts = [];
    reviews = [];
    calls = [];
    clock = 1000;
    itemSeq = 0;
});

// ===== Access =====

test("anonymous callers get 401 and administrators 403 on /mine", async () => {
    assert.equal((await get("/api/orders/mine")).status, 401);
    assert.equal((await get("/api/orders/mine", ADMIN)).status, 403);
});

test("a customer only sees their own orders in the list", async () => {
    addOrder("A1", "alice", "PENDING");
    addOrder("B1", "bob", "PENDING");
    addOrder("A2", "alice", "DELIVERED");

    const body = await (await get("/api/orders/mine", ALICE)).json();
    assert.deepEqual(body.data.map((order) => order.id), ["A2", "A1"]);
    assert.equal(body.meta.total, 2);
    assert.equal(body.meta.counts.all, 2);

    const bobBody = await (await get("/api/orders/mine", BOB)).json();
    assert.deepEqual(bobBody.data.map((order) => order.id), ["B1"]);
});

test("another customer's order detail is 404, the owner and admin can read it", async () => {
    addOrder("B1", "bob", "PENDING");

    const foreign = await get("/api/orders/B1", ALICE);
    assert.equal(foreign.status, 404);
    assert.equal((await foreign.json()).error.code, "ORDER_NOT_FOUND");
    assert.equal((await get("/api/orders/B1", BOB)).status, 200);
    assert.equal((await get("/api/orders/B1", ADMIN)).status, 200);
    assert.equal((await get("/api/orders/missing", ALICE)).status, 404);
});

// ===== List shape =====

test("list rows carry the summary, no customer contact data, and cap the preview at 3", async () => {
    addOrder("A1", "alice", "SHIPPED", [[11, 2], [12, 1], [21, 4], [31, 3]], { paymentStatus: "PAID", paymentMethod: "VNPAY", totalPrice: 777 });
    orderVouchers.push({ orderId: "A1", voucherId: 1 }, { orderId: "A1", voucherId: 2 });

    const body = await (await get("/api/orders/mine", ALICE)).json();
    assert.equal(body.success, true);
    const [row] = body.data;
    assert.deepEqual(Object.keys(row).sort(), [
        "createdAt", "id", "itemCount", "items", "lineCount", "orderStatus", "paymentMethod", "paymentStatus", "totalPrice", "voucherCount"
    ]);
    assert.equal(row.itemCount, 10);
    assert.equal(row.lineCount, 4);
    assert.equal(row.voucherCount, 2);
    assert.equal(row.totalPrice, 777);
    assert.equal(row.paymentStatus, "PAID");
    assert.equal(row.paymentMethod, "VNPAY");
    assert.equal(row.orderStatus, "SHIPPED");
    assert.match(row.createdAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(row.items.length, 3);
    assert.deepEqual(row.items[0], { name: "Item 11", image: "/img/11.png", options: { Mau: "Den" }, quantity: 2 });
    assert.doesNotMatch(JSON.stringify(body), /0900000000|Dia chi/);
});

test("the list uses a fixed number of queries regardless of page size", async () => {
    for (let i = 0; i < 10; i++) addOrder(`A${i}`, "alice", "PENDING");
    await get("/api/orders/mine", ALICE);
    assert.deepEqual(calls, ["order.groupBy", "order.findMany", "orderItem.groupBy"]);
});

test("an empty history returns an empty page and zero counts", async () => {
    const body = await (await get("/api/orders/mine", ALICE)).json();
    assert.deepEqual(body.data, []);
    assert.deepEqual(body.meta, {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        counts: { all: 0, PENDING: 0, PROCESSING: 0, SHIPPED: 0, DELIVERED: 0, CANCELLED: 0 }
    });
});

// ===== Pagination =====

test("pagination defaults, page size, ordering and clamping to the last page", async () => {
    for (let i = 1; i <= 25; i++) addOrder(`A${String(i).padStart(2, "0")}`, "alice", "PENDING");

    const first = await (await get("/api/orders/mine", ALICE)).json();
    assert.equal(first.data.length, 10);
    assert.equal(first.data[0].id, "A25");
    assert.deepEqual(
        { page: first.meta.page, pageSize: first.meta.pageSize, total: first.meta.total, totalPages: first.meta.totalPages },
        { page: 1, pageSize: 10, total: 25, totalPages: 3 }
    );

    const third = await (await get("/api/orders/mine?page=3", ALICE)).json();
    assert.deepEqual(third.data.map((order) => order.id), ["A05", "A04", "A03", "A02", "A01"]);

    const beyond = await (await get("/api/orders/mine?page=99", ALICE)).json();
    assert.equal(beyond.meta.page, 3);
    assert.deepEqual(beyond.data.map((order) => order.id), third.data.map((order) => order.id));

    const small = await (await get("/api/orders/mine?pageSize=7&page=2", ALICE)).json();
    assert.equal(small.data.length, 7);
    assert.equal(small.meta.totalPages, 4);
    assert.equal(small.data[0].id, "A18");

    const max = await (await get("/api/orders/mine?pageSize=50", ALICE)).json();
    assert.equal(max.data.length, 25);
});

test("orders created in the same instant keep a stable id-descending order", async () => {
    addOrder("A1", "alice", "PENDING", [[11, 1]], { createdAt: 5 });
    addOrder("A3", "alice", "PENDING", [[11, 1]], { createdAt: 5 });
    addOrder("A2", "alice", "PENDING", [[11, 1]], { createdAt: 5 });
    const body = await (await get("/api/orders/mine", ALICE)).json();
    assert.deepEqual(body.data.map((order) => order.id), ["A3", "A2", "A1"]);
});

test("invalid pagination parameters are rejected with INVALID_PAGINATION", async () => {
    for (const query of ["page=0", "page=-1", "page=abc", "page=1.5", "page=", "pageSize=0", "pageSize=51", "pageSize=x", "page=1&page=2", "page=99999999999999999999"]) {
        const response = await get(`/api/orders/mine?${query}`, ALICE);
        assert.equal(response.status, 400, query);
        assert.equal((await response.json()).error.code, "INVALID_PAGINATION", query);
    }
});

// ===== Status filter =====

test("status filter narrows the page and total but counts always cover every order", async () => {
    addOrder("A1", "alice", "PENDING");
    addOrder("A2", "alice", "DELIVERED");
    addOrder("A3", "alice", "DELIVERED");
    addOrder("A4", "alice", "CANCELLED");
    addOrder("B1", "bob", "DELIVERED");

    const delivered = await (await get("/api/orders/mine?status=DELIVERED", ALICE)).json();
    assert.deepEqual(delivered.data.map((order) => order.id), ["A3", "A2"]);
    assert.equal(delivered.meta.total, 2);
    assert.deepEqual(delivered.meta.counts, { all: 4, PENDING: 1, PROCESSING: 0, SHIPPED: 0, DELIVERED: 2, CANCELLED: 1 });

    const all = await (await get("/api/orders/mine?status=all", ALICE)).json();
    assert.equal(all.meta.total, 4);
    assert.deepEqual(all.meta.counts, delivered.meta.counts);

    for (const status of STATUSES) {
        const body = await (await get(`/api/orders/mine?status=${status}`, ALICE)).json();
        assert.ok(body.data.every((order) => order.orderStatus === status));
        assert.equal(body.meta.total, body.meta.counts[status]);
    }

    const none = await (await get("/api/orders/mine?status=SHIPPED&page=4", ALICE)).json();
    assert.deepEqual(none.data, []);
    assert.equal(none.meta.page, 1);
    assert.equal(none.meta.totalPages, 1);
});

test("an unknown status is rejected with INVALID_FILTER", async () => {
    for (const status of ["bogus", "pending", "ALL", ""]) {
        const response = await get(`/api/orders/mine?status=${status}`, ALICE);
        assert.equal(response.status, 400, status);
        assert.equal((await response.json()).error.code, "INVALID_FILTER", status);
    }
});

// ===== Detail: product link and review state =====

test("detail items carry productId and productAvailable (false for a soft-deleted product)", async () => {
    addOrder("A1", "alice", "PENDING", [[11, 1], [31, 1]]);
    const { data } = await (await get("/api/orders/A1", ALICE)).json();
    assert.equal(data.items[0].productId, 1);
    assert.equal(data.items[0].productAvailable, true);
    assert.equal(data.items[1].productId, 3);
    assert.equal(data.items[1].productAvailable, false);
    assert.equal(data.items[0].sku, "SKU-11");
    assert.equal(data.customer.name, "Ten");
    assert.equal(data.userId, undefined);
});

test("only DELIVERED orders carry review state, counting hidden reviews and rating-less ones", async () => {
    addOrder("A1", "alice", "DELIVERED", [[11, 1], [21, 1], [31, 1], [12, 1]]);
    reviews.push(
        { id: 1, productId: 1, userId: "alice", rating: 4, isHidden: false },
        { id: 2, productId: 2, userId: "alice", rating: null, isHidden: false },
        { id: 3, productId: 3, userId: "alice", rating: 2, isHidden: true },
        { id: 4, productId: 1, userId: "bob", rating: 1, isHidden: false }
    );

    const { data } = await (await get("/api/orders/A1", ALICE)).json();
    assert.deepEqual(data.items.map((item) => item.review), [
        { exists: true, rating: 4 },
        { exists: true, rating: null },
        { exists: true, rating: 2 },
        { exists: true, rating: 4 }
    ]);
    assert.equal(calls.filter((call) => call === "productReview.findMany").length, 1);
});

test("a delivered order without reviews reports exists:false", async () => {
    addOrder("A1", "alice", "DELIVERED", [[11, 1]]);
    reviews.push({ id: 1, productId: 1, userId: "bob", rating: 5, isHidden: false });
    const { data } = await (await get("/api/orders/A1", ALICE)).json();
    assert.deepEqual(data.items[0].review, { exists: false, rating: null });
});

test("non-delivered orders and admin viewers get no review field", async () => {
    addOrder("A1", "alice", "SHIPPED", [[11, 1]]);
    addOrder("A2", "alice", "DELIVERED", [[11, 1]]);
    reviews.push({ id: 1, productId: 1, userId: "alice", rating: 5, isHidden: false });

    const shipped = (await (await get("/api/orders/A1", ALICE)).json()).data;
    assert.equal("review" in shipped.items[0], false);

    const adminView = (await (await get("/api/orders/A2", ADMIN)).json()).data;
    assert.equal("review" in adminView.items[0], false);
    assert.equal(adminView.items[0].productId, 1);
    assert.equal(calls.filter((call) => call === "productReview.findMany").length, 0);
});

test("detail reports the latest payment attempt, treating an overdue PENDING attempt as EXPIRED", async () => {
    const minutes = (n) => new Date(Date.now() + n * 60_000);
    addOrder("A1", "alice", "PENDING", [[11, 1]], { paymentMethod: "MOMO" });
    addOrder("A2", "alice", "PENDING", [[11, 1]], { paymentMethod: "VNPAY" });
    addOrder("A3", "alice", "PENDING", [[11, 1]]);
    paymentAttempts.push(
        { orderId: "A1", provider: "MOMO", status: "EXPIRED", expiresAt: minutes(-30), createdAt: 1 },
        { orderId: "A1", provider: "MOMO", status: "PENDING", expiresAt: minutes(5), createdAt: 2 },
        { orderId: "A2", provider: "VNPAY", status: "PENDING", expiresAt: minutes(-1), createdAt: 1 }
    );

    const a1 = (await (await get("/api/orders/A1", ALICE)).json()).data;
    assert.equal(a1.paymentAttempt.status, "PENDING");
    assert.equal(a1.paymentAttempt.provider, "MOMO");
    assert.equal(a1.paymentAttempt.expiresAt, paymentAttempts[1].expiresAt.toISOString());
    assert.equal((await (await get("/api/orders/A2", ALICE)).json()).data.paymentAttempt.status, "EXPIRED");
    assert.equal((await (await get("/api/orders/A3", ALICE)).json()).data.paymentAttempt, null);
});

test("cancelledAt is null until the order is cancelled", async () => {
    addOrder("A1", "alice", "PENDING");
    addOrder("A2", "alice", "CANCELLED", [[11, 1]], { cancelledAt: "2026-11-01T08:00:00.000Z" });
    assert.equal((await (await get("/api/orders/A1", ALICE)).json()).data.cancelledAt, null);
    assert.equal((await (await get("/api/orders/A2", ALICE)).json()).data.cancelledAt, "2026-11-01T08:00:00.000Z");
});
