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

    const { randomUUID } = require("node:crypto");
    const randomSlug = (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`;
    const rawProduct = (categoryId, data = {}) => db.product.create({ data: {
        brand: "Keychron", deviceType: "keyboard", categoryId, name: "Bàn phím", image: "/images/test.png",
        description: "Bàn phím cho máy tính", slug: `contract-${randomUUID()}`, ...data
    } });

    test("the migration seeds six live categories plus hidden phone and tablet rows", async () => {
        const rows = await db.category.findMany({ orderBy: { sortOrder: "asc" } });
        assert.deepEqual(rows.filter((row) => !row.isDeleted).map((row) => row.slug), ["laptop", "keyboard", "mouse", "headphone", "monitor", "storage"]);
        assert.deepEqual(rows.filter((row) => row.isDeleted).map((row) => row.slug), ["phone", "tablet"]);
    });

    test("every product needs an existing category (foreign key)", async () => {
        await assert.rejects(rawProduct(999999));
        await assert.rejects(db.product.create({ data: {
            brand: "Keychron", deviceType: "keyboard", name: "Thiếu danh mục", image: "/images/test.png",
            description: "Thiếu danh mục", slug: `contract-${randomUUID()}`
        } }));
        assert.equal(await db.product.count(), 0);
    });

    test("a category that still has products cannot be hard-deleted", async () => {
        const category = await db.category.create({ data: { slug: randomSlug("loa"), name: "Loa" } });
        await rawProduct(category.id, { deviceType: category.slug });
        await assert.rejects(db.category.delete({ where: { id: category.id } }));
        assert.equal(await db.category.count({ where: { id: category.id } }), 1);
    });

    test("the fixed device_type list is gone: a product may use a new category slug", async () => {
        const category = await db.category.create({ data: { slug: "speaker", name: "Loa" } });
        const product = await rawProduct(category.id, { deviceType: "speaker" });
        assert.equal(product.deviceType, "speaker");
    });

    test("category slug is unique only among rows that are not deleted", async () => {
        const first = await db.category.create({ data: { slug: "speaker", name: "Loa" } });
        await assert.rejects(db.category.create({ data: { slug: "speaker", name: "Loa trùng" } }));
        await db.category.update({ where: { id: first.id }, data: { isDeleted: true, deletedAt: new Date() } });
        const reused = await db.category.create({ data: { slug: "speaker", name: "Loa mới" } });
        await assert.rejects(db.category.update({ where: { id: first.id }, data: { isDeleted: false, deletedAt: null } }));
        assert.equal(await db.category.count({ where: { slug: "speaker" } }), 2);
        assert.notEqual(reused.id, first.id);
    });

    test("category and tag slugs allow 40 lowercase characters but reject invalid lengths or characters", async () => {
        for (const slug of ["A-b", "a", "x".repeat(41), "co dau", "dấu"]) {
            await assert.rejects(db.category.create({ data: { slug, name: "Sai" } }), undefined, slug);
            await assert.rejects(db.tag.create({ data: { slug, name: "Sai" } }), undefined, slug);
        }
        const slug = "x".repeat(40);
        const category = await db.category.create({ data: { slug, name: "Đủ dài" } });
        await db.tag.create({ data: { slug, name: "Đủ dài" } });
        const product = await rawProduct(category.id, { deviceType: slug });
        assert.equal(product.deviceType, slug);
    });

    test("tag slug is unique only among rows that are not deleted", async () => {
        const first = await db.tag.create({ data: { slug: "gaming", name: "Gaming" } });
        await assert.rejects(db.tag.create({ data: { slug: "gaming", name: "Gaming trùng" } }));
        await db.tag.update({ where: { id: first.id }, data: { isDeleted: true, deletedAt: new Date() } });
        await db.tag.create({ data: { slug: "gaming", name: "Gaming mới" } });
        assert.equal(await db.tag.count({ where: { slug: "gaming" } }), 2);
    });

    test("product_tags links each tag to a product once and follows both foreign keys", async () => {
        const category = await db.category.findFirst({ where: { slug: "keyboard", isDeleted: false } });
        const product = await rawProduct(category.id);
        const tag = await db.tag.create({ data: { slug: "rgb", name: "RGB" } });
        await db.productTag.create({ data: { productId: product.id, tagId: tag.id } });
        await assert.rejects(db.productTag.create({ data: { productId: product.id, tagId: tag.id } }));
        await assert.rejects(db.productTag.create({ data: { productId: product.id, tagId: 999999 } }));
        await assert.rejects(db.productTag.create({ data: { productId: 999999, tagId: tag.id } }));
        assert.equal(await db.productTag.count(), 1);
        await db.tag.delete({ where: { id: tag.id } });
        assert.equal(await db.productTag.count(), 0);
    });
}
