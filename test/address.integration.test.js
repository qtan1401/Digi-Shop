// Never reach a real SMTP server: any mail the registration flow sends goes to this fake transport.
require("nodemailer").createTransport = () => ({ sendMail: async () => {} });

const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://address.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";

let users;
let addresses;
let clock;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const nextTime = () => new Date(Date.UTC(2026, 10, 8, 0, 0, clock++));
const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);
const copy = (row) => (row ? structuredClone(row) : null);

const fakePrisma = {
    user: {
        findUnique: async ({ where }) => { await tick(); return copy(users.find((user) => user.id === where.id)); },
        findFirst: async ({ where }) => {
            await tick();
            return copy(users.find((user) => user.email === where.email || (where.username && user.username === where.username)));
        },
        create: async ({ data }) => {
            await tick();
            const { addresses: nested, ...rest } = data;
            const row = { username: null, fullName: null, emailVerifiedAt: null, passwordLockedAt: null, ...rest };
            users.push(row);
            for (const address of nested?.create || []) addresses.push({ ...address, userId: row.id, createdAt: nextTime() });
            return copy(row);
        },
        update: async ({ where, data }) => {
            await tick();
            const row = users.find((user) => user.id === where.id);
            Object.assign(row, data);
            return copy(row);
        }
    },
    userAddress: {
        findMany: async ({ where }) => {
            await tick();
            return addresses.filter((row) => matches(row, where))
                .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt - a.createdAt).map(copy);
        },
        findFirst: async ({ where, orderBy }) => {
            await tick();
            const found = addresses.filter((row) => matches(row, where));
            if (orderBy?.createdAt === "desc") found.sort((a, b) => b.createdAt - a.createdAt);
            return copy(found[0]);
        },
        count: async ({ where }) => { await tick(); return addresses.filter((row) => matches(row, where)).length; },
        create: async ({ data }) => {
            await tick();
            // Mirrors the filtered unique index on (user_id) WHERE is_default = 1.
            if (data.isDefault && addresses.some((row) => row.userId === data.userId && row.isDefault)) throw new Error("two defaults");
            addresses.push({ ...data });
            return copy(data);
        },
        updateMany: async ({ where, data }) => {
            await tick();
            const rows = addresses.filter((row) => matches(row, where));
            for (const row of rows) {
                if (data.isDefault && addresses.some((other) => other !== row && other.userId === row.userId && other.isDefault)) throw new Error("two defaults");
                Object.assign(row, data);
            }
            return { count: rows.length };
        },
        deleteMany: async ({ where }) => {
            await tick();
            const doomed = addresses.filter((row) => matches(row, where));
            addresses = addresses.filter((row) => !doomed.includes(row));
            return { count: doomed.length };
        }
    },
    // Serialised like the per-user row lock, so racing requests queue up.
    $transaction: async (fn) => {
        const previous = fakePrisma.lock;
        let release;
        fakePrisma.lock = new Promise((resolve) => { release = resolve; });
        await previous;
        try { return await fn(fakePrisma); } finally { release(); }
    },
    lock: Promise.resolve()
};

const db = require("../src/db/prisma");
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

let server;
let baseUrl;

const makeUser = (id, overrides = {}) => ({
    id, email: `${id}@example.test`, username: id, fullName: null, passwordHash: null,
    role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false, ...overrides
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
const anonymousHeaders = { Cookie: "__Host-csrf_token=csrf-1", Origin: process.env.APP_ORIGIN, "Content-Type": "application/json", "X-CSRF-Token": "csrf-1" };

const call = (userId, method, path, body, role) => fetch(`${baseUrl}${path}`, {
    method, headers: headersFor(userId, role), ...(body ? { body: JSON.stringify(body) } : {})
});
const sample = (n = 1, overrides = {}) => ({
    recipientName: `Nguyễn Văn ${n}`, phone: "0901234567", addressLine: `${n} Lê Lợi, Quận 1, TP.HCM`, ...overrides
});
const createAddress = async (userId, body) => {
    const response = await call(userId, "POST", "/api/addresses", body);
    assert.equal(response.status, 201);
    return (await response.json()).data.address;
};
const listFor = async (userId) => (await (await call(userId, "GET", "/api/addresses")).json()).data.addresses;
const defaultsOf = (userId) => addresses.filter((row) => row.userId === userId && row.isDefault);

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
    users = [makeUser("alice"), makeUser("bob"), makeUser("root", { role: "admin" })];
    addresses = [];
    clock = 0;
});

