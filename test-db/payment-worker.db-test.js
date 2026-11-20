const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createProduct, createVoucher, createOrder, resetDatabase } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("payment expiration coordination requires test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let db;
    let clients = [];
    before(async () => {
        db = await resetDatabase();
        const { connectionString, poolMax, ssl, connectionTimeout } = require("../src/db/config").readDatabaseConfig();
        const { PrismaPg } = require("@prisma/adapter-pg");
        const { PrismaClient } = require("@prisma/client");
        const { Pool } = require("pg");
        clients = [1, 2].map(() => {
            const pool = new Pool({
                connectionString,
                max: poolMax,
                ssl,
                options: "-c timezone=UTC",
                ...(connectionTimeout === undefined ? {} : { connectionTimeoutMillis: connectionTimeout })
            });
            return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
        });
    });
    after(async () => {
        await Promise.all(clients.map((client) => client.$disconnect()));
        await require("../src/db/prisma").disconnectPrisma();
    });

    test("concurrent workers expire one due payment attempt and restore its inventory and Voucher once", async () => {
        const { variant } = await createProduct(db, { stock: 1 });
        const voucher = await createVoucher(db, { code: "LOCK1", quantity: 1, redeemedCount: 1 });
        const order = await createOrder(db, variant, {
            paymentStatus: "UNPAID",
            orderStatus: "PENDING",
            discount: 100
        });
        await db.productVariant.update({ where: { id: variant.id }, data: { stock: 0 } });
        await db.order.update({ where: { id: order.id }, data: { paymentMethod: "MOMO" } });
        await db.orderVoucher.create({ data: {
            orderId: order.id,
            voucherId: voucher.id,
            codeSnapshot: voucher.code,
            typeSnapshot: voucher.type,
            percentSnapshot: voucher.percent,
            discountAmount: 100
        } });
        await db.paymentAttempt.create({ data: {
            id: `attempt-${order.id}`,
            orderId: order.id,
            provider: "MOMO",
            amount: 900,
            status: "PENDING",
            expiresAt: new Date(Date.now() - 60_000)
        } });

        const { expireDueAttempts } = require("../src/repositories/payment.repository");
        let unlockOrder;
        let orderLocked;
        const orderLockReady = new Promise((resolve) => { orderLocked = resolve; });
        const holdOrderLock = db.$transaction(async (transaction) => {
            await transaction.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
            orderLocked();
            await new Promise((resolve) => { unlockOrder = resolve; });
        });
        await orderLockReady;
        const workerOutcomes = clients.map((client) => expireDueAttempts(new Date(), 100, client));
        const firstOutcome = await Promise.race(workerOutcomes);
        assert.equal(firstOutcome, 0);
        unlockOrder();
        await holdOrderLock;
        const results = await Promise.all(workerOutcomes);

        assert.deepEqual(results.sort(), [0, 1]);
        assert.equal((await db.paymentAttempt.findUnique({ where: { id: `attempt-${order.id}` } })).status, "EXPIRED");
        assert.equal((await db.productVariant.findUnique({ where: { id: variant.id } })).stock, 1);
        assert.equal((await db.voucher.findUnique({ where: { id: voucher.id } })).redeemedCount, 0);
        const redemption = await db.orderVoucher.findUnique({ where: { orderId_voucherId: { orderId: order.id, voucherId: voucher.id } } });
        assert.ok(redemption.releasedAt instanceof Date);
    });
}
