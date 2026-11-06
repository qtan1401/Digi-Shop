const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://username.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";

let users;

const uniqueError = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
// SQL Server's default collation compares case-insensitively; the fake mirrors the unique index.
const sameText = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const usernameTaken = (username, exceptId) =>
    users.some((user) => user.id !== exceptId && sameText(user.username, username));
const emailTaken = (email) => users.some((user) => sameText(user.email, email));
const tick = () => new Promise((resolve) => setImmediate(resolve));

const fakePrisma = {
    user: {
        // Prisma only accepts unique fields here; `username` has a filtered index, not @unique.
        findUnique: async ({ where }) => {
            await tick();
            if (where.id === undefined) throw new Error("findUnique requires a unique field (username is not @unique)");
            const found = users.find((user) => user.id === where.id);
            return found ? structuredClone(found) : null;
        },
        findFirst: async ({ where }) => {
            await tick();
            const found = where.username !== undefined
                ? users.find((user) => sameText(user.username, where.username))
                : users.find((user) => sameText(user.email, where.email));
            return found ? structuredClone(found) : null;
        },
        create: async ({ data }) => {
            await tick();
            if (emailTaken(data.email) || (data.username && usernameTaken(data.username))) throw uniqueError();
            const row = { username: null, emailVerifiedAt: null, passwordLockedAt: null, ...data };
            users.push(row);
            return structuredClone(row);
        },
        updateMany: async ({ where, data }) => {
            await tick();
            const row = users.find((user) =>
                user.id === where.id && user.role === where.role && user.username === where.username
            );
            if (!row) return { count: 0 };
            if (data.username && usernameTaken(data.username, row.id)) throw uniqueError();
            Object.assign(row, data);
            return { count: 1 };
        }
    },
    $transaction: async () => { throw new Error("verification mail is not part of this test"); }
};

const db = require("../src/db/prisma");
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

let server;
let baseUrl;

const makeUser = (id, overrides = {}) => ({
    id,
    email: `${id}@example.test`,
    username: null,
    passwordHash: null,
    role: "user",
    status: "ACTIVE",
    authVersion: 1,
    forcePasswordChange: false,
    ...overrides
});

const headersFor = (userId, role = "user") => {
    const token = jwt.sign({ type: "access", ver: 1, role }, process.env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: "10m" });
    return {
        Cookie: `__Host-access_token=${token}; __Host-csrf_token=csrf-1`,
        Origin: process.env.APP_ORIGIN,
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-1"
    };
};

const anonymousHeaders = {
    Cookie: "__Host-csrf_token=csrf-1",
    Origin: process.env.APP_ORIGIN,
    "Content-Type": "application/json",
    "X-CSRF-Token": "csrf-1"
};

const setUsername = (userId, username, role) => fetch(`${baseUrl}/api/auth/username`, {
    method: "POST",
    headers: headersFor(userId, role),
    body: JSON.stringify({ username })
});

const register = (body) => fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: anonymousHeaders,
    body: JSON.stringify(body)
});

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
    users = [makeUser("customer-1"), makeUser("customer-2")];
});

test("username rules: length, characters, separators and reserved words", async () => {
    const accepted = ["abc", "a".repeat(30), "Nguyen.Van-A_1", "a1b", "x.y-z"];
    const rejected = [
        "ab", "a".repeat(31), "", "has space", "tên-việt", "bad!char", "a@b.c",
        ".abc", "abc.", "-abc", "abc_", "a..b", "a._b", "a--b",
        "admin", "ADMIN", "Administrator", "root", "System", "support", "NodeShop", "ad.min", "no-de_shop"
    ];
    for (const username of accepted) {
        users = [makeUser("customer-1")];
        const response = await setUsername("customer-1", username);
        assert.equal(response.status, 200, `expected ${JSON.stringify(username)} to be accepted`);
    }
    for (const username of rejected) {
        users = [makeUser("customer-1")];
        const response = await setUsername("customer-1", username);
        assert.equal(response.status, 422, `expected ${JSON.stringify(username)} to be rejected`);
        const payload = await response.json();
        assert.equal(payload.error.code, "VALIDATION_FAILED");
        assert.equal(payload.error.fields.username, true);
        assert.equal(users[0].username, null);
    }
});

