const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../..");

function testDatabaseUrl() {
    const value = process.env.TEST_DATABASE_URL;
    if (!value) throw new Error("TEST_DATABASE_URL is required before resetting a database");
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL pointing to a _test database");
    }
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !/^[a-zA-Z0-9_-]+_test$/.test(database)) {
        throw new Error("Refusing to reset a database whose name does not end in _test");
    }
    return value;
}

async function resetDatabase() {
    const url = testDatabaseUrl();
    // Disconnect the singleton before Prisma drops the schema; never inherit the developer's DATABASE_URL.
    const { disconnectPrisma } = require("../../src/db/prisma");
    await disconnectPrisma();
    process.env.DATABASE_URL = url;
    try {
        await execFileAsync(process.execPath, [
            path.join(path.dirname(require.resolve("prisma/package.json")), "build/index.js"),
            "migrate", "reset", "--force"
        ], { cwd: root, env: { ...process.env, DATABASE_URL: url }, maxBuffer: 4 * 1024 * 1024 });
    } catch {
        // CLI output may contain connection details; never echo it into test logs.
        throw new Error("Test database migration reset failed");
    }
    return require("../../src/db/prisma").getPrismaClient();
}

function createUser(client, data = {}) {
    return client.user.create({ data: { id: randomUUID(), email: `contract-${randomUUID()}@example.test`, role: "user", status: "ACTIVE", ...data } });
}

async function createProduct(client, { name = "Bàn phím Keychron", brand = "Keychron", deviceType = "keyboard", stock = 10, price = 1000000, costPrice = 600000 } = {}) {
    const category = await client.category.findFirst({ where: { slug: deviceType, isDeleted: false }, select: { id: true } });
    if (!category) throw new Error(`Missing test category: ${deviceType}`);
    const product = await client.product.create({ data: {
        name, brand, deviceType, image: "/images/test-keyboard.png", description: `${name} cho máy tính`,
        slug: `contract-${randomUUID()}`, categoryId: category.id
    } });
    const variant = await client.productVariant.create({ data: {
        productId: product.id, sku: `TEST-${randomUUID()}`, combinationKey: "0".repeat(64),
        stock, price, costPrice
    } });
    return { product, variant };
}

function createVoucher(client, { code = "ABCDE", quantity = 1, redeemedCount = 0, ...data } = {}) {
    return client.voucher.create({ data: {
        code, description: "Contract test discount", type: "PERCENT", percent: 10, maxDiscount: 100000,
        startsAt: new Date("2020-01-01T00:00:00Z"), endsAt: new Date("2099-01-01T00:00:00Z"),
        quantity, redeemedCount, ...data
    } });
}

function createOrder(client, variant, { userId = null, createdAt = new Date(), orderStatus = "PROCESSING", paymentStatus = "PAID", quantity = 1, discount = 0, pointsDiscount = 0, unitPrice = 1000, unitCost = 800 } = {}) {
    const subtotal = unitPrice * quantity;
    return client.order.create({ data: {
        id: `TEST-${randomUUID()}`, userId, subtotal, shippingFee: 0, discount,
        pointsDiscount, totalPrice: subtotal - discount - pointsDiscount,
        customerName: "Contract Customer", customerPhone: "0900000000", customerAddress: "Hà Nội",
        paymentMethod: "COD", orderStatus, paymentStatus, createdAt,
        items: { create: [{ variantId: variant.id, nameSnapshot: "Contract product", imageSnapshot: "/images/test.png",
            skuSnapshot: variant.sku, optionsSnapshot: "{}", unitPrice, unitCost, quantity, lineTotal: subtotal }] }
    } });
}

module.exports = { testDatabaseUrl, resetDatabase, createUser, createProduct, createVoucher, createOrder };
