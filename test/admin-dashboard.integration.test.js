const assert = require("node:assert/strict");
const { after, afterEach, before, beforeEach, test } = require("node:test");
const { startAdminApp } = require("../test-support/admin-harness");

const state = { users: [], orders: [], orderItems: [], orderVouchers: [], variants: [], products: [], refreshSessions: [], auditLogs: [], calls: [] };
const harness = startAdminApp(state);
const dashboardService = require("../src/services/admin-dashboard.service");
const ADMIN = ["root", "admin"];

let seq;
const addOrder = ({ createdAt, orderStatus = "PENDING", paymentStatus = "UNPAID", discount = 0, pointsDiscount = 0, lines }) => {
    seq += 1;
    const id = `O${seq}`;
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    state.orders.push({
        id, userId: "c1", orderStatus, paymentStatus, discount, pointsDiscount,
        totalPrice: subtotal - discount - pointsDiscount, createdAt: new Date(createdAt), customerName: "x", customerPhone: "0"
    });
    for (const line of lines) state.orderItems.push({ id: ++seq * 100, orderId: id, ...line });
};

before(() => harness.start());
after(() => harness.stop());
beforeEach(() => {
    seq = 0;
    process.env.ADMIN_EXTRAS = "0";
    const now = new Date("2026-06-15T05:00:00Z");
    state.users = [
        { id: "root", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false, createdAt: new Date("2025-01-01Z") },
        { id: "c1", role: "user", status: "ACTIVE", authVersion: 1, createdAt: new Date(now.getTime() - 30 * 86400e3) },
        { id: "c2", role: "user", status: "ACTIVE", authVersion: 1, createdAt: new Date(now.getTime() - 3 * 86400e3) },
        { id: "c3", role: "user", status: "BANNED", authVersion: 1, createdAt: new Date(now.getTime() - 1 * 86400e3) }
    ];
    state.products = [{ id: 1, name: "Laptop A", deviceType: "laptop" }, { id: 2, name: "Chuột B", deviceType: "mouse" }];
    state.variants = [{ id: 11, productId: 1 }, { id: 21, productId: 2 }];
    state.orders = [];
    state.orderItems = [];
    const laptop = (quantity, cost = 800) => ({ variantId: 11, quantity, unitPrice: 1000, unitCost: cost, lineTotal: 1000 * quantity });
    const mouse = (quantity) => ({ variantId: 21, quantity, unitPrice: 100, unitCost: 80, lineTotal: 100 * quantity });
    // A: paid, Q1 (March). discount 50 + points 10: revenue 940, profit (1000-800) - 60 = 140.
    addOrder({ createdAt: "2026-03-15T03:00:00Z", orderStatus: "PROCESSING", paymentStatus: "PAID", discount: 50, pointsDiscount: 10, lines: [laptop(1)] });
    // B: delivered, unpaid COD, 1 April 00:00 Vietnam (31 March 17:00 UTC) -> Q2. revenue 300, profit 60, 3 mice.
    addOrder({ createdAt: "2026-03-31T17:00:00Z", orderStatus: "DELIVERED", lines: [mouse(3)] });
    // C: cancelled although paid: excluded everywhere.
    addOrder({ createdAt: "2026-03-20T03:00:00Z", orderStatus: "CANCELLED", paymentStatus: "PAID", lines: [laptop(5)] });
    // D: pending unpaid: an order, but no revenue, profit or units sold.
    addOrder({ createdAt: "2026-03-16T03:00:00Z", lines: [laptop(2)] });
    // E: paid, 1 Jan 00:00 Vietnam (31 Dec 17:00 UTC) -> 2026.
    addOrder({ createdAt: "2025-12-31T17:00:00Z", orderStatus: "SHIPPED", paymentStatus: "PAID", lines: [mouse(1)] });
    // F: paid, 31 Dec 23:59 Vietnam -> 2025.
    addOrder({ createdAt: "2025-12-31T16:59:59Z", orderStatus: "SHIPPED", paymentStatus: "PAID", lines: [laptop(1)] });
});
afterEach(() => { delete process.env.ADMIN_EXTRAS; });