test("set-once stores the username and returns the user summary", async () => {
    const response = await setUsername("customer-1", "  Minh_Anh ");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.data.user.username, "Minh_Anh");
    assert.equal(payload.data.user.id, "customer-1");
    assert.equal(payload.data.user.passwordHash, undefined);
    assert.equal(users[0].username, "Minh_Anh");
});

test("a username cannot be changed once set", async () => {
    assert.equal((await setUsername("customer-1", "first-name")).status, 200);
    const second = await setUsername("customer-1", "second-name");
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, "USERNAME_ALREADY_SET");
    assert.equal(users[0].username, "first-name");
});

test("usernames are unique case-insensitively", async () => {
    assert.equal((await setUsername("customer-1", "Shared.Name")).status, 200);
    const clash = await setUsername("customer-2", "shared.name");
    assert.equal(clash.status, 409);
    assert.equal((await clash.json()).error.code, "USERNAME_TAKEN");
    assert.equal(users[1].username, null);
});

test("administrator accounts and anonymous callers cannot use the endpoint", async () => {
    users.push(makeUser("root-admin", { role: "admin" }));
    const admin = await setUsername("root-admin", "boss-user", "admin");
    assert.equal(admin.status, 403);
    assert.equal(users[2].username, null);

    const anonymous = await fetch(`${baseUrl}/api/auth/username`, {
        method: "POST",
        headers: anonymousHeaders,
        body: JSON.stringify({ username: "someone" })
    });
    assert.equal(anonymous.status, 401);
});

test("set-once requires a valid CSRF token", async () => {
    const response = await fetch(`${baseUrl}/api/auth/username`, {
        method: "POST",
        headers: { ...headersFor("customer-1"), "X-CSRF-Token": "wrong" },
        body: JSON.stringify({ username: "someone" })
    });
    assert.equal(response.status, 403);
    assert.equal(users[0].username, null);
});

test("two customers racing for the same username: exactly one wins", async () => {
    const [a, b] = await Promise.all([
        setUsername("customer-1", "Racer.One"),
        setUsername("customer-2", "racer.one")
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const loser = a.status === 409 ? a : b;
    assert.equal((await loser.json()).error.code, "USERNAME_TAKEN");
    assert.equal(users.filter((user) => user.username).length, 1);
});

test("the same customer racing two usernames keeps exactly one", async () => {
    const [a, b] = await Promise.all([
        setUsername("customer-1", "first-try"),
        setUsername("customer-1", "second-try")
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const loser = a.status === 409 ? a : b;
    assert.equal((await loser.json()).error.code, "USERNAME_ALREADY_SET");
});

test("register requires a valid username", async () => {
    const base = { email: "new@example.test", password: "secret123" };
    for (const username of [undefined, "", "ab", "bad name", "admin"]) {
        const response = await register({ ...base, username });
        assert.equal(response.status, 400, `username ${JSON.stringify(username)}`);
        const payload = await response.json();
        assert.equal(payload.error.code, "VALIDATION_FAILED");
        assert.equal(payload.error.fields.username, true);
    }
    assert.equal(users.some((user) => user.email === "new@example.test"), false);
});

test("register persists the username and rejects a taken one", async () => {
    const created = await register({ email: "new@example.test", password: "secret123", username: "Newbie" });
    assert.equal(created.status, 201);
    const row = users.find((user) => user.email === "new@example.test");
    assert.equal(row.username, "Newbie");

    const taken = await register({ email: "other@example.test", password: "secret123", username: "newbie" });
    assert.equal(taken.status, 409);
    assert.equal((await taken.json()).error.code, "USERNAME_TAKEN");
    assert.equal(users.some((user) => user.email === "other@example.test"), false);
});

test("register keeps the generic duplicate answer for a taken email, whatever the username", async () => {
    users.push(makeUser("holder", { email: "held@example.test", username: "Holder", status: "ACTIVE" }));
    const sameUsername = await register({ email: "held@example.test", password: "secret123", username: "holder" });
    const otherUsername = await register({ email: "held@example.test", password: "secret123", username: "Fresh.Name" });
    assert.equal(sameUsername.status, 201);
    assert.equal(otherUsername.status, 201);
    const first = await sameUsername.json();
    const second = await otherUsername.json();
    assert.equal(first.data.duplicate, true);
    assert.deepEqual(first, second);
    assert.equal(users.length, 3);
});
