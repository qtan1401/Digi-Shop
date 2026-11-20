const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { resetDatabase } = require("./helpers/reset-database");
const commerce = require("../prisma/seed-data").commerce;

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database seed contracts require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let db;
    beforeEach(async () => { db = await resetDatabase(); });
    after(async () => { await require("../src/db/prisma").disconnectPrisma(); });

    const expectedCounts = {
        products: commerce.products.length,
        variants: commerce.products.reduce((total, product) => total + product.variants.length, 0),
        images: commerce.products.reduce((total, product) => total + product.images.length, 0),
        users: commerce.users.length + Number(!commerce.users.some(({ username }) => username === "admin123")),
        orders: commerce.orders.length,
        orderItems: commerce.orders.reduce((total, order) => total + order.items.length, 0),
        vouchers: commerce.vouchers.length,
        reviews: commerce.reviews.length,
        tags: new Set(commerce.products.flatMap((product) => product.tags)).size,
        productTags: commerce.products.reduce((total, product) => total + new Set(product.tags).size, 0)
    };

    const readCounts = async () => ({
        products: await db.product.count(),
        variants: await db.productVariant.count(),
        images: await db.productImage.count(),
        users: await db.user.count(),
        orders: await db.order.count(),
        orderItems: await db.orderItem.count(),
        vouchers: await db.voucher.count(),
        reviews: await db.productReview.count(),
        tags: await db.tag.count({ where: { isDeleted: false } }),
        productTags: await db.productTag.count()
    });

    test("seed mode writes the commerce fixture and is idempotent on PostgreSQL", async () => {
        const { seedDatabase } = require("../prisma/seed");
        await seedDatabase();
        assert.deepEqual(await readCounts(), expectedCounts);
        await seedDatabase();
        assert.deepEqual(await readCounts(), expectedCounts);
        const perTag = await db.productTag.groupBy({ by: ["tagId"], _count: { productId: true } });
        assert.ok(perTag.every((row) => row._count.productId >= 3));
        assert.equal(await db.product.count({ where: { tags: { none: {} } } }), 0);
    });
}
