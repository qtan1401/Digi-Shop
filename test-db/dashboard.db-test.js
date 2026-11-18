const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { resetDatabase, createProduct, createOrder } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database dashboard contracts require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let db;
    beforeEach(async () => { db = await resetDatabase(); });
    after(async () => { await require("../src/db/prisma").disconnectPrisma(); });

    test("23:30 on December 31 and 00:10 on January 1 in Vietnam belong to different years", async () => {
        const { variant } = await createProduct(db, { price: 1000, costPrice: 600 });
        await createOrder(db, variant, { createdAt: new Date("2025-12-31T16:30:00Z"), unitCost: 600 });
        await createOrder(db, variant, { createdAt: new Date("2025-12-31T17:10:00Z"), unitCost: 600 });
        const { getSeries } = require("../src/services/admin-dashboard.service");
        const series = await getSeries({ granularity: "year", from: "2025-01-01", to: "2026-12-31" });
        assert.deepEqual(series.buckets.map(({ key, orders, revenue }) => [key, orders, revenue]), [
            ["2025-01-01", 1, 1000], ["2026-01-01", 1, 1000]
        ]);
    });

    test("monthly dashboard retains empty months and matches independently calculated revenue and profit", async () => {
        const { variant } = await createProduct(db, { price: 1000, costPrice: 600 });
        await createOrder(db, variant, {
            createdAt: new Date("2025-12-31T17:10:00Z"), quantity: 2, unitPrice: 1000,
            unitCost: 600, discount: 100, pointsDiscount: 50
        });
        await createOrder(db, variant, {
            createdAt: new Date("2026-03-20T00:00:00Z"), unitPrice: 1000, unitCost: 600,
            orderStatus: "CANCELLED", paymentStatus: "PAID"
        });
        await createOrder(db, variant, {
            createdAt: new Date("2026-03-21T00:00:00Z"), unitPrice: 1000, unitCost: 600,
            orderStatus: "PENDING", paymentStatus: "UNPAID"
        });
        const { getSeries } = require("../src/services/admin-dashboard.service");
        const series = await getSeries({ granularity: "month", from: "2026-01-01", to: "2026-12-31" });
        assert.equal(series.buckets.length, 12);
        assert.deepEqual(series.buckets.map(({ key }) => key), [
            "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01",
            "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"
        ]);
        assert.deepEqual([series.buckets[0].orders, series.buckets[0].revenue, series.buckets[0].profit, series.buckets[0].itemsSold], [1, 1850, 650, 2]);
        assert.deepEqual([series.buckets[1].orders, series.buckets[1].revenue, series.buckets[1].profit], [0, 0, 0]);
        assert.deepEqual([series.buckets[2].orders, series.buckets[2].revenue, series.buckets[2].profit], [1, 0, 0]);
        assert.deepEqual(series.totals, { orders: 2, revenue: 1850, profit: 650, itemsSold: 2 });
    });
}
