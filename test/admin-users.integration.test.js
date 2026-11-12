const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { startAdminApp } = require("../test-support/admin-harness");

const state = { users: [], orders: [], orderItems: [], variants: [], products: [], refreshSessions: [], auditLogs: [], calls: [] };
const harness = startAdminApp(state);
// Required only now: repositories bind getPrismaClient when first loaded, which must be after the fake is installed.
const { hashPassword } = require("../src/services/auth.service");
const ADMIN = ["root", "admin"];

const makeUser = (id, overrides = {}) => ({
    id, email: `${id}@example.test`, username: id, fullName: `Khach ${id}`, passwordHash: null,
    role: "user", status: "ACTIVE", emailVerifiedAt: new Date("2026-01-01T00:00:00Z"), authVersion: 1,
    forcePasswordChange: false, failedPasswordAttempts: 0, passwordLockedAt: null, loyaltyPoints: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"), ...overrides
});

before(() => harness.start());
after(() => harness.stop());
beforeEach(() => {
    state.users = [makeUser("root", { role: "admin", fullName: null, createdAt: new Date("2025-01-01T00:00:00Z") })];
    state.orders = [];
    state.refreshSessions = [];
    state.auditLogs = [];
});

const addCustomers = (count) => {
    for (let i = 1; i <= count; i += 1) {
        state.users.push(makeUser(`c${String(i).padStart(2, "0")}`, { createdAt: new Date(Date.UTC(2026, 1, 1, 0, i)) }));
    }
};

test("only administrators may list or change customers", async () => {
    addCustomers(1);
    assert.equal((await harness.json("GET", "/api/admin/users")).status, 401);
    assert.equal((await harness.json("GET", "/api/admin/users", { as: ["c01", "user"] })).status, 403);
    assert.equal((await harness.json("PATCH", "/api/admin/users/c01", { as: ["c01", "user"], body: { status: "BANNED" } })).status, 403);
});

test("the list is 20 per page, newest first, customers only, with order counts", async () => {
    addCustomers(25);
    state.orders.push({ id: "O1", userId: "c25", createdAt: new Date(), orderStatus: "PENDING" });
    const first = await harness.json("GET", "/api/admin/users", { as: ADMIN });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 20);
    assert.deepEqual(first.body.meta, { page: 1, pageSize: 20, total: 25, totalPages: 2 });
    assert.equal(first.body.data[0].id, "c25", "newest customer first");
    assert.equal(first.body.data[0].orderCount, 1);
    assert.ok(first.body.data.every((row) => row.role === "user"), "administrators are never listed");
    assert.equal("passwordHash" in first.body.data[0], false);
    const second = await harness.json("GET", "/api/admin/users?page=2", { as: ADMIN });
    assert.equal(second.body.data.length, 5);
    const beyond = await harness.json("GET", "/api/admin/users?page=9", { as: ADMIN });
    assert.equal(beyond.body.meta.page, 2, "an out-of-range page is clamped");
    assert.equal((await harness.json("GET", "/api/admin/users?page=0", { as: ADMIN })).status, 400);
    assert.equal((await harness.json("GET", "/api/admin/users?pageSize=51", { as: ADMIN })).status, 400);
});

test("search matches email, full name and username", async () => {
    state.users.push(makeUser("a1", { email: "linh@shop.test", fullName: "Nguyễn Linh", username: "nl" }));
    state.users.push(makeUser("a2", { email: "minh@shop.test", fullName: "Trần Minh", username: "tm" }));
    const byEmail = await harness.json("GET", "/api/admin/users?q=LINH@", { as: ADMIN });
    assert.deepEqual(byEmail.body.data.map((row) => row.id), ["a1"]);
    const byName = await harness.json("GET", "/api/admin/users?q=" + encodeURIComponent("Trần"), { as: ADMIN });
    assert.deepEqual(byName.body.data.map((row) => row.id), ["a2"]);
    assert.equal((await harness.json("GET", "/api/admin/users?q=" + "x".repeat(101), { as: ADMIN })).status, 400);
});

test("banning revokes sessions and bumps authVersion, audits, and the old access token stops working", async () => {
    state.users.push(makeUser("victim"));
    state.refreshSessions.push({ id: "s1", userId: "victim", revokedAt: null });
    assert.equal((await harness.json("GET", "/api/orders/mine", { as: ["victim", "user"] })).status, 200);

    const response = await harness.json("PATCH", "/api/admin/users/victim", { as: ADMIN, body: { status: "BANNED" } });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, "BANNED");
    assert.notEqual(state.refreshSessions[0].revokedAt, null);
    assert.equal(state.users.find((user) => user.id === "victim").authVersion, 2);
    assert.deepEqual(state.auditLogs.map((log) => [log.action, log.entity, log.entityId, log.actor]), [["BAN", "user", "victim", "root"]]);
    assert.equal((await harness.json("GET", "/api/orders/mine", { as: ["victim", "user"] })).status, 401);
});

