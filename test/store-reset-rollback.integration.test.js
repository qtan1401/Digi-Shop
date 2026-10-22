const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const sql = require("mssql");
const { verifyResetRollback } = require("../prisma/seed");

const clearedTables = [
    "payment_attempts", "order_items", "orders", "cart_items", "carts", "cart_merge_operations",
    "oauth_identities", "refresh_sessions", "email_verification_tokens", "product_variant_option_values",
    "product_variants", "product_option_values", "product_options", "products", "users", "categories", "audit_logs"
];
const initialTables = Object.fromEntries(clearedTables.map((table) => [table, [{ marker: `${table}-legacy-a` }, { marker: `${table}-legacy-b` }]]));
let poolInstance;

class RollbackPool {
    constructor() {
        this.tables = structuredClone(initialTables);
        this.deletes = [];
        this.connected = false;
        poolInstance = this;
    }
    async connect() { this.connected = true; return this; }
    async close() { this.connected = false; }
    request() { return new RollbackRequest(this, this); }
}

class RollbackRequest {
    constructor(pool, transaction) { this.pool = pool; this.transaction = transaction; this.values = {}; }
    input(key, _type, value) { this.values[key] = value; return this; }
    async query(statement) {
        const sqlText = statement.replace(/\s+/g, " ").trim();
        if (/^UPDATE \[dbo\]\.\[refresh_sessions\] SET \[replaced_by_id\] = NULL;?$/i.test(sqlText)) {
            return { recordset: [] };
        }
        const deleteMatch = sqlText.match(/^DELETE FROM \[dbo\]\.\[([a-z_]+)\];?$/i);
        if (deleteMatch) {
            const table = deleteMatch[1];
            this.pool.deletes.push(table);
            this.pool.tables[table] = [];
            return { recordset: [] };
        }
        const countMatch = sqlText.match(/^SELECT COUNT_BIG\(\*\) AS \[count\] FROM \[dbo\]\.\[([a-z_]+)\];?$/i);
        if (countMatch) return { recordset: [{ count: BigInt(this.pool.tables[countMatch[1]].length) }] };
        if (/^SELECT TOP \(1\)/i.test(sqlText)) return { recordset: [] };
        if (/^INSERT INTO \[dbo\]\.\[users\]/i.test(sqlText)) {
            this.pool.tables.users.push({
                username: this.values.username,
                role: "admin",
                force_password_change: true
            });
            return { recordset: [] };
        }
        if (/^SELECT \[username\], \[role\], \[force_password_change\] FROM \[dbo\]\.\[users\];?$/i.test(sqlText)) {
            return { recordset: this.pool.tables.users.map(({ username, role, force_password_change }) => ({ username, role, force_password_change })) };
        }
        throw new Error(`Unexpected SQL in rollback verification: ${sqlText}`);
    }
}

class RollbackTransaction {
    constructor(pool) { this.pool = pool; this.snapshot = null; this.committed = false; }
    async begin() { this.snapshot = structuredClone(this.pool.tables); }
    request() { return new RollbackRequest(this.pool, this); }
    async rollback() { this.pool.tables = this.snapshot; this.snapshot = null; }
    async commit() { this.committed = true; throw new Error("Rollback verification must never commit"); }
}

const originalPool = sql.ConnectionPool;
const originalTransaction = sql.Transaction;
sql.ConnectionPool = RollbackPool;
sql.Transaction = RollbackTransaction;
after(() => {
    sql.ConnectionPool = originalPool;
    sql.Transaction = originalTransaction;
});

const environment = {
    DATABASE_URL: "sqlserver://localhost:1433;database=DigiShop;user=test;password=test-only;trustServerCertificate=true",
    DB_SERVER: "localhost",
    DB_PORT: "1433",
    DB_NAME: "DigiShop",
    DB_USER: "test",
    DB_PASSWORD: "test-only",
    DB_ENCRYPT: "false",
    DB_TRUST_SERVER_CERTIFICATE: "true",
    DB_CONNECT_TIMEOUT_MS: "1000",
    DB_POOL_MAX: "1",
    ADMIN_DEFAULT_PASSWORD: "Fresh-test-only-password-123!",
    STORE_RESET_ROLLBACK_CONFIRMATION: "ROLLBACK CHECK LOCAL DIGISHOP"
};

test("rollback verification refuses to connect without its distinct confirmation", async () => {
    poolInstance = null;
    await assert.rejects(
        verifyResetRollback({
            environment: { ...environment, STORE_RESET_ROLLBACK_CONFIRMATION: "" }
        }),
        /STORE_RESET_ROLLBACK_CONFIRMATION/
    );
    assert.equal(poolInstance, null);
});

test("rollback verification clears every required table in order, then proves no table changed", async () => {
    const result = await verifyResetRollback({ environment });
    assert.equal(result.outcome, "rolled back; no changes committed");
    assert.deepEqual(result.before, Object.fromEntries(clearedTables.map((table) => [table, 2])));
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(poolInstance.deletes, clearedTables);
    assert.equal(poolInstance.tables.users.length, 2);
    assert.deepEqual(poolInstance.tables.categories, initialTables.categories);
});
