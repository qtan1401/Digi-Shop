const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const argon2 = require("argon2");
const { after, before, beforeEach, test } = require("node:test");

// Password reset and registration through the real app, routes, services and repositories over an in-memory Prisma fake.
process.env.APP_ORIGIN = "https://reset.example.test";
process.env.TRUST_PROXY = "1"; // each request gets its own client IP unless a test pins one
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.SMTP_HOST = "smtp.example.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "mailer";
process.env.SMTP_PASSWORD = "mailer-password";
process.env.MAIL_FROM = "Digi-Shop <shop@example.test>";

// Only the SMTP transport under nodemailer is faked, so no real mail can leave this test.
const nodemailer = require("nodemailer");
let sentMail;
let failMail;
nodemailer.createTransport = () => ({
    sendMail: async (message) => {
        if (failMail) throw new Error(`SMTP down for ${message.to}`);
        sentMail.push(message);
    }
});

let state;
let transactionTail = Promise.resolve();
const clone = (value) => structuredClone(value);
const time = (value) => new Date(value).getTime();
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sameText = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const uniqueError = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

const fakePrisma = {
    user: {
        findUnique: async ({ where }) => { await tick(); return clone(state.users.find((row) => row.id === where.id) || null); },
        findFirst: async ({ where }) => {
            await tick();
            const found = state.users.find((row) => where.OR
                ? where.OR.some((clause) => (clause.email !== undefined && sameText(row.email, clause.email)) || (clause.username !== undefined && sameText(row.username, clause.username)))
                : sameText(row.email, where.email));
            return clone(found || null);
        },
        create: async ({ data }) => {
            await tick();
            if (state.users.some((row) => sameText(row.email, data.email))) throw uniqueError();
            const { addresses, ...fields } = clone(data);
            const row = { username: null, passwordHash: null, emailVerifiedAt: null, passwordLockedAt: null, loyaltyPoints: 0, ...fields };
            state.users.push(row);
            for (const address of addresses?.create || []) state.addresses.push({ ...address, userId: row.id });
            return clone(row);
        },
        update: async ({ where, data }) => {
            await tick();
            Object.assign(state.users.find((row) => row.id === where.id), clone(data));
            return clone(state.users.find((row) => row.id === where.id));
        },
        updateMany: async ({ where, data }) => {
            await tick();
            const row = state.users.find((entry) => entry.id === where.id);
            if (!row || row.authVersion !== where.authVersion) return { count: 0 };
            const { authVersion, ...rest } = clone(data);
            Object.assign(row, rest, { authVersion: row.authVersion + authVersion.increment });
            return { count: 1 };
        }
    },
    refreshSession: {
        create: async ({ data }) => { state.sessions.push(clone(data)); return clone(data); },
        updateMany: async ({ where, data }) => {
            await tick();
            const rows = state.sessions.filter((row) => row.userId === where.userId && row.revokedAt == null);
            for (const row of rows) Object.assign(row, clone(data));
            return { count: rows.length };
        }
    },
    passwordResetToken: {
        create: async ({ data }) => {
            await tick();
            if (state.resetTokens.some((row) => row.tokenHash === data.tokenHash)) throw uniqueError();
            state.resetTokens.push({ usedAt: null, createdAt: new Date(), ...clone(data) });
            return clone(data);
        },
        findUnique: async ({ where }) => { await tick(); return clone(state.resetTokens.find((row) => row.tokenHash === where.tokenHash) || null); },
        updateMany: async ({ where, data }) => {
            await tick();
            const rows = state.resetTokens.filter((row) =>
                (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
                (where.userId === undefined || row.userId === where.userId) &&
                row.usedAt == null && (!where.expiresAt?.gt || time(row.expiresAt) > time(where.expiresAt.gt)));
            for (const row of rows) Object.assign(row, clone(data));
            return { count: rows.length };
        }
    },
    emailVerificationToken: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }) => { state.verificationTokens.push(clone(data)); return clone(data); }
    },
    $executeRaw: async () => {
        for (const row of state.users) row.failedPasswordAttempts += 1;
        return 1;
    },
    $transaction: async (work) => {
        const previous = transactionTail;
        let release;
        transactionTail = new Promise((resolve) => { release = resolve; });
        await previous;
        const snapshot = clone(state);
        try {
            return await work(fakePrisma);
        } catch (error) {
            state = snapshot;
            throw error;
        } finally {
            release();
        }
    }
};

const db = require("../src/db/prisma");
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

