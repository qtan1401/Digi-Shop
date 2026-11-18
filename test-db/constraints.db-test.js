const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { resetDatabase, createUser, createProduct, createVoucher } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database integrity contracts require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let db;
    beforeEach(async () => { db = await resetDatabase(); });
    after(async () => { await require("../src/db/prisma").disconnectPrisma(); });

    test("one signed-in customer cannot review the same product twice", async () => {
        const { product } = await createProduct(db);
        const user = await createUser(db);
        const data = { productId: product.id, userId: user.id, rating: 5, comment: "Tốt" };
        await db.productReview.create({ data });
        await assert.rejects(db.productReview.create({ data: { ...data, comment: "Rất tốt" } }));
        assert.equal(await db.productReview.count({ where: { productId: product.id, userId: user.id } }), 1);
    });

    test("multiple guest comments with null user IDs remain allowed", async () => {
        const { product } = await createProduct(db);
        for (const comment of ["Dùng tốt", "Phù hợp máy tính"]) {
            await db.productReview.create({ data: { productId: product.id, userId: null, guestName: "Khách", comment } });
        }
        assert.equal(await db.productReview.count({ where: { productId: product.id, userId: null } }), 2);
    });

    test("the database preserves legacy alphanumeric voucher codes and rejects malformed ones", async () => {
        const legacy = await createVoucher(db, { code: "ABCD" });
        assert.equal((await db.voucher.findUnique({ where: { id: legacy.id } })).code, "ABCD");
        await assert.rejects(createVoucher(db, { code: "AB-CD" }));
        assert.equal(await db.voucher.count(), 1);
    });

    test("the database rejects brands outside the catalog taxonomy", async () => {
        await assert.rejects(createProduct(db, { brand: "UnknownBrand" }));
        assert.equal(await db.product.count(), 0);
    });

    test("the database rejects negative variant stock", async () => {
        const { variant } = await createProduct(db);
        await assert.rejects(db.productVariant.update({ where: { id: variant.id }, data: { stock: -1 } }));
        assert.equal((await db.productVariant.findUnique({ where: { id: variant.id } })).stock, 10);
    });

    test("the database rejects negative voucher quantity and over-redemption", async () => {
        await assert.rejects(createVoucher(db, { code: "NEG01", quantity: -1 }));
        await assert.rejects(createVoucher(db, { code: "OVER1", quantity: 1, redeemedCount: 2 }));
        assert.equal(await db.voucher.count(), 0);
    });
}