test("a customer can create, list, edit and delete saved addresses", async () => {
    assert.deepEqual(await listFor("alice"), []);
    const created = await createAddress("alice", sample(1));
    assert.equal(created.recipientName, "Nguyễn Văn 1");
    assert.equal(created.userId, undefined);

    const edited = await call("alice", "PUT", `/api/addresses/${created.id}`, sample(1, { phone: "+84912345678", addressLine: "99 Hai Bà Trưng, Hà Nội" }));
    assert.equal(edited.status, 200);
    const [only] = await listFor("alice");
    assert.equal(only.phone, "+84912345678");
    assert.equal(only.addressLine, "99 Hai Bà Trưng, Hà Nội");

    assert.equal((await call("alice", "DELETE", `/api/addresses/${created.id}`)).status, 204);
    assert.deepEqual(await listFor("alice"), []);
});

test("addresses of another customer are invisible: read, edit, delete and set-default return 404", async () => {
    const mine = await createAddress("alice", sample(1));
    assert.deepEqual(await listFor("bob"), []);
    assert.equal((await call("bob", "PUT", `/api/addresses/${mine.id}`, sample(2))).status, 404);
    assert.equal((await call("bob", "DELETE", `/api/addresses/${mine.id}`)).status, 404);
    assert.equal((await call("bob", "POST", `/api/addresses/${mine.id}/default`)).status, 404);
    const [untouched] = await listFor("alice");
    assert.equal(untouched.recipientName, "Nguyễn Văn 1");
});

test("the first address becomes the default and a later one does not", async () => {
    const first = await createAddress("alice", sample(1));
    const second = await createAddress("alice", sample(2));
    assert.equal(first.isDefault, true);
    assert.equal(second.isDefault, false);
    assert.deepEqual((await listFor("alice")).map((a) => a.id), [first.id, second.id]);
});

test("setting a default moves it and keeps exactly one; creating with isDefault does the same", async () => {
    const first = await createAddress("alice", sample(1));
    const second = await createAddress("alice", sample(2));
    assert.equal((await call("alice", "POST", `/api/addresses/${second.id}/default`)).status, 200);
    assert.deepEqual(defaultsOf("alice").map((a) => a.id), [second.id]);
    const third = await createAddress("alice", { ...sample(3), isDefault: true });
    assert.equal(third.isDefault, true);
    assert.deepEqual(defaultsOf("alice").map((a) => a.id), [third.id]);
    assert.equal(addresses.find((a) => a.id === first.id).isDefault, false);
    // Editing cannot strip the only default.
    await call("alice", "PUT", `/api/addresses/${third.id}`, { ...sample(3), isDefault: false });
    assert.deepEqual(defaultsOf("alice").map((a) => a.id), [third.id]);
});

test("deleting the default promotes the most recent remaining address; deleting others keeps it", async () => {
    const a = await createAddress("alice", sample(1));
    const b = await createAddress("alice", sample(2));
    const c = await createAddress("alice", sample(3));
    await call("alice", "DELETE", `/api/addresses/${b.id}`);
    assert.deepEqual(defaultsOf("alice").map((x) => x.id), [a.id]);
    await call("alice", "DELETE", `/api/addresses/${a.id}`);
    assert.deepEqual(defaultsOf("alice").map((x) => x.id), [c.id]);
    await call("alice", "DELETE", `/api/addresses/${c.id}`);
    assert.deepEqual(defaultsOf("alice"), []);
});

test("racing creations still leave exactly one default", async () => {
    await Promise.all([1, 2, 3, 4].map((n) => call("alice", "POST", "/api/addresses", sample(n))));
    assert.equal(addresses.length, 4);
    assert.equal(defaultsOf("alice").length, 1);
});

test("at most 10 addresses per customer; other customers are unaffected", async () => {
    for (let n = 1; n <= 10; n++) await createAddress("alice", sample(n));
    const over = await call("alice", "POST", "/api/addresses", sample(11));
    assert.equal(over.status, 409);
    assert.equal((await over.json()).error.code, "ADDRESS_LIMIT_REACHED");
    assert.equal((await listFor("alice")).length, 10);
    await createAddress("bob", sample(1));
    // Freeing a slot allows another.
    const [first] = await listFor("alice");
    await call("alice", "DELETE", `/api/addresses/${first.id}`);
    await createAddress("alice", sample(12));
});

