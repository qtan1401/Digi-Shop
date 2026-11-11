const assert = require("node:assert/strict");
const { test } = require("node:test");
const { existsSync } = require("node:fs");
const path = require("node:path");
const seedData = require("../prisma/seed-data");
const { resetDatabase } = require("../prisma/seed");
const { normalizeSeedData } = require("../scripts/db/normalize-seed");

const targetEnvironment = {
    DATABASE_URL: "sqlserver://localhost:1433;database=DigiShop;user=sa;password=Test-only-password!;trustServerCertificate=true",
    DB_SERVER: "localhost",
    DB_PORT: "1433",
    DB_NAME: "DigiShop",
    DB_USER: "sa",
    DB_PASSWORD: "test-only-password",
    DB_ENCRYPT: "false",
    DB_TRUST_SERVER_CERTIFICATE: "true",
    DB_CONNECT_TIMEOUT_MS: "1000",
    DB_POOL_MAX: "1",
    ADMIN_DEFAULT_PASSWORD: "Fresh-test-only-password-123!",
    STORE_RESET_CONFIRMATION: "RESET LOCAL DIGISHOP"
};

test("normal seed inputs cover every brand and device type with image-backed variants and a spec sheet", () => {
    assert.deepEqual(seedData.catalog, {
        brands: ["Apple", "Samsung", "MSI", "Aula", "Logitech", "Razer", "Keychron", "Asus"],
        deviceTypes: ["laptop", "keyboard", "mouse", "headphone", "monitor", "storage"]
    });
    assert.equal(seedData.administrator.username, "admin123");
    assert.equal(seedData.commerce.orders.length, 48);
    assert.equal(seedData.commerce.users.length, 12);
    assert.equal(seedData.commerce.vouchers.length, 8);
    assert.deepEqual(seedData.commerce.audits, []);
    assert.equal(seedData.commerce.products.length, 24);
    const normalized = normalizeSeedData(seedData.commerce);
    assert.equal(normalized.products.length, 24);
    assert.equal(normalized.products.reduce((total, product) => total + product.variants.length, 0), 76);
    assert.equal(normalized.products.find((product) => product.id === 401).options[0].values[0].colorHex, "#F2F2F4");

    const products = seedData.commerce.products;
    for (const brand of seedData.catalog.brands) assert.ok(products.some((product) => product.brand === brand), brand);
    for (const deviceType of seedData.catalog.deviceTypes) assert.ok(products.some((product) => product.deviceType === deviceType), deviceType);
    assert.equal(products.filter((product) => product.deviceType === "laptop").length, 5);

    for (const product of products) {
        assert.ok(product.variants.length >= 2, `${product.name} needs at least two variants`);
        const [firstOption] = product.options;
        const imageByValue = new Map();
        for (const variant of product.variants) {
            assert.ok(variant.image?.startsWith("/uploads/products/"), variant.sku);
            assert.ok(existsSync(path.join(__dirname, "..", "data", "product-images", path.basename(variant.image))), variant.image);
            const value = variant.optionValues[firstOption.name];
            if (imageByValue.has(value)) assert.equal(variant.image, imageByValue.get(value));
            imageByValue.set(value, variant.image);
        }
        assert.equal(product.image, imageByValue.get(firstOption.values[0].value));

        const [description, specSheet] = product.description.split("\nThông số kỹ thuật\n");
        assert.ok(description.split("\n").filter(Boolean).length >= 5, `${product.name} description`);
        assert.ok(specSheet.split("\n").filter((line) => line.includes(": ")).length >= 3, `${product.name} spec sheet`);
    }
});

test("reset rejects a non-local SQL Server target before connecting", async () => {
    await assert.rejects(
        resetDatabase({
            environment: { ...targetEnvironment, DB_SERVER: "production.example" }
        }),
        /restricted to localhost:1433 database DigiShop/
    );
});

test("reset rejects missing explicit operator confirmation before connecting", async () => {
    await assert.rejects(
        resetDatabase({
            environment: { ...targetEnvironment, STORE_RESET_CONFIRMATION: "" }
        }),
        /STORE_RESET_CONFIRMATION/
    );
});

test("reset requires a freshly configured strong admin password before connecting", async () => {
    await assert.rejects(
        resetDatabase({
            environment: { ...targetEnvironment, ADMIN_DEFAULT_PASSWORD: "short" }
        }),
        /ADMIN_DEFAULT_PASSWORD/
    );
});
