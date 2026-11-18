const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const pg = require("pg");
const { verifyResetRollback } = require("../prisma/seed");

const clearedTables = [
    "order_vouchers", "order_status_history", "vouchers", "product_reviews", "payment_attempts", "order_items", "orders", "cart_items", "carts", "cart_merge_operations",
    "oauth_identities", "refresh_sessions", "email_verification_tokens", "user_addresses", "product_images", "product_variant_option_values",
    "product_variants", "product_option_values", "product_options", "products", "users", "audit_logs"
];
const initialTables = Object.fromEntries(clearedTables.map((table) => [table, [{ marker: `${table}-legacy-a` }, { marker: `${table}-legacy-b` }]]));
let poolInstance;

class RollbackPool {
    constructor() {
        this.tables = structuredClone(initialTables);
        this.deletes = [];
        this.connected = false;
        this.snapshot = null;
        this.committed = false;
        poolInstance = this;
    }
    async connect() {
        this.connected = true;
        return {
            query: (statement, values) => this.query(statement, values),
            release: () => { this.connected = false; }
        };
    }
    async end() { this.connected = false; }
    async query(statement, values = []) {
        const sqlText = statement.replace(/\s+/g, " ").trim();
        if (/^BEGIN ISOLATION LEVEL SERIALIZABLE$/i.test(sqlText)) {
            this.snapshot = structuredClone(this.tables);
            return { rows: [] };
        }
        if (/^ROLLBACK$/i.test(sqlText)) {
            this.tables = this.snapshot;
            this.snapshot = null;
            return { rows: [] };
        }
        if (/^COMMIT$/i.test(sqlText)) {
            this.committed = true;
            throw new Error("Rollback verification must never commit");
        }
        if (/^UPDATE refresh_sessions SET replaced_by_id = NULL$/i.test(sqlText)) return { rows: [] };
        const deleteMatch = sqlText.match(/^DELETE FROM "([a-z_]+)"$/i);
        if (deleteMatch) {
            const table = deleteMatch[1];
            this.deletes.push(table);
            this.tables[table] = [];
            return { rows: [] };
        }
        const countMatch = sqlText.match(/^SELECT COUNT\(\*\) AS count FROM "([a-z_]+)"$/i);
        if (countMatch) return { rows: [{ count: String(this.tables[countMatch[1]].length) }] };
        if (/^SELECT id, role, password_hash AS "passwordHash" FROM users WHERE username = \$1 FOR UPDATE;?$/i.test(sqlText)) {
            return { rows: [] };
        }
        if (/^INSERT INTO users \(id, username, password_hash, role, status, force_password_change\)/i.test(sqlText)) {
            this.tables.users.push({ username: values[1], role: "admin", force_password_change: true });
            return { rows: [] };
        }
        if (/^SELECT username, role, force_password_change FROM users;?$/i.test(sqlText)) {
            return { rows: this.tables.users.map(({ username, role, force_password_change }) => ({ username, role, force_password_change })) };
        }
        throw new Error(`Unexpected SQL in rollback verification: ${sqlText}`);
    }
}

const originalPool = pg.Pool;
pg.Pool = RollbackPool;
after(() => {
    pg.Pool = originalPool;
});

const environment = {
    DATABASE_URL: "postgresql://test:test-only@localhost:5432/digishop",
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
    assert.equal(poolInstance.committed, false);
});
