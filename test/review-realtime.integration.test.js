const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { after, afterEach, before, beforeEach, mock, test } = require("node:test");

process.env.APP_ORIGIN = "https://realtime.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.ADMIN_EXTRAS = "1"; // review moderation is an optional admin extra, off by default
process.env.TRUST_PROXY = "1"; // lets each call pick its address, so the guest comment limit does not interfere

const { createReviewFake } = require("../test-support/review-fake");
const fake = createReviewFake();
const { state } = fake;

const db = require("../src/db/prisma");
db.getPrismaClient = () => fake.prisma;
const app = require("../src/app");
const reviewHub = require("../src/realtime/review-hub");

// ===== Harness =====
let server;
let httpBase;
let wsBase;
let clientsToClose = [];
const CSRF = "realtime-csrf";
const ORIGIN = process.env.APP_ORIGIN;
const ALICE = { id: "alice", role: "user" };
const ADMIN = { id: "admin-1", role: "admin" };

const tokenFor = ({ id, role }) => jwt.sign({ type: "access", ver: 1, role }, process.env.JWT_ACCESS_SECRET, { subject: id, expiresIn: "10m" });

let nextIp = 1;
const call = (method, path, { as, body } = {}) => {
    const headers = {
        Origin: ORIGIN,
        "X-CSRF-Token": CSRF,
        "X-Forwarded-For": `10.1.0.${nextIp++ % 250}`,
        Cookie: [`__Host-csrf_token=${CSRF}`, ...(as ? [`__Host-access_token=${tokenFor(as)}`] : [])].join("; ")
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${httpBase}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};

/** A real ws client that queues every message it receives. */
const watch = (productId, { origin = ORIGIN, path = "/ws/reviews" } = {}) => new Promise((resolve, reject) => {
    const headers = origin === null ? {} : { Origin: origin };
    const socket = new WebSocket(`${wsBase}${path}?productId=${productId}`, { headers });
    const events = [];
    const waiters = [];
    socket.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(event); else events.push(event);
    });
    socket.once("open", () => {
        clientsToClose.push(socket);
        resolve({
            socket,
            events,
            next: (timeoutMs = 2000) => events.length
                ? Promise.resolve(events.shift())
                : new Promise((ok, fail) => {
                    const waiter = { resolve: ok };
                    waiters.push(waiter);
                    realSetTimeout(() => fail(new Error("no websocket event arrived")), timeoutMs).unref();
                })
        });
    });
    socket.once("unexpected-response", (_req, response) => { response.resume(); reject(Object.assign(new Error("rejected"), { status: response.statusCode })); });
    socket.once("error", (error) => reject(error));
});

const rejectedStatus = (promise) => promise.then(
    () => assert.fail("connection should have been rejected"),
    (error) => error.status
);

// Captured before any test mocks timers, so the hooks below keep working in tests that fake the clock.
const realSetTimeout = globalThis.setTimeout;
const quiet = (ms = 150) => new Promise((resolve) => realSetTimeout(resolve, ms));

const seedReview = (productId, userId, fields = {}) => {
    const row = { id: state.nextReviewId++, productId, userId, rating: 5, comment: null, isHidden: false, guestName: null, createdAt: ++state.clock, updatedAt: state.clock, ...fields };
    state.reviews.push(row);
    return row;
};

before(async () => {
    server = http.createServer(app);
    reviewHub.attach(server);
    server.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    httpBase = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
});

after(async () => {
    await reviewHub.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
    state.users = [
        { id: "alice", email: "a@x.test", username: "alice_k", role: "user", status: "ACTIVE", authVersion: 1, forcePasswordChange: false },
        { id: "admin-1", email: "ad@x.test", username: "root", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false }
    ];
    state.products = [
        { id: 1, name: "Mouse One", isDeleted: false },
        { id: 2, name: "Laptop Two", isDeleted: false }
    ];
    state.variants = [{ id: 11, productId: 1 }, { id: 21, productId: 2 }];
    state.orders = [{ id: "order-1", userId: "alice", orderStatus: "DELIVERED" }];
    state.orderItems = [{ id: 1, orderId: "order-1", variantId: 11 }];
    state.reviews = [];
    state.audits = [];
    state.nextReviewId = 1;
    state.clock = 1000;
});