const CSRF = "csrf-token-for-reset-tests";
let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.7.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; };
const send = (method, path, body, { csrf = true, ip = nextIp() } = {}) => {
    const headers = { "Content-Type": "application/json", "X-Forwarded-For": ip, Origin: process.env.APP_ORIGIN };
    if (csrf) { headers.Cookie = `__Host-csrf_token=${CSRF}`; headers["x-csrf-token"] = CSRF; }
    return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};
const recover = (email, options) => send("POST", "/api/auth/recover", { email }, options);
const reset = (token, newPassword, options) => send("POST", "/api/auth/reset-password", { token, newPassword }, options);
const login = (identifier, password) => send("POST", "/api/auth/login", { identifier, password });

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};
// Lets background work that must NOT produce mail finish before asserting that none was sent.
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const tokenFrom = (message) => new URL(message.text.match(/https:\/\/\S+/)[0]).searchParams.get("token");
const mailsTo = (address) => sentMail.filter((message) => message.to === address);
const userByEmail = (email) => state.users.find((row) => row.email === email);

let passwordHash;
const makeUser = (id, overrides = {}) => ({
    id, email: `${id}@example.test`, username: null, passwordHash, role: "user", status: "ACTIVE", authVersion: 1,
    forcePasswordChange: false, failedPasswordAttempts: 0, passwordLockedAt: null, emailVerifiedAt: null, ...overrides
});
// The per-email rate limit lives for the whole process, so each test gets its own owner address.
let OWNER;
let ownerCounter = 0;
const makeState = () => ({
    users: [
        makeUser("owner", { email: OWNER }),
        makeUser("guest", { email: "guest@example.test", status: "UNVERIFIED", passwordHash: null }),
        makeUser("legacy", { email: "legacy@example.test", status: "UNVERIFIED" }),
        makeUser("boss", { email: "boss@example.test", role: "admin" })
    ],
    sessions: [{ id: "s1", userId: "owner", revokedAt: null }, { id: "s2", userId: "owner", revokedAt: null }],
    resetTokens: [], verificationTokens: [], addresses: []
});

// Requests a link for `email` and returns the raw token mailed to it.
const requestLink = async (email) => {
    const before = mailsTo(email).length;
    assert.equal((await recover(email)).status, 202);
    await waitFor(() => mailsTo(email).length > before);
    return tokenFrom(mailsTo(email).at(-1));
};

let server;
let baseUrl;
before(async () => {
    passwordHash = await argon2.hash("old-password", { type: argon2.argon2id });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
    ownerCounter += 1;
    OWNER = `owner${ownerCounter}@example.test`;
    state = makeState();
    transactionTail = Promise.resolve();
    sentMail = [];
    failMail = false;
});

test("recover answers identically for known, unknown, malformed and ineligible emails; only the eligible one gets mail", async () => {
    const answers = [];
    for (const email of [OWNER, "nobody@example.test", "not-an-email", "legacy@example.test", "boss@example.test"]) {
        const response = await recover(email);
        answers.push([response.status, await response.json()]);
    }
    for (const answer of answers) assert.deepEqual(answer, answers[0]);
    assert.equal(answers[0][0], 202);
    await waitFor(() => sentMail.length > 0);
    await settle();
    assert.deepEqual(sentMail.map((message) => message.to), [OWNER]);
    assert.match(sentMail[0].text, /\/reset-password\.html\?token=/);
    assert.doesNotMatch(sentMail[0].subject + sentMail[0].text, /tạm thời|temporary/i);
});

test("recover leaves the password, lock, sessions and auth version untouched, and stores only the token hash", async () => {
    Object.assign(state.users[0], { failedPasswordAttempts: 5, passwordLockedAt: new Date() });
    const before = clone(state.users[0]);
    const token = await requestLink(OWNER);
    assert.deepEqual(state.users[0], before);
    assert.equal(state.sessions.every((row) => row.revokedAt == null), true);
    assert.equal(state.resetTokens.length, 1);
    assert.equal(state.resetTokens[0].tokenHash, sha256(token));
    assert.equal(state.resetTokens[0].tokenHash.length, 64);
    assert.equal(JSON.stringify(state.resetTokens).includes(token), false);
    const lifetime = time(state.resetTokens[0].expiresAt) - Date.now();
    assert.ok(lifetime > 29 * 60_000 && lifetime <= 30 * 60_000, "30 minute lifetime");
    assert.equal((await login(OWNER, "old-password")).status, 423, "still locked: recover does not unlock");
});

