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

test("normal seed inputs include five image-backed color and storage products per device type", () => {
    assert.deepEqual(seedData.catalog, {
        brands: ["Apple", "Samsung", "MSI"],
        deviceTypes: ["phone", "tablet", "laptop"]
    });
    assert.equal(seedData.administrator.username, "admin123");
    assert.deepEqual(seedData.commerce.orders, []);
    assert.deepEqual(seedData.commerce.audits, []);
    assert.equal(seedData.commerce.products.length, 15);
    const normalized = normalizeSeedData(seedData.commerce);
    assert.equal(normalized.products.length, 15);
    assert.equal(normalized.products.reduce((total, product) => total + product.variants.length, 0), 82);
    assert.equal(normalized.products.find((product) => product.id === 101).options[0].values[0].colorHex, "#8E8C85");

    for (const deviceType of seedData.catalog.deviceTypes) {
        const products = seedData.commerce.products.filter((product) => product.deviceType === deviceType);
        assert.equal(products.length, 5);
        for (const product of products) {
            const colors = product.options.find((option) => option.name === "Màu sắc");
            assert.ok(colors?.values.length);
            assert.ok(product.options.some((option) => option.name === "Bộ nhớ" && option.values.length > 0));
            assert.ok(product.variants.length > 0);

            const imageByColor = new Map();
            for (const variant of product.variants) {
                const color = variant.optionValues["Màu sắc"];
                assert.ok(color);
                assert.ok(variant.image?.startsWith("/uploads/products/"));
                assert.ok(existsSync(path.join(__dirname, "..", "data", "product-images", path.basename(variant.image))));
                if (imageByColor.has(color)) assert.equal(variant.image, imageByColor.get(color));
                imageByColor.set(color, variant.image);
            }
            assert.deepEqual([...imageByColor.keys()].sort(), colors.values.map(({ value }) => value).sort());
            assert.equal(product.image, imageByColor.get(colors.values[0].value));
        }
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