afterEach(async () => {
    for (const socket of clientsToClose) socket.terminate();
    clientsToClose = [];
    await quiet(20);
});

// ===== Events =====

test("a new guest comment reaches everyone watching that product, with the new aggregate", async () => {
    const first = await watch(1);
    const second = await watch(1);
    seedReview(1, "alice", { rating: 4 });

    const response = await call("POST", "/api/products/1/reviews", { body: { guestName: "Minh Anh", comment: "Giao nhanh" } });
    assert.equal(response.status, 201);
    const created = (await response.json()).data;

    for (const watcher of [first, second]) {
        const event = await watcher.next();
        assert.equal(event.type, "review.created");
        assert.deepEqual(event.review, {
            id: created.id, authorType: "guest", username: "Minh Anh", rating: null, comment: "Giao nhanh",
            createdAt: created.createdAt, updatedAt: created.updatedAt
        });
        assert.deepEqual(event.aggregate, {
            ratingAverage: 4, ratingCount: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 }, commentCount: 1
        });
    }
});

test("a signed-in review emits created, updated and deleted events with the matching aggregate", async () => {
    const watcher = await watch(1);

    const created = await call("POST", "/api/products/1/reviews", { as: ALICE, body: { rating: 5, comment: "Tuyệt" } });
    assert.equal(created.status, 201);
    const createdEvent = await watcher.next();
    assert.equal(createdEvent.type, "review.created");
    assert.equal(createdEvent.review.authorType, "user");
    assert.equal(createdEvent.review.username, "alice_k");
    assert.equal(createdEvent.review.rating, 5);
    assert.equal(createdEvent.aggregate.ratingAverage, 5);

    const edited = await call("PUT", "/api/products/1/reviews/mine", { as: ALICE, body: { rating: 3, comment: "Tạm" } });
    assert.equal(edited.status, 200);
    const updatedEvent = await watcher.next();
    assert.equal(updatedEvent.type, "review.updated");
    assert.equal(updatedEvent.review.id, createdEvent.review.id);
    assert.equal(updatedEvent.review.rating, 3);
    assert.equal(updatedEvent.aggregate.ratingAverage, 3);

    const removed = await call("DELETE", "/api/products/1/reviews/mine", { as: ALICE });
    assert.equal(removed.status, 200);
    const deletedEvent = await watcher.next();
    assert.equal(deletedEvent.type, "review.deleted");
    assert.equal(deletedEvent.review.id, createdEvent.review.id);
    assert.equal(deletedEvent.aggregate.ratingCount, 0);
    assert.equal(deletedEvent.aggregate.ratingAverage, null);
});

test("hiding a review emits review.hidden and unhiding it makes it visible again", async () => {
    seedReview(1, "alice", { rating: 2, comment: "Chưa tốt" });
    const watcher = await watch(1);

    const hide = await call("PATCH", "/api/admin/reviews/1", { as: ADMIN, body: { isHidden: true } });
    assert.equal(hide.status, 200);
    const hidden = await watcher.next();
    assert.equal(hidden.type, "review.hidden");
    assert.equal(hidden.review.id, 1);
    assert.equal(hidden.aggregate.ratingCount, 0);

    const unhide = await call("PATCH", "/api/admin/reviews/1", { as: ADMIN, body: { isHidden: false } });
    assert.equal(unhide.status, 200);
    const shown = await watcher.next();
    assert.equal(shown.type, "review.updated");
    assert.equal(shown.review.username, "alice_k");
    assert.equal(shown.aggregate.ratingCount, 1);
});

