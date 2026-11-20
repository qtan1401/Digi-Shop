const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { resetDatabase } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database rate limits require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let primary;
    let second;
    let store;
    beforeEach(async () => {
        primary = await resetDatabase();
        const { PrismaClient } = require("@prisma/client");
        const { PrismaPg } = require("@prisma/adapter-pg");
        const adapter = new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL });
        second = new PrismaClient({ adapter });
        await second.$connect();
        store = require("../src/infra/rate-limit-store").createDatabaseRateLimitStore(primary);
    });
    after(async () => {
        if (second) await second.$disconnect();
        await require("../src/db/prisma").disconnectPrisma();
    });

    test("independent clients share atomic counts and threshold state", async () => {
        const key = `db-contract-${randomUUID()}`;
        assert.equal((await store.hit(key, 60_000)).count, 1);
        const otherStore = require("../src/infra/rate-limit-store").createDatabaseRateLimitStore(second);
        assert.equal((await otherStore.hit(key, 60_000)).count, 2);
        assert.equal((await store.hit(key, 60_000)).count, 3);
    });

    test("an expired database bucket starts again at one", async () => {
        const key = `db-expired-${randomUUID()}`;
        await store.hit(key, 1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal((await store.hit(key, 60_000)).count, 1);
    });
}
