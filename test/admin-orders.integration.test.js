const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { startAdminApp } = require("../test-support/admin-harness");

const state = { users: [], orders: [], orderItems: [], orderVouchers: [], variants: [], products: [], refreshSessions: [], auditLogs: [], calls: [] };
const harness = startAdminApp(state);
const orderService = require("../src/services/order.service");
const ADMIN = ["root", "admin"];
const HOUR = 3600e3;

let seq;
const addOrder = (fields = {}) => {
    seq += 1;
    const order = {
        id: `O${String(seq).padStart(3, "0")}`, userId: "c1", orderStatus: "PENDING", paymentStatus: "UNPAID", paymentMethod: "COD",
        subtotal: 100, shippingFee: 10, discount: 0, pointsDiscount: 0, pointsRedeemed: 0, pointsEarned: 0, totalPrice: 110,
        customerName: "Nguyen Van A", customerPhone: "0900000000", customerAddress: "HN", customerNote: null,
        createdAt: new Date(), updatedAt: new Date(), ...fields
    };
    state.orders.push(order);
    state.orderItems.push({ id: seq, orderId: order.id, variantId: 1, unitPrice: 50, quantity: 2, lineTotal: 100, unitCost: 40 });
    return order;
};

before(() => harness.start());
after(() => harness.stop());
beforeEach(() => {
    seq = 0;
    state.users = [
        { id: "root", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false },
        { id: "c1", role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false }
    ];
    state.orders = [];
    state.orderItems = [];
    state.orderVouchers = [];
});

const list = (query = "") => harness.json("GET", `/api/orders${query}`, { as: ADMIN });

test("the order list is admin only", async () => {
    assert.equal((await harness.json("GET", "/api/orders")).status, 401);
    assert.equal((await harness.json("GET", "/api/orders", { as: ["c1", "user"] })).status, 403);
});

test("pages of 20 by default, newest first, with meta like /mine", async () => {
    for (let i = 0; i < 45; i += 1) addOrder({ createdAt: new Date(Date.UTC(2026, 0, 1) + i * HOUR) });
    const first = await list();
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 20);
    assert.deepEqual(
        { page: first.body.meta.page, pageSize: first.body.meta.pageSize, total: first.body.meta.total, totalPages: first.body.meta.totalPages },
        { page: 1, pageSize: 20, total: 45, totalPages: 3 }
    );
    assert.equal(first.body.data[0].id, "O045", "newest first");
    assert.equal(first.body.meta.counts.all, 45);
    const last = await list("?page=3");
    assert.equal(last.body.data.length, 5);
    assert.equal(last.body.data[4].id, "O001");
    assert.equal((await list("?page=3&pageSize=50")).body.meta.page, 1, "a page past the end is clamped");
    assert.equal((await list("?pageSize=50")).body.data.length, 45);
});

test("invalid page, pageSize, status, range and dates are 400", async () => {
    for (const query of ["?page=0", "?page=x", "?pageSize=51", "?pageSize=0", "?status=NOPE", "?range=decade",
        "?range=custom", "?range=custom&from=2026-13-01", "?range=custom&from=2026-02-30", "?from=01-02-2026", "?from=2026-05-02&to=2026-05-01",
        "?range=today&from=2026-05-01", "?range=week&to=2026-05-01", "?range=today&range=week", "?q=" + "x".repeat(101)]) {
        const response = await list(query);
        assert.equal(response.status, 400, query);
        assert.equal(response.body.success, false, query);
    }
});

test("status filter pages the filtered set and counts stay per status", async () => {
    addOrder(); addOrder({ orderStatus: "DELIVERED" }); addOrder({ orderStatus: "DELIVERED" }); addOrder({ orderStatus: "CANCELLED" });
    const delivered = await list("?status=DELIVERED");
    assert.equal(delivered.body.data.length, 2);
    assert.equal(delivered.body.meta.total, 2);
    assert.deepEqual(delivered.body.meta.counts, { all: 4, PENDING: 1, PROCESSING: 0, SHIPPED: 0, DELIVERED: 2, CANCELLED: 1 });
});

