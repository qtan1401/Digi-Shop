const assert = require("node:assert/strict");
const { test } = require("node:test");
const { existsSync } = require("node:fs");
const path = require("node:path");
const seedData = require("../prisma/seed-data");
const { resetDatabase } = require("../prisma/seed");
const { normalizeSeedData } = require("../scripts/db/normalize-seed");

const targetEnvironment = {
    DATABASE_URL: "postgresql://test:test-only@localhost:5432/digishop",
    DB_POOL_MAX: "1",
    DB_CONNECT_TIMEOUT_MS: "1000",
    ADMIN_DEFAULT_PASSWORD: "Fresh-test-only-password-123!",
    STORE_RESET_CONFIRMATION: "RESET LOCAL DIGISHOP"
};

test("normal seed inputs cover every brand and device type with image-backed variants and a spec sheet", () => {
    assert.deepEqual(seedData.catalog, {
        brands: ["Apple", "Samsung", "MSI", "Aula", "Logitech", "Razer", "Keychron", "Asus"],
        deviceTypes: ["laptop", "keyboard", "mouse", "headphone", "monitor", "storage"]
    });
    assert.equal(seedData.administrator.username, "admin123");
    const commerce = seedData.commerce;
    assert.ok(commerce.orders.length >= Math.ceil(commerce.products.length * 4 / 3) + 8);
    // Two years of demo history: 12 founding accounts plus the customers that joined later.
    assert.ok(commerce.users.length >= 55 && commerce.users.length <= 65);
    assert.ok(commerce.users.slice(0, 12).every((user) => user.email.endsWith("@seed.local")));
    assert.equal(commerce.vouchers.length, 8);
    assert.deepEqual(seedData.commerce.audits, []);
    assert.equal(seedData.commerce.products.length, 42);
    const normalized = normalizeSeedData(seedData.commerce);
    assert.equal(normalized.products.length, seedData.commerce.products.length);
    assert.ok(normalized.products.reduce((total, product) => total + product.variants.length, 0) >= seedData.commerce.products.length * 2);
    assert.equal(normalized.products.find((product) => product.id === 401).options[0].values[0].colorHex, "#F2F2F4");

    const products = seedData.commerce.products;
    for (const brand of seedData.catalog.brands) assert.ok(products.some((product) => product.brand === brand), brand);
    for (const deviceType of seedData.catalog.deviceTypes) assert.ok(products.some((product) => product.deviceType === deviceType), deviceType);
    assert.equal(products.filter((product) => product.deviceType === "laptop").length, 5);
    for (const type of ["keyboard", "mouse"]) {
        assert.ok(products.filter((product) => product.deviceType === type).length >= 14, `${type} should paginate at 12 per page`);
    }
    const tagCounts = new Map();
    for (const product of products) {
        assert.ok(product.tags?.length > 0, `${product.name} needs a seed tag`);
        for (const tag of product.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    assert.deepEqual([...tagCounts.keys()].sort(), ["co-hoc", "di-dong", "gaming", "khong-day", "rgb", "sang-tao-noi-dung", "van-phong"]);
    for (const [tag, count] of tagCounts) assert.ok(count >= 3, `${tag} needs at least three products`);

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

test("reset rejects a non-local PostgreSQL target before connecting", async () => {
    await assert.rejects(
        resetDatabase({
            environment: { ...targetEnvironment, DATABASE_URL: "postgresql://test:test-only@production.example:5432/digishop" }
        }),
        /restricted to localhost:5432 database digishop/
    );
});

test("reset rejects connection-string host overrides before connecting", async () => {
    await assert.rejects(
        resetDatabase({
            environment: { ...targetEnvironment, DATABASE_URL: "postgresql://test:test-only@localhost:5432/digishop?host=production.example" }
        }),
        /restricted to localhost:5432 database digishop/
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