test("a valid token sets the password, unlocks, revokes every session and signs nobody in", async () => {
    Object.assign(state.users[0], { failedPasswordAttempts: 5, passwordLockedAt: new Date(), forcePasswordChange: true });
    const token = await requestLink(OWNER);
    const response = await reset(token, "brand-new-password");
    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie().some((cookie) => /access_token|refresh/.test(cookie)), false, "no auto-login");
    const owner = state.users[0];
    assert.equal(owner.failedPasswordAttempts, 0);
    assert.equal(owner.passwordLockedAt, null);
    assert.equal(owner.forcePasswordChange, false);
    assert.equal(owner.authVersion, 2);
    assert.equal(state.sessions.every((row) => row.revokedAt != null), true);
    assert.equal(state.resetTokens.every((row) => row.usedAt != null), true);
    assert.equal((await login(OWNER, "old-password")).status, 401);
    assert.equal((await login(OWNER, "brand-new-password")).status, 200);
});

test("unknown, malformed, expired and reused tokens all get the identical error", async () => {
    const expired = await requestLink(OWNER);
    state.resetTokens[0].expiresAt = new Date(Date.now() - 1000);
    const used = await requestLink(OWNER);
    assert.equal((await reset(used, "brand-new-password")).status, 200);
    const answers = [];
    for (const token of [expired, used, "x".repeat(43), "short", undefined, 42]) {
        const response = await reset(token, "another-password");
        answers.push([response.status, await response.json()]);
    }
    for (const answer of answers) assert.deepEqual(answer, answers[0]);
    assert.equal(answers[0][0], 400);
    assert.equal(answers[0][1].error.code, "RESET_TOKEN_INVALID");
    assert.equal(state.users[0].authVersion, 2, "only the first reset changed the account");
});

test("a rejected password does not consume the token", async () => {
    const token = await requestLink(OWNER);
    const weak = await reset(token, "123");
    assert.equal(weak.status, 400);
    assert.equal((await weak.json()).error.code, "VALIDATION_FAILED");
    assert.equal(state.resetTokens[0].usedAt, null);
    assert.equal((await reset(token, "long-enough-password")).status, 200);
});

test("a newer request voids the older token", async () => {
    const first = await requestLink(OWNER);
    const second = await requestLink(OWNER);
    assert.notEqual(first, second);
    const stale = await reset(first, "brand-new-password");
    assert.equal(stale.status, 400);
    assert.equal((await reset(second, "brand-new-password")).status, 200);
});

test("two simultaneous uses of one token succeed exactly once", async () => {
    const token = await requestLink(OWNER);
    const [a, b] = await Promise.all([reset(token, "first-password-1"), reset(token, "second-password-2")]);
    assert.deepEqual([a.status, b.status].sort(), [200, 400]);
    assert.equal(state.users[0].authVersion, 2);
});

test("using a link voids the account's other unused links", async () => {
    const token = await requestLink(OWNER);
    state.resetTokens.push({ id: "extra", userId: "owner", tokenHash: sha256("another-unused-token-value"), expiresAt: new Date(Date.now() + 60_000), usedAt: null });
    assert.equal((await reset(token, "brand-new-password")).status, 200);
    assert.equal((await reset("another-unused-token-value", "other-password-1")).status, 400);
});

test("a passwordless guest account becomes ACTIVE by setting a password through the link", async () => {
    const token = await requestLink("guest@example.test");
    assert.equal(mailsTo("guest@example.test").length, 1);
    assert.equal((await reset(token, "guest-password-1")).status, 200);
    const guest = userByEmail("guest@example.test");
    assert.equal(guest.status, "ACTIVE");
    assert.ok(guest.emailVerifiedAt);
    assert.equal((await login("guest@example.test", "guest-password-1")).status, 200);
});

test("a mail failure still answers 202 and the log carries neither the address nor the token", async () => {
    failMail = true;
    const logged = [];
    const original = console.error;
    console.error = (...args) => { logged.push(args.map(String).join(" ")); };
    try {
        const response = await recover(OWNER);
        assert.equal(response.status, 202);
        await waitFor(() => logged.length > 0);
    } finally {
        console.error = original;
    }
    assert.equal(logged.length, 1);
    assert.equal(logged[0].includes(OWNER), false);
    assert.doesNotMatch(logged[0], /token=|[A-Za-z0-9_-]{30,}/);
});