test("payment status filter narrows the list and the per-status counts", async () => {
    addOrder({ paymentStatus: "PAID" }); addOrder({ paymentStatus: "PAID", orderStatus: "DELIVERED" }); addOrder();
    const paid = await list("?paymentStatus=PAID");
    assert.equal(paid.body.meta.total, 2);
    assert.equal(paid.body.meta.counts.all, 2);
    assert.equal((await list("?paymentStatus=NOPE")).status, 400);
});

test("search matches order id, customer name and phone", async () => {
    addOrder({ customerName: "Tran Thi B", customerPhone: "0911111111" }); addOrder({ customerName: "Le C", customerPhone: "0922222222" });
    assert.deepEqual((await list("?q=tran")).body.data.map((o) => o.id), ["O001"]);
    assert.deepEqual((await list("?q=0922")).body.data.map((o) => o.id), ["O002"]);
    assert.deepEqual((await list("?q=O002")).body.data.map((o) => o.id), ["O002"]);
});

test("range today and yesterday use shop days (UTC+7), custom is inclusive", async () => {
    const now = new Date();
    addOrder({ createdAt: now });
    addOrder({ createdAt: new Date(now.getTime() - 24 * HOUR) });
    addOrder({ createdAt: new Date(now.getTime() - 72 * HOUR) });
    assert.deepEqual((await list("?range=today")).body.data.map((o) => o.id), ["O001"]);
    assert.deepEqual((await list("?range=yesterday")).body.data.map((o) => o.id), ["O002"]);

    state.orders = [];
    seq = 0;
    addOrder({ createdAt: new Date("2026-05-01T16:59:59Z") }); // 23:59:59 on 1 May in Vietnam
    addOrder({ createdAt: new Date("2026-05-01T17:00:00Z") }); // 00:00 on 2 May
    addOrder({ createdAt: new Date("2026-05-03T16:59:59Z") }); // 23:59:59 on 3 May
    addOrder({ createdAt: new Date("2026-05-03T17:00:00Z") }); // 4 May
    assert.deepEqual((await list("?range=custom&from=2026-05-02&to=2026-05-03")).body.data.map((o) => o.id), ["O003", "O002"]);
    assert.deepEqual((await list("?from=2026-05-04")).body.data.map((o) => o.id), ["O004"], "from alone implies custom");
    assert.deepEqual((await list("?to=2026-05-01")).body.data.map((o) => o.id), ["O001"]);
});

test("week starts on Monday and month on the 1st, in shop time (fixed clock)", async () => {
    // Wednesday 2026-05-13 12:00 in Vietnam.
    const now = new Date("2026-05-13T05:00:00Z");
    addOrder({ createdAt: new Date("2026-05-10T16:59:59Z") }); // Sun 10 May 23:59 -> previous week
    addOrder({ createdAt: new Date("2026-05-10T17:00:00Z") }); // Mon 11 May 00:00 -> this week
    addOrder({ createdAt: new Date("2026-05-17T16:59:59Z") }); // Sun 17 May 23:59 -> this week
    addOrder({ createdAt: new Date("2026-05-17T17:00:00Z") }); // Mon 18 May -> next week
    addOrder({ createdAt: new Date("2026-04-30T16:59:59Z") }); // 30 Apr 23:59 -> April
    addOrder({ createdAt: new Date("2026-04-30T17:00:00Z") }); // 1 May 00:00 -> May
    const ids = async (range) => (await orderService.getAllOrders({ range, pageSize: "50" }, now)).data.map((o) => o.id).sort();
    assert.deepEqual(await ids("week"), ["O002", "O003"]);
    assert.deepEqual(await ids("month"), ["O001", "O002", "O003", "O004", "O006"]);
    assert.deepEqual(await ids("today"), []);
});

test("each order carries its items, vouchers and points", async () => {
    const order = addOrder({ discount: 20, pointsRedeemed: 5, pointsDiscount: 5000, pointsEarned: 3 });
    state.orderVouchers.push({ orderId: order.id, voucherId: 1, codeSnapshot: "AB12C", typeSnapshot: "PERCENT", percentSnapshot: 10, discountAmount: 20 });
    const row = (await list()).body.data[0];
    assert.equal(row.items.length, 1);
    assert.deepEqual(row.vouchers, [{ code: "AB12C", type: "PERCENT", percent: 10, amount: 20 }]);
    assert.equal(row.pointsRedeemed, 5);
    assert.equal(row.pointsDiscount, 5000);
    assert.equal(row.pointsEarned, 3);
});
