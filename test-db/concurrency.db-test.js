const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { resetDatabase, createUser, createProduct, createVoucher } = require("./helpers/reset-database");

if (process.env.npm_lifecycle_event !== "test:db" || !process.env.TEST_DATABASE_URL) {
    test("database concurrency contracts require test:db and TEST_DATABASE_URL", { skip: "Run npm run test:db with TEST_DATABASE_URL" }, () => {});
} else {
    // Checkout's fire-and-forget email is outside these database transaction contracts.
    require("../src/services/order.service").sendOrderConfirmation = async () => true;

    let db;
    beforeEach(async () => { db = await resetDatabase(); });
    after(async () => { await require("../src/db/prisma").disconnectPrisma(); });

    const checkout = (userId, variantId, extra = {}) => require("../src/services/checkout.service").processCheckout(userId, {
        variantId, quantity: 1, customerName: "Khách thử nghiệm", customerPhone: "0900000000",
        customerAddress: "Hà Nội", paymentMethod: "COD", ...extra
    });

    test("only one concurrent checkout can buy the last product variant", async () => {
        const { variant } = await createProduct(db, { stock: 1 });
        const [first, second] = await Promise.all([createUser(db), createUser(db)]);
        const results = await Promise.allSettled([checkout(first.id, variant.id), checkout(second.id, variant.id)]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(results.filter((result) => result.status === "rejected").length, 1);
        assert.equal(await db.order.count(), 1);
        assert.equal((await db.productVariant.findUnique({ where: { id: variant.id } })).stock, 0);
    });

    test("only one concurrent order can redeem the final voucher use", async () => {
        const { variant } = await createProduct(db, { stock: 2 });
        const voucher = await createVoucher(db);
        const [first, second] = await Promise.all([createUser(db), createUser(db)]);
        const results = await Promise.allSettled([
            checkout(first.id, variant.id, { voucherCodes: [voucher.code] }),
            checkout(second.id, variant.id, { voucherCodes: [voucher.code] })
        ]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(results.filter((result) => result.status === "rejected").length, 1);
        const orders = await db.order.findMany({ include: { vouchers: true } });
        assert.equal(orders.filter((order) => Number(order.discount) > 0).length, 1);
        assert.equal(orders.filter((order) => order.vouchers.length === 1).length, 1);
        assert.equal((await db.voucher.findUnique({ where: { id: voucher.id } })).redeemedCount, 1);
    });

    test("concurrent additions of the same variant produce one cart line with the sum", async () => {
        const { variant } = await createProduct(db, { stock: 10 });
        const user = await createUser(db);
        const { mergeGuestCart } = require("../src/services/cart.service");
        await Promise.all([
            mergeGuestCart(user.id, randomUUID(), [{ variantId: variant.id, quantity: 2 }]),
            mergeGuestCart(user.id, randomUUID(), [{ variantId: variant.id, quantity: 3 }])
        ]);
        const cart = await db.cart.findUnique({ where: { userId: user.id }, include: { items: true } });
        assert.equal(cart.items.length, 1);
        assert.equal(cart.items[0].quantity, 5);
    });

    test("cancelling an order twice releases its voucher once without restoring stock", async () => {
        const { variant } = await createProduct(db, { stock: 2 });
        const user = await createUser(db);
        const voucher = await createVoucher(db);
        const placed = await checkout(user.id, variant.id, { voucherCodes: [voucher.code] });
        assert.equal((await db.productVariant.findUnique({ where: { id: variant.id } })).stock, 1);
        const { updateOrderStatus } = require("../src/repositories/order.repository");
        await Promise.all([updateOrderStatus(placed.order.id, "CANCELLED"), updateOrderStatus(placed.order.id, "CANCELLED")]);
        assert.equal((await db.productVariant.findUnique({ where: { id: variant.id } })).stock, 1);
        assert.equal((await db.voucher.findUnique({ where: { id: voucher.id } })).redeemedCount, 0);
        const redemption = await db.orderVoucher.findUnique({ where: { orderId_voucherId: { orderId: placed.order.id, voucherId: voucher.id } } });
        assert.ok(redemption.releasedAt instanceof Date);
    });

    test("concurrent loyalty credits and redemptions preserve the exact point balance", async () => {
        const { variant } = await createProduct(db, { stock: 3 });
        const user = await createUser(db, { loyaltyPoints: 100 });
        const original = await checkout(user.id, variant.id);
        await db.order.update({ where: { id: original.order.id }, data: { pointsEarned: 20 } });
        const { updatePaymentStatus } = require("../src/services/order.service");
        const [redemption, credit] = await Promise.all([
            checkout(user.id, variant.id, { pointsToUse: 30 }),
            updatePaymentStatus(original.order.id, "PAID")
        ]);
        assert.equal(redemption.order.pointsRedeemed, 30);
        assert.equal(credit.paymentStatus, "PAID");
        assert.equal((await db.user.findUnique({ where: { id: user.id } })).loyaltyPoints, 90);
        assert.ok((await db.order.findUnique({ where: { id: original.order.id } })).pointsCreditedAt);
    });
}
