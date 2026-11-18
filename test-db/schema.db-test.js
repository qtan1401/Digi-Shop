const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { resetDatabase } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database schema contracts require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let db;
    beforeEach(async () => { db = await resetDatabase(); });
    after(async () => { await require("../src/db/prisma").disconnectPrisma(); });

    test("schema verification accepts the migrated PostgreSQL test database", async () => {
        await assert.doesNotReject(require("../src/db/prisma").verifyDatabaseSchema(db));
    });

    test("schema verification rejects an empty database with SCHEMA_NOT_READY", async () => {
        const { verifyDatabaseSchema } = require("../src/db/prisma");
        const rollback = new Error("Rollback empty-schema probe");
        try {
            await db.$transaction(async (transaction) => {
                // PostgreSQL DDL is transactional: drop only inside a transaction that is always rolled back.
                const tables = await transaction.$queryRaw`
                    SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
                `;
                assert.ok(tables.length > 0, "the migrated database must contain tables before the probe");
                const names = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(", ");
                await transaction.$executeRawUnsafe(`DROP TABLE ${names} CASCADE`);
                await assert.rejects(verifyDatabaseSchema(transaction), { code: "SCHEMA_NOT_READY" });
                throw rollback;
            });
        } catch (error) {
            if (error !== rollback) throw error;
        }
        await assert.doesNotReject(verifyDatabaseSchema(db));
    });
}