const get = (path, as = ADMIN) => harness.json("GET", path, { as });

test("dashboard endpoints are admin only", async () => {
    for (const path of ["/api/admin/dashboard/summary", "/api/admin/dashboard/series"]) {
        assert.equal((await harness.json("GET", path)).status, 401, path);
        assert.equal((await harness.json("GET", path, { as: ["c1", "user"] })).status, 403, path);
    }
});

test("summary: users, new users, orders, revenue and top 5 products, without loading orders", async () => {
    const { status, body } = await get("/api/admin/dashboard/summary");
    assert.equal(status, 200);
    const data = body.data;
    assert.equal(data.totalUsers, 3, "customers only, banned included, administrators not");
    assert.equal(data.orders, 5, "every order that is not cancelled");
    assert.equal(data.pendingOrders, 1);
    // revenue orders: A 940 + B 300 + E 100 + F 1000
    assert.equal(data.revenue, 2340);
    assert.deepEqual(data.topProducts.map((p) => [p.name, p.quantity, p.revenue]), [["Chuột B", 4, 400], ["Laptop A", 2, 2000]]);
    assert.ok(!state.calls.includes("order.findMany"), "the summary never reads whole orders");
});

test("new users counts the last 7 days from the given clock", async () => {
    const result = await dashboardService.getSummary(new Date("2026-06-15T05:00:00Z"));
    assert.equal(result.newUsers, 2);
    const later = await dashboardService.getSummary(new Date("2026-06-20T05:00:00Z"));
    assert.equal(later.newUsers, 1);
});

test("top products is capped at 5", async () => {
    for (let id = 3; id <= 8; id += 1) {
        state.products.push({ id, name: `P${id}`, deviceType: "ssd" });
        state.variants.push({ id: id * 10, productId: id });
        addOrder({ createdAt: "2026-04-01T03:00:00Z", paymentStatus: "PAID", lines: [{ variantId: id * 10, quantity: id, unitPrice: 1, unitCost: 0, lineTotal: id }] });
    }
    const { body } = await get("/api/admin/dashboard/summary");
    assert.equal(body.data.topProducts.length, 5);
    assert.equal(body.data.topProducts[0].name, "P8");
});

test("series by month for 2026: cancelled and unpaid orders never reach revenue or profit", async () => {
    const { status, body } = await get("/api/admin/dashboard/series?granularity=month&from=2026-01-01&to=2026-12-31");
    assert.equal(status, 200);
    const data = body.data;
    assert.equal(data.buckets.length, 12);
    assert.deepEqual(data.buckets.map((b) => b.label).slice(0, 4), ["T1/2026", "T2/2026", "T3/2026", "T4/2026"]);
    const [jan, feb, mar, apr] = data.buckets;
    assert.deepEqual([jan.orders, jan.revenue, jan.profit, jan.itemsSold], [1, 100, 20, 1], "E sits on 1 January in Vietnam time");
    assert.deepEqual([feb.orders, feb.revenue, feb.profit], [0, 0, 0]);
    assert.deepEqual([mar.orders, mar.revenue, mar.profit, mar.itemsSold], [2, 940, 140, 1], "A paid + D pending; C cancelled ignored");
    assert.deepEqual(mar.deviceTypes, { laptop: 1 });
    assert.deepEqual([apr.orders, apr.revenue, apr.profit, apr.itemsSold], [1, 300, 60, 3], "B is 1 April in Vietnam time");
    assert.deepEqual(data.totals, { orders: 4, revenue: 1340, profit: 220, itemsSold: 5 });
    assert.deepEqual(data.deviceTypes, [
        { deviceType: "mouse", quantity: 4, revenue: 400 },
        { deviceType: "laptop", quantity: 1, revenue: 1000 }
    ]);
});

