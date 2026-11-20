const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { resetDatabase, createUser, createProduct, createOrder } = require("./helpers/reset-database");

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
        assert.deepEqual(series.totals, { orders: 2, revenue: 1850, profit: 650, itemsSold: 2, newUsers: 0 });
    });

    const placeAt = async (variant, instants, options = {}) => {
        for (const instant of instants) await createOrder(db, variant, { createdAt: new Date(instant), unitPrice: 1000, unitCost: 600, ...options });
    };

    test("a week that crosses the year boundary is one Monday-keyed bucket; neighbouring weeks split at 00:00 Monday Vietnam time", async () => {
        const { variant } = await createProduct(db, { price: 1000, costPrice: 600 });
        await placeAt(variant, [
            "2025-12-28T16:59:59Z", // Sun 28 Dec 23:59 -> week of 22 Dec
            "2025-12-28T17:00:00Z", // Mon 29 Dec 00:00 -> week of 29 Dec
            "2025-12-31T16:59:59Z", // Wed 31 Dec 23:59
            "2025-12-31T17:00:00Z", // Thu 1 Jan 00:00
            "2026-01-04T16:59:59Z", // Sun 4 Jan 23:59 -> still the week of 29 Dec
            "2026-01-04T17:00:00Z" // Mon 5 Jan 00:00 -> week of 5 Jan
        ]);
        const { getSeries } = require("../src/services/admin-dashboard.service");
        const series = await getSeries({ granularity: "week", from: "2025-12-22", to: "2026-01-11" });
        assert.deepEqual(series.buckets.map(({ key, label, orders, revenue, profit, itemsSold }) => [key, label, orders, revenue, profit, itemsSold]), [
            ["2025-12-22", "22/12", 1, 1000, 400, 1],
            ["2025-12-29", "29/12", 4, 4000, 1600, 4],
            ["2026-01-05", "05/01", 1, 1000, 400, 1]
        ]);
    });

    test("Q4 rolls into Q1 at 00:00 on 1 January and Q1 into Q2 at 00:00 on 1 April, Vietnam time", async () => {
        const { variant } = await createProduct(db, { price: 1000, costPrice: 600 });
        await placeAt(variant, [
            "2025-09-30T16:59:59Z", // 30 Sep 23:59 -> Q3
            "2025-09-30T17:00:00Z", // 1 Oct 00:00 -> Q4
            "2025-12-31T16:59:59Z", // 31 Dec 23:59 -> Q4
            "2025-12-31T17:00:00Z", // 1 Jan 00:00 -> Q1
            "2026-03-31T16:59:59Z", // 31 Mar 23:59 -> Q1
            "2026-03-31T17:00:00Z" // 1 Apr 00:00 -> Q2
        ]);
        const { getSeries } = require("../src/services/admin-dashboard.service");
        const series = await getSeries({ granularity: "quarter", from: "2025-07-01", to: "2026-06-30" });
        assert.deepEqual(series.buckets.map(({ key, label, orders }) => [key, label, orders]), [
            ["2025-07-01", "Q3/2025", 1], ["2025-10-01", "Q4/2025", 2], ["2026-01-01", "Q1/2026", 2], ["2026-04-01", "Q2/2026", 1]
        ]);
    });

    test("a custom range across two years works with month and week granularity, and its edges are exact instants", async () => {
        const { variant } = await createProduct(db, { price: 1000, costPrice: 600 });
        await placeAt(variant, [
            "2025-11-10T03:00:00Z", // before the range
            "2025-11-14T16:59:59Z", // 14 Nov 23:59: one second before the range
            "2025-11-14T17:00:00Z", // 15 Nov 00:00: first instant of the range
            "2025-11-15T03:00:00Z",
            "2025-12-20T03:00:00Z",
            "2026-02-10T16:59:59Z", // 10 Feb 23:59: last second of the range
            "2026-02-10T17:00:00Z" // 11 Feb 00:00: after the range
        ]);
        const { getSeries } = require("../src/services/admin-dashboard.service");
        const range = { from: "2025-11-15", to: "2026-02-10" };

        const months = await getSeries({ granularity: "month", ...range });
        assert.deepEqual(months.buckets.map(({ key, orders, revenue }) => [key, orders, revenue]), [
            ["2025-11-01", 2, 2000], ["2025-12-01", 1, 1000], ["2026-01-01", 0, 0], ["2026-02-01", 1, 1000]
        ]);
        assert.equal(months.totals.orders, 4);

        const weeks = await getSeries({ granularity: "week", ...range });
        assert.equal(weeks.buckets.length, 14);
        assert.equal(weeks.buckets[0].key, "2025-11-10");
        assert.equal(weeks.buckets[13].key, "2026-02-09");
        assert.deepEqual(weeks.buckets.filter((bucket) => bucket.orders > 0).map(({ key, orders }) => [key, orders]), [
            ["2025-11-10", 2], ["2025-12-15", 1], ["2026-02-09", 1]
        ]);
        const emptyWeek = weeks.buckets.find((bucket) => bucket.key === "2025-12-29");
        assert.deepEqual([emptyWeek.orders, emptyWeek.revenue, emptyWeek.profit, emptyWeek.itemsSold, emptyWeek.newUsers, emptyWeek.deviceTypes], [0, 0, 0, 0, 0, {}]);
        assert.equal(weeks.totals.orders, 4);
    });

    test("cancelled orders count nowhere; unpaid orders count as orders but not as revenue; empty buckets are zero rows", async () => {
        const { variant } = await createProduct(db, { price: 1000, costPrice: 600 });
        await placeAt(variant, ["2026-01-10T03:00:00Z"]);
        await placeAt(variant, ["2026-02-10T03:00:00Z"], { orderStatus: "CANCELLED", paymentStatus: "PAID" });
        await placeAt(variant, ["2026-03-10T03:00:00Z"], { orderStatus: "PENDING", paymentStatus: "UNPAID" });
        await placeAt(variant, ["2026-03-11T03:00:00Z"], { orderStatus: "DELIVERED", paymentStatus: "UNPAID" });
        const { getSeries } = require("../src/services/admin-dashboard.service");
        const series = await getSeries({ granularity: "month", from: "2026-01-01", to: "2026-04-30" });
        const row = ({ key, orders, revenue, profit, itemsSold, newUsers, deviceTypes }) => [key, orders, revenue, profit, itemsSold, newUsers, deviceTypes];
        assert.deepEqual(series.buckets.map(row), [
            ["2026-01-01", 1, 1000, 400, 1, 0, { keyboard: 1 }],
            ["2026-02-01", 0, 0, 0, 0, 0, {}],
            ["2026-03-01", 2, 1000, 400, 1, 0, { keyboard: 1 }],
            ["2026-04-01", 0, 0, 0, 0, 0, {}]
        ]);
        assert.deepEqual(series.totals, { orders: 3, revenue: 2000, profit: 800, itemsSold: 2, newUsers: 0 });
    });

    test("new users, distinct device types and the previous-year comparison come from SQL grouping in shop time", async () => {
        const { variant: keyboard } = await createProduct(db, { price: 1000, costPrice: 600 });
        const { variant: mouse } = await createProduct(db, { name: "Chuột Logitech", brand: "Logitech", deviceType: "mouse", price: 1000, costPrice: 600 });
        await createUser(db, { createdAt: new Date("2025-12-31T16:59:59Z") }); // 31 Dec 23:59 -> 2025
        await createUser(db, { createdAt: new Date("2025-12-31T17:00:00Z") }); // 1 Jan 00:00 -> January 2026
        await createUser(db, { role: "admin", email: null, username: "contract-admin", createdAt: new Date("2026-01-15T03:00:00Z") }); // administrators are not new users
        await createUser(db, { createdAt: new Date("2026-02-10T03:00:00Z") });
        await createUser(db, { createdAt: new Date("2026-02-20T03:00:00Z") });
        await placeAt(keyboard, ["2025-06-15T03:00:00Z"]);
        await placeAt(keyboard, ["2026-01-10T03:00:00Z"], { quantity: 2 });
        await placeAt(mouse, ["2026-01-12T03:00:00Z"]);
        const { getSeries } = require("../src/services/admin-dashboard.service");
        const series = await getSeries({ granularity: "month", from: "2026-01-01", to: "2026-12-31" });
        assert.deepEqual(series.buckets.map((bucket) => bucket.newUsers), [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert.deepEqual(series.buckets[0].deviceTypes, { keyboard: 2, mouse: 1 });
        assert.deepEqual(series.totals, { orders: 2, revenue: 3000, profit: 1200, itemsSold: 3, newUsers: 3 });
        assert.deepEqual(series.previous, {
            from: "2025-01-01",
            to: "2025-12-31",
            totals: { orders: 1, revenue: 1000, profit: 400, itemsSold: 1, newUsers: 1 },
            change: { orders: 100, revenue: 200, profit: 200, itemsSold: 200, newUsers: 200 }
        });
    });
}