test("validation: name, phone and address lengths, Vietnamese phone format", async () => {
    const bad = [
        sample(1, { recipientName: "A" }), sample(1, { recipientName: "x".repeat(201) }), sample(1, { recipientName: "   " }),
        sample(1, { phone: "12345" }), sample(1, { phone: "0901 234 567" }), sample(1, { phone: "+1234567890" }), sample(1, { phone: "090123456789" }),
        sample(1, { addressLine: "abcd" }), sample(1, { addressLine: "x".repeat(501) }), sample(1, { addressLine: 42 }), {}
    ];
    for (const body of bad) {
        const response = await call("alice", "POST", "/api/addresses", body);
        assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
        assert.equal((await response.json()).error.code, "VALIDATION_FAILED");
    }
    for (const phone of ["0901234567", "+84901234567", "012345678"]) {
        assert.equal((await call("alice", "POST", "/api/addresses", sample(1, { phone }))).status, 201, phone);
    }
    const edit = await call("alice", "PUT", `/api/addresses/${addresses[0].id}`, sample(1, { phone: "nope" }));
    assert.equal(edit.status, 400);
    assert.equal(addresses[0].phone, "0901234567");
});

test("anonymous callers, administrators and missing CSRF are refused", async () => {
    const anonymous = await fetch(`${baseUrl}/api/addresses`, { headers: anonymousHeaders });
    assert.equal(anonymous.status, 401);
    assert.equal((await call("root", "GET", "/api/addresses", undefined, "admin")).status, 403);
    const noCsrf = await fetch(`${baseUrl}/api/addresses`, {
        method: "POST", headers: { ...headersFor("alice"), "X-CSRF-Token": "wrong" }, body: JSON.stringify(sample(1))
    });
    assert.equal(noCsrf.status, 403);
    assert.equal(addresses.length, 0);
});

test("a customer can read and update their full name", async () => {
    const before = await (await call("alice", "GET", "/api/profile")).json();
    assert.equal(before.data.profile.fullName, "");
    const updated = await call("alice", "PUT", "/api/profile", { fullName: "  Trần   Thị Bình " });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).data.profile.fullName, "Trần Thị Bình");
    assert.equal(users[0].fullName, "Trần Thị Bình");
    assert.equal((await call("alice", "PUT", "/api/profile", { fullName: "B" })).status, 400);
    assert.equal(users[0].fullName, "Trần Thị Bình");
    assert.equal((await call("root", "GET", "/api/profile", undefined, "admin")).status, 403);
});

const registerBody = (overrides = {}) => ({
    email: "new@example.test",
    fullName: "Lê Văn Cường", address: "12 Nguyễn Huệ, Quận 1, TP.HCM", ...overrides
});
const register = (body) => fetch(`${baseUrl}/api/auth/register`, { method: "POST", headers: anonymousHeaders, body: JSON.stringify(body) });
const eventually = async (predicate) => {
    for (let attempt = 0; attempt < 50 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
};

test("registration stores the full name and the shipping address as the first default address", async () => {
    const response = await register(registerBody());
    assert.equal(response.status, 201);
    await eventually(() => addresses.length > 0);
    const row = users.find((user) => user.email === "new@example.test");
    assert.equal(row.fullName, "Lê Văn Cường");
    assert.equal(addresses.length, 1);
    assert.deepEqual(
        { userId: addresses[0].userId, recipientName: addresses[0].recipientName, phone: addresses[0].phone, addressLine: addresses[0].addressLine, isDefault: addresses[0].isDefault },
        { userId: row.id, recipientName: "Lê Văn Cường", phone: "", addressLine: "12 Nguyễn Huệ, Quận 1, TP.HCM", isDefault: true }
    );
});

test("registration requires a valid email, full name and address", async () => {
    const cases = [
        [{ email: "not-an-email" }, "email"],
        [{ fullName: undefined }, "fullName"], [{ fullName: "A" }, "fullName"],
        [{ address: undefined }, "address"], [{ address: "abc" }, "address"]
    ];
    for (const [override, field] of cases) {
        const response = await register(registerBody(override));
        assert.equal(response.status, 400, JSON.stringify(override));
        const payload = await response.json();
        assert.equal(payload.error.code, "VALIDATION_FAILED");
        assert.equal(payload.error.fields[field], true);
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(users.some((user) => user.email === "new@example.test"), false);
    assert.equal(addresses.length, 0);
});