test("series by quarter puts the 31 March 17:00 UTC order in Q2", async () => {
    const { body } = await get("/api/admin/dashboard/series?granularity=quarter&from=2026-01-01&to=2026-12-31");
    assert.deepEqual(body.data.buckets.map((b) => [b.label, b.orders, b.revenue]), [["Q1/2026", 3, 1040], ["Q2/2026", 1, 300], ["Q3/2026", 0, 0], ["Q4/2026", 0, 0]]);
});

test("series by year covers both years, and 31 Dec 16:59:59 UTC belongs to 2025", async () => {
    const { body } = await get("/api/admin/dashboard/series?granularity=year&from=2025-01-01&to=2026-12-31");
    assert.deepEqual(body.data.buckets.map((b) => [b.label, b.orders, b.revenue]), [["2025", 1, 1000], ["2026", 4, 1340]]);
});

test("series by week starts on Monday: a custom week range around 1 April", async () => {
    const { body } = await get("/api/admin/dashboard/series?granularity=week&from=2026-03-30&to=2026-04-05");
    assert.equal(body.data.buckets.length, 1);
    assert.deepEqual([body.data.buckets[0].label, body.data.buckets[0].key, body.data.buckets[0].orders], ["30/03", "2026-03-30", 1]);
    const wide = await get("/api/admin/dashboard/series?granularity=week&from=2026-03-10&to=2026-03-22");
    assert.deepEqual(wide.body.data.buckets.map((b) => b.key), ["2026-03-09", "2026-03-16"]);
    assert.deepEqual(wide.body.data.buckets.map((b) => b.orders), [1, 1], "A on Sun 15 Mar is in the week of the 9th, D on Mon 16th in the next (C cancelled)");
});

test("a range with no orders is all zeros, and an unbounded query defaults to the current year by month", async () => {
    const empty = await get("/api/admin/dashboard/series?granularity=month&from=2024-01-01&to=2024-03-31");
    assert.deepEqual(empty.body.data.totals, { orders: 0, revenue: 0, profit: 0, itemsSold: 0 });
    assert.equal(empty.body.data.buckets.length, 3);
    const defaults = await get("/api/admin/dashboard/series");
    assert.equal(defaults.body.data.granularity, "month");
    assert.equal(defaults.body.data.buckets.length, 12);
});

test("invalid granularity or dates, or too many buckets, are 400", async () => {
    for (const query of ["?granularity=day", "?from=2026-02-30", "?from=2026-05-02&to=2026-05-01", "?to=nope",
        "?granularity=week&from=2000-01-01&to=2100-12-31", "?granularity=year&granularity=month"]) {
        const response = await get(`/api/admin/dashboard/series${query}`);
        assert.equal(response.status, 400, query);
        assert.equal(response.body.error.code, "INVALID_FILTER", query);
    }
});

test("ADMIN_EXTRAS off hides account creation, audit log and review moderation behind 404; on lets them through", async () => {
    const hidden = [["GET", "/api/admin/audit-logs"], ["GET", "/api/admin/reviews"], ["PATCH", "/api/admin/reviews/1"], ["POST", "/api/admin/accounts"]];
    for (const [method, path] of hidden) {
        assert.equal((await harness.json(method, path, { as: ADMIN, body: {} })).status, 404, `${method} ${path}`);
    }
    assert.equal((await harness.json("GET", "/api/admin/audit-logs")).status, 401, "anonymous callers are still refused first");
    assert.equal((await get("/api/admin/features")).body.data.extras, false);
    // Kept features are not hidden.
    assert.notEqual((await get("/api/admin/users")).status, 404);

    process.env.ADMIN_EXTRAS = "1";
    assert.equal((await get("/api/admin/features")).body.data.extras, true);
    for (const [method, path] of hidden) {
        assert.notEqual((await harness.json(method, path, { as: ADMIN, body: {} })).status, 404, `${method} ${path} when enabled`);
    }
});