test("hiding a guest comment broadcasts the guest name, never any account data", async () => {
    seedReview(1, null, { rating: null, comment: "Spam", guestName: "Kẻ Lạ" });
    const watcher = await watch(1);
    await call("PATCH", "/api/admin/reviews/1", { as: ADMIN, body: { isHidden: true } });
    const event = await watcher.next();
    assert.equal(event.type, "review.hidden");
    assert.equal(event.review.authorType, "guest");
    assert.equal(event.review.username, "Kẻ Lạ");
    assert.deepEqual(Object.keys(event.review).sort(), ["authorType", "comment", "createdAt", "id", "rating", "updatedAt", "username"]);
    assert.deepEqual(Object.keys(event).sort(), ["aggregate", "review", "type"]);
});

test("watchers of another product receive nothing", async () => {
    const other = await watch(2);
    const same = await watch(1);
    await call("POST", "/api/products/1/reviews", { body: { guestName: "Lan", comment: "Chỉ sản phẩm 1" } });
    assert.equal((await same.next()).review.comment, "Chỉ sản phẩm 1");
    await quiet();
    assert.equal(other.events.length, 0);
});

test("a rejected comment and a hidden review's edit do not broadcast", async () => {
    seedReview(1, "alice", { rating: 1, isHidden: true });
    const watcher = await watch(1);
    await call("POST", "/api/products/1/reviews", { body: { guestName: "x", comment: "short name" } }); // 400
    await call("POST", "/api/products/1/reviews", { body: { guestName: "Lan", rating: 5, comment: "x" } }); // 401
    await call("PUT", "/api/products/1/reviews/mine", { as: ALICE, body: { rating: 2 } }); // hidden review
    await quiet();
    assert.equal(watcher.events.length, 0);
});

test("a watcher that disconnects is dropped and later events still reach the rest", async () => {
    const leaving = await watch(1);
    const staying = await watch(1);
    leaving.socket.close();
    await quiet();
    assert.equal(reviewHub.stats().connections, 1);
    await call("POST", "/api/products/1/reviews", { body: { guestName: "Lan", comment: "Vẫn nhận" } });
    assert.equal((await staying.next()).review.comment, "Vẫn nhận");
});

// ===== Connection rules =====

test("connections from an unknown or missing origin are refused", async () => {
    assert.equal(await rejectedStatus(watch(1, { origin: "https://evil.example.test" })), 403);
    assert.equal(await rejectedStatus(watch(1, { origin: null })), 403);
    assert.equal(await rejectedStatus(watch(1, { origin: "https://realtime.example.test.evil.test" })), 403);
    assert.equal(reviewHub.stats().connections, 0);
});

test("bad paths and bad product ids are refused", async () => {
    assert.equal(await rejectedStatus(watch(1, { path: "/ws/other" })), 404);
    for (const productId of ["", "abc", "0", "-1", "1.5", "99999999999", "1 OR 1=1"]) {
        assert.equal(await rejectedStatus(watch(productId)), 400, `productId=${productId}`);
    }
});

test("a client that sends an oversized frame is disconnected", async () => {
    const watcher = await watch(1);
    const closed = new Promise((resolve) => watcher.socket.once("close", (code) => resolve(code)));
    watcher.socket.send("x".repeat(4096));
    assert.equal(await closed, 1009);
});

test("a chatty client is disconnected for breaking the policy", async () => {
    const watcher = await watch(1);
    const closed = new Promise((resolve) => watcher.socket.once("close", (code) => resolve(code)));
    for (let n = 0; n < 15; n++) watcher.socket.send("hi");
    assert.equal(await closed, 1008);
});

test("one address cannot hold more than 20 connections", async () => {
    const sockets = [];
    for (let n = 0; n < 20; n++) sockets.push(await watch(1));
    assert.equal(await rejectedStatus(watch(1)), 429);
    for (const { socket } of sockets) socket.close();
});

// ===== Server lifecycle =====