test("unbanning restores ACTIVE for a verified email and UNVERIFIED otherwise", async () => {
    state.users.push(makeUser("v", { status: "BANNED" }), makeUser("u", { status: "BANNED", emailVerifiedAt: null }));
    assert.equal((await harness.json("PATCH", "/api/admin/users/v", { as: ADMIN, body: { status: "ACTIVE" } })).body.data.status, "ACTIVE");
    assert.equal((await harness.json("PATCH", "/api/admin/users/u", { as: ADMIN, body: { status: "ACTIVE" } })).body.data.status, "UNVERIFIED");
    assert.deepEqual(state.auditLogs.map((log) => log.action), ["UNBAN", "UNBAN"]);
});

test("an administrator cannot be banned or renamed, and unknown ids are 404", async () => {
    state.users.push(makeUser("boss", { role: "admin" }));
    const banned = await harness.json("PATCH", "/api/admin/users/boss", { as: ADMIN, body: { status: "BANNED" } });
    assert.equal(banned.status, 403);
    assert.equal(banned.body.error.code, "CANNOT_MODIFY_ADMIN");
    assert.equal(state.users.find((user) => user.id === "boss").status, "ACTIVE");
    assert.equal((await harness.json("PATCH", "/api/admin/users/root", { as: ADMIN, body: { status: "BANNED" } })).status, 403, "not even themselves");
    assert.equal((await harness.json("PATCH", "/api/admin/users/nobody", { as: ADMIN, body: { status: "BANNED" } })).status, 404);
});

test("renaming validates and normalises the full name, and audits the change", async () => {
    state.users.push(makeUser("n1"));
    assert.equal((await harness.json("PATCH", "/api/admin/users/n1", { as: ADMIN, body: { fullName: "A" } })).status, 400);
    assert.equal((await harness.json("PATCH", "/api/admin/users/n1", { as: ADMIN, body: { fullName: "x".repeat(201) } })).status, 400);
    assert.equal((await harness.json("PATCH", "/api/admin/users/n1", { as: ADMIN, body: {} })).status, 400);
    assert.equal((await harness.json("PATCH", "/api/admin/users/n1", { as: ADMIN, body: { status: "DELETED" } })).status, 400);
    const ok = await harness.json("PATCH", "/api/admin/users/n1", { as: ADMIN, body: { fullName: "  Lê   Văn  An " } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.fullName, "Lê Văn An");
    assert.equal(state.auditLogs[0].action, "UPDATE");
});

test("only ACTIVE or BANNED accounts can be moved: an unverified account cannot be 'activated'", async () => {
    state.users.push(makeUser("p", { status: "UNVERIFIED", emailVerifiedAt: null }));
    assert.equal((await harness.json("PATCH", "/api/admin/users/p", { as: ADMIN, body: { status: "ACTIVE" } })).status, 400);
    assert.equal(state.users.find((user) => user.id === "p").status, "UNVERIFIED");
});

test("PATCH needs the CSRF token", async () => {
    state.users.push(makeUser("x"));
    assert.equal((await harness.json("PATCH", "/api/admin/users/x", { as: ADMIN, csrf: false, body: { status: "BANNED" } })).status, 403);
    assert.equal(state.users.find((user) => user.id === "x").status, "ACTIVE");
});

test("a banned customer gets 403 ACCOUNT_BANNED with the right password, 401 with a wrong one", async () => {
    state.users.push(makeUser("locked", { status: "BANNED", passwordHash: await hashPassword("Correct-horse-1") }));
    const good = await harness.json("POST", "/api/auth/login", { body: { identifier: "locked@example.test", password: "Correct-horse-1" } });
    assert.equal(good.status, 403);
    assert.equal(good.body.error.code, "ACCOUNT_BANNED");
    assert.match(good.body.error.message, /khóa/);
    assert.equal(state.refreshSessions.length, 0, "no session is issued");
    const bad = await harness.json("POST", "/api/auth/login", { body: { identifier: "locked@example.test", password: "wrong-password-1" } });
    assert.equal(bad.status, 401);
});

test("after the ban is lifted the customer can sign in again", async () => {
    state.users.push(makeUser("back", { status: "BANNED", passwordHash: await hashPassword("Correct-horse-1") }));
    await harness.json("PATCH", "/api/admin/users/back", { as: ADMIN, body: { status: "ACTIVE" } });
    const login = await harness.json("POST", "/api/auth/login", { body: { identifier: "back@example.test", password: "Correct-horse-1" } });
    assert.equal(login.status, 200);
});
