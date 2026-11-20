const assert = require("node:assert/strict");
const http = require("node:http");
const WebSocket = require("ws");
const { after, beforeEach, test } = require("node:test");
const { resetDatabase } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database review events require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let first;
    let second;
    let hubs = [];
    let servers = [];
    beforeEach(async () => {
        first = await resetDatabase();
        const { PrismaClient } = require("@prisma/client");
        const { PrismaPg } = require("@prisma/adapter-pg");
        second = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) });
        await second.$connect();
        hubs = [];
        servers = [];
    });
    after(async () => {
        for (const hub of hubs) await hub.close();
        for (const server of servers) await new Promise((resolve) => server.close(resolve));
        if (second) await second.$disconnect();
        await require("../src/db/prisma").disconnectPrisma();
    });

    test("separate hubs deliver public events across clients without echo or idle polling", async () => {
        process.env.APP_ORIGIN = "https://review-events.example.test";
        const events = require("../src/realtime/review-events");
        const { createReviewHub } = require("../src/realtime/review-hub");
        const aEvents = events.createReviewEvents({ client: first, origin: "instance-a", mode: "database" });
        const bEvents = events.createReviewEvents({ client: second, origin: "instance-b", mode: "database" });
        const a = createReviewHub({ reviewEvents: aEvents });
        const b = createReviewHub({ reviewEvents: bEvents });
        hubs.push(a, b);
        const serverA = http.createServer();
        const serverB = http.createServer();
        servers.push(serverA, serverB);
        a.attach(serverA);
        b.attach(serverB);
        await Promise.all([serverA, serverB].map((server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))));

        let idleQueries = 0;
        const originalQuery = first.$queryRawUnsafe.bind(first);
        first.$queryRawUnsafe = (...args) => { idleQueries += 1; return originalQuery(...args); };
        await new Promise((resolve) => setTimeout(resolve, 1600));
        assert.equal(idleQueries, 0, "a hub without sockets does not poll the event table");

        const connect = (server) => new Promise((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/reviews?productId=2468`, { origin: process.env.APP_ORIGIN });
            socket.once("open", () => resolve(socket));
            socket.once("error", reject);
        });
        const socketA = await connect(serverA);
        const socketB = await connect(serverB);
        const receivedA = [];
        const receivedB = [];
        socketA.on("message", (message) => receivedA.push(JSON.parse(message.toString())));
        socketB.on("message", (message) => receivedB.push(JSON.parse(message.toString())));
        const payload = { type: "review.created", review: { id: 73, authorType: "guest", username: "Khách", rating: null, comment: "Tốt", createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z" }, aggregate: { average: null, count: 0 } };
        await aEvents.record(2468, payload);
        await new Promise((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error("instance B did not receive the review event within 3 seconds")), 3000);
            const check = () => {
                if (receivedB.length) { clearTimeout(deadline); resolve(); }
                else setTimeout(check, 50);
            };
            check();
        });
        assert.deepEqual(receivedB[0], payload);
        assert.deepEqual(receivedA, [], "the originating hub does not rebroadcast its event");
        socketA.terminate();
        socketB.terminate();
        first.$queryRawUnsafe = originalQuery;
    });
}