test("the real server accepts websockets and shuts down even while one is open", async () => {
    await reviewHub.close(); // the harness server is done; free the singleton hub for startServer
    const { startServer } = require("../src/server-lifecycle");
    const silent = { log() {}, error() {} };
    const processRef = { on() {}, removeListener() {}, exitCode: 0 };
    const running = await startServer({ app, port: 0, connect: async () => {}, disconnect: async () => {}, logger: silent, processRef });
    const { port } = running.server.address();

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/reviews?productId=1`, { headers: { Origin: ORIGIN } });
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const closed = new Promise((resolve) => socket.once("close", resolve));

    await running.shutdown("SIGTERM"); // would hang on server.close() if the open socket were not dropped
    await closed;
    assert.equal(processRef.exitCode, 0);
});

// ===== Browser client (public/js/review-live.js, run in a vm with a fake WebSocket) =====

const loadReviewLive = () => {
    const sockets = [];
    class FakeWebSocket {
        constructor(url) { this.url = url; this.listeners = {}; sockets.push(this); }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        emit(type, event = {}) { for (const listener of this.listeners[type] || []) listener(event); }
        close() { this.emit("close"); }
    }
    const window = {};
    const context = vm.createContext({
        window, Math, encodeURIComponent, JSON, Number, Set,
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        location: { protocol: "https:", host: "shop.test" },
        WebSocket: FakeWebSocket,
        setTimeout, clearTimeout, setInterval, clearInterval
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/js/review-live.js"), "utf8"), context);
    return { ReviewLive: window.ReviewLive, sockets };
};

test("the browser client ignores malformed events and accepts only the four review types", () => {
    const { ReviewLive } = loadReviewLive();
    const good = JSON.stringify({ type: "review.created", review: { id: 3 }, aggregate: {} });
    assert.equal(ReviewLive.parseEvent(good).review.id, 3);
    for (const raw of [
        "not json", "null", "[]", JSON.stringify({ type: "review.created" }), JSON.stringify({ type: "chat.message", review: { id: 1 } }),
        JSON.stringify({ type: "review.created", review: { id: "1" } }), JSON.stringify({ type: "review.created", review: { id: 1 }, pad: "x".repeat(20000) }), 42, undefined
    ]) {
        assert.equal(ReviewLive.parseEvent(raw), null, String(raw).slice(0, 40));
    }
});

test("the browser client polls every 30 s while the socket is down and resyncs after reconnecting", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { ReviewLive, sockets } = loadReviewLive();
    const log = { events: [], resyncs: 0, statuses: [] };
    const live = ReviewLive.connect({
        productId: 7,
        onEvent: (event) => log.events.push(event.type),
        onResync: () => { log.resyncs += 1; },
        onStatus: (status) => log.statuses.push(status)
    });
    assert.equal(sockets[0].url, "wss://shop.test/ws/reviews?productId=7");

    sockets[0].emit("open");
    sockets[0].emit("message", { data: JSON.stringify({ type: "review.deleted", review: { id: 1 }, aggregate: {} }) });
    sockets[0].emit("message", { data: "garbage" });
    assert.deepEqual(log.events, ["review.deleted"]);
    assert.equal(log.resyncs, 0, "the first connection needs no resync");

    sockets[0].emit("close");
    assert.deepEqual(log.statuses, ["live", "poll"]);
    t.mock.timers.tick(30000);
    assert.equal(log.resyncs, 1, "poll after 30 s without a socket");

    t.mock.timers.tick(1000); // first backoff step is at most 1 s
    assert.equal(sockets.length, 2, "reconnect attempted");
    sockets[1].emit("close"); // still failing: next step waits longer
    t.mock.timers.tick(999);
    assert.equal(sockets.length, 2, "backoff grows (attempt 2 waits at least 1 s)");
    t.mock.timers.tick(2000);
    assert.equal(sockets.length, 3);

    const before = log.resyncs;
    sockets[2].emit("open");
    assert.equal(log.resyncs, before + 1, "one reload after reconnecting");
    assert.equal(log.statuses.at(-1), "live");
    t.mock.timers.tick(60000);
    assert.equal(log.resyncs, before + 1, "polling stops once the socket is back");
    live.close();
});
