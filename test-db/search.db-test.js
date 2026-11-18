const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { resetDatabase, createUser, createProduct, createOrder } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database search contracts require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    let db;
    beforeEach(async () => { db = await resetDatabase(); });
    after(async () => { await require("../src/db/prisma").disconnectPrisma(); });

    test("unaccented Vietnamese text finds accented product names", async () => {
        const { product } = await createProduct(db, { name: "Bàn phím cơ Keychron" });
        const page = await require("../src/services/product.service").getCatalogPage({ q: "ban phim" });
        assert.deepEqual(page.data.map((row) => row.id), [product.id]);
    });

    test("uppercase product queries find mixed-case names", async () => {
        const { product } = await createProduct(db, { name: "Bàn phím Keychron" });
        const page = await require("../src/services/product.service").getCatalogPage({ q: "KEYCHRON" });
        assert.deepEqual(page.data.map((row) => row.id), [product.id]);
    });

    test("catalog search treats percent, underscore, and backslash as literal characters", async () => {
        const matching = await createProduct(db, { name: "Bàn phím 100%_\\ cơ" });
        await createProduct(db, { name: "Bàn phím 100AA cơ" });
        const page = await require("../src/services/product.service").getCatalogPage({ q: "100%_\\" });
        assert.deepEqual(page.data.map((row) => row.id), [matching.product.id]);
    });

    test("mixed-case usernames remain discoverable at login and unique across case", async () => {
        const customer = await createUser(db, { username: "Alice" });
        const authRepository = require("../src/repositories/auth.repository");
        const { normalizeUsername } = require("../src/services/auth.service");
        assert.equal((await authRepository.findUserByIdentifier(normalizeUsername("ALICE"))).id, customer.id);
        assert.equal((await authRepository.findUserByUsername("aLiCe")).id, customer.id);
        await assert.rejects(createUser(db, { username: "alice" }), { code: "P2002" });
    });

    test("admin customer, order, and review searches are case-insensitive", async () => {
        const { product, variant } = await createProduct(db);
        const customer = await createUser(db, { fullName: "Nguyễn Keychron", username: "keyboardreviewer" });
        const order = await createOrder(db, variant, { userId: customer.id });
        await db.order.update({ where: { id: order.id }, data: { customerName: "Nguyễn Keychron" } });
        const review = await db.productReview.create({ data: {
            productId: product.id, userId: customer.id, rating: 5, comment: "Bàn phím Keychron rất tốt"
        } });
        const users = await require("../src/services/admin-user.service").listUsers({ q: "KEYCHRON" });
        const orders = await require("../src/services/order.service").getAllOrders({ q: "KEYCHRON" });
        const reviews = await require("../src/services/review.service").listAdminReviews({ q: "KEYCHRON" });
        assert.deepEqual(users.data.map((row) => row.id), [customer.id]);
        assert.deepEqual(orders.data.map((row) => row.id), [order.id]);
        assert.deepEqual(reviews.data.map((row) => row.id), [review.id]);
    });

    test("Vietnamese name sorting orders A, Ă, Â, B, D, and Đ alphabetically", async () => {
        const names = ["Đèn bàn máy tính", "Âm thanh máy tính", "Dây bàn phím", "Ăng-ten máy tính", "Bàn phím cơ", "Adapter máy tính"];
        for (const name of names) await createProduct(db, { name });
        const page = await require("../src/services/product.service").getCatalogPage({ sort: "name", order: "asc" });
        assert.deepEqual(page.data.map((row) => row.name), [
            "Adapter máy tính", "Ăng-ten máy tính", "Âm thanh máy tính",
            "Bàn phím cơ", "Dây bàn phím", "Đèn bàn máy tính"
        ]);
    });
}
