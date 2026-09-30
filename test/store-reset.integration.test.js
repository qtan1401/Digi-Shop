const assert = require("node:assert/strict");
const { test } = require("node:test");
const seedData = require("../prisma/seed-data");
const { resetDatabase } = require("../prisma/seed");

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

test("normal seed inputs define only fixed vocabulary and configured admin without sample records", () => {
    assert.deepEqual(seedData.catalog, {
        brands: ["Apple", "Samsung", "MSI"],
        deviceTypes: ["phone", "tablet", "laptop"]
    });
    assert.equal(seedData.administrator.username, "admin123");
    assert.deepEqual(seedData.commerce, { products: [], orders: [], audits: [] });
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