test("the new routes require CSRF and reset is rate limited per IP", async () => {
    assert.equal((await recover(OWNER, { csrf: false })).status, 403);
    assert.equal((await reset("x".repeat(43), "brand-new-password", { csrf: false })).status, 403);
    assert.equal(sentMail.length, 0);
    const ip = "10.99.99.99";
    const statuses = [];
    for (let attempt = 0; attempt < 22; attempt += 1) statuses.push((await reset("x".repeat(43), "brand-new-password", { ip })).status);
    assert.equal(statuses.slice(0, 20).every((status) => status === 400), true);
    assert.equal(statuses[20], 429);
});

test("the verification email links to the real page and is in Vietnamese", async () => {
    const { NodemailerSmtpMailer } = require("../src/auth/mailer");
    await new NodemailerSmtpMailer().sendVerificationEmail({ to: "someone@example.test", token: "abc", expiresAt: new Date() });
    assert.match(sentMail[0].text, /https:\/\/reset\.example\.test\/verify-email\.html\?token=abc/);
    assert.match(sentMail[0].subject, /Xác minh/);
});

// ── Registration: email, full name and shipping address only ────────────────

const registration = { email: "New.Person@Example.test", fullName: "Nguyễn Văn A", address: "1 Lê Lợi, Quận 1, TP.HCM" };
const register = (body, options) => send("POST", "/api/auth/register", body, options);

test("registration needs only email, full name and address; it creates a passwordless account with a default address", async () => {
    const response = await register({ ...registration, password: "ignored-password", username: "ignored", phone: "0901234567" });
    assert.equal(response.status, 201);
    await waitFor(() => sentMail.length > 0);
    const account = userByEmail("new.person@example.test");
    assert.equal(account.status, "UNVERIFIED");
    assert.equal(account.passwordHash, null, "a posted password is ignored");
    assert.equal(account.username, null, "a posted username is ignored");
    assert.equal(account.fullName, "Nguyễn Văn A");
    assert.deepEqual(state.addresses.map(({ userId, recipientName, phone, addressLine, isDefault }) => ({ userId, recipientName, phone, addressLine, isDefault })),
        [{ userId: account.id, recipientName: "Nguyễn Văn A", phone: "", addressLine: registration.address, isDefault: true }]);
    assert.equal(sentMail.length, 1);
    assert.match(sentMail[0].text, /\/reset-password\.html\?token=/);
});

test("the registration link sets the password and activates the account", async () => {
    await register(registration);
    await waitFor(() => sentMail.length > 0);
    const token = tokenFrom(sentMail[0]);
    assert.equal((await login("new.person@example.test", "whatever-password")).status, 401);
    assert.equal((await reset(token, "my-first-password")).status, 200);
    assert.equal(userByEmail("new.person@example.test").status, "ACTIVE");
    assert.equal((await login("new.person@example.test", "my-first-password")).status, 200);
});

test("registration answers identically for a new email and every kind of existing one", async () => {
    const answers = [];
    for (const email of ["fresh@example.test", OWNER, "guest@example.test", "legacy@example.test", "boss@example.test"]) {
        const response = await register({ ...registration, email });
        answers.push([response.status, await response.json()]);
    }
    for (const answer of answers) assert.deepEqual(answer, answers[0]);
    await waitFor(() => sentMail.length >= 3);
    await settle();
    const recipients = sentMail.map((message) => message.to).sort();
    assert.deepEqual(recipients, ["fresh@example.test", "guest@example.test", "legacy@example.test"]);
    assert.match(mailsTo("legacy@example.test")[0].text, /verify-email\.html/, "a legacy unverified account keeps its verification link");
    assert.equal(userByEmail(OWNER).passwordHash, passwordHash, "an existing account is never changed");
    assert.equal(state.users.length, 5);
});

test("registration validates the three fields and is rate limited", async () => {
    for (const body of [{ ...registration, email: "nope" }, { ...registration, fullName: "A" }, { ...registration, address: "1" }, {}]) {
        const response = await register(body);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, "VALIDATION_FAILED");
    }
    assert.equal((await register(registration, { csrf: false })).status, 403);
    const ip = "10.88.88.88";
    const statuses = [];
    for (let attempt = 0; attempt < 22; attempt += 1) statuses.push((await register({ ...registration, email: `rl${attempt}@example.test` }, { ip })).status);
    assert.equal(statuses[19], 201);
    assert.equal(statuses[20], 429);
});
