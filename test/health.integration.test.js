const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");

process.env.INSTANCE_ID = "health-test-instance";

const database = require("../src/db/prisma");
const app = require("../src/app");

let server;
let baseUrl;

before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
});

test("health reports the instance and database without setting an auth cookie", async (t) => {
    t.mock.method(database, "getPrismaClient", () => ({ $queryRaw: async () => [{ ok: 1 }] }));

    const response = await fetch(`${baseUrl}/healthz`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", db: "ok", instance: "health-test-instance" });
    assert.equal(response.headers.get("x-instance"), "health-test-instance");
    assert.equal(response.headers.get("set-cookie"), null);
});

test("all app HTTP responses carry the instance identity", async () => {
    const response = await fetch(`${baseUrl}/not-a-route`);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-instance"), "health-test-instance");
});

test("health returns a sanitized 503 when PostgreSQL is unavailable", async (t) => {
    t.mock.method(database, "getPrismaClient", () => ({
        $queryRaw: async () => { throw new Error("postgresql://private-connection-string"); }
    }));

    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(body), { status: "error", db: "down", instance: "health-test-instance" });
    assert.equal(response.headers.get("x-instance"), "health-test-instance");
    assert.equal(body.includes("private-connection-string"), false);
});

test("health times out a stalled database check", async (t) => {
    t.mock.method(database, "getPrismaClient", () => ({ $queryRaw: () => new Promise(() => {}) }));

    const response = await fetch(`${baseUrl}/healthz`);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "error", db: "down", instance: "health-test-instance" });
});
