require("dotenv").config();

const { readDatabaseConfig } = require("./config");
const REQUIRED_TABLES = [
    "_prisma_migrations",
    "products",
    "product_options",
    "product_option_values",
    "product_variants",
    "product_variant_option_values",
    "orders",
    "order_items",
    "audit_logs",
    "users",
    "oauth_identities",
    "refresh_sessions",
    "email_verification_tokens",
    "carts",
    "cart_items",
    "cart_merge_operations",
    "payment_attempts"
];
const REQUIRED_MIGRATION = "20261120000000_postgresql_baseline";

class DatabaseSchemaError extends Error {
    constructor() {
        super("Database schema is not ready");
        this.name = "DatabaseSchemaError";
        this.code = "SCHEMA_NOT_READY";
    }
}

let prismaClient;

function createPrismaClient() {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { PrismaClient } = require("@prisma/client");
    const { Pool } = require("pg");
    const { connectionString, poolMax, ssl, connectionTimeout } = readDatabaseConfig();
    const pool = new Pool({
        connectionString,
        max: poolMax,
        ssl,
        // PrismaPg sends DateTime arguments without an offset; UTC avoids shifts on non-UTC PostgreSQL hosts.
        options: "-c timezone=UTC",
        ...(connectionTimeout === undefined ? {} : { connectionTimeoutMillis: connectionTimeout })
    });
    return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
}

function getPrismaClient() {
    if (!prismaClient) {
        prismaClient = createPrismaClient();
    }

    return prismaClient;
}

async function verifyDatabaseSchema(client) {
    const rows = await client.$queryRawUnsafe(`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name IN (
              '_prisma_migrations', 'products', 'product_options', 'product_option_values',
              'product_variants', 'product_variant_option_values', 'orders', 'order_items',
              'audit_logs', 'users', 'oauth_identities', 'refresh_sessions',
              'email_verification_tokens', 'carts', 'cart_items',
              'cart_merge_operations', 'payment_attempts'
          );
    `);
    const existingTables = new Set(rows.map(({ tableName }) => tableName));
    const missingTables = REQUIRED_TABLES.filter((tableName) => !existingTables.has(tableName));
    if (missingTables.length > 0) {
        throw new DatabaseSchemaError();
    }

    const migrations = await client.$queryRawUnsafe(`
        SELECT migration_name AS "migrationName"
        FROM public._prisma_migrations
        WHERE migration_name = '${REQUIRED_MIGRATION}'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
        LIMIT 1;
    `);
    if (migrations[0]?.migrationName !== REQUIRED_MIGRATION) {
        throw new DatabaseSchemaError();
    }
}

async function connectPrisma() {
    const client = getPrismaClient();
    await client.$connect();
    await verifyDatabaseSchema(client);
    return client;
}

async function disconnectPrisma() {
    if (!prismaClient) {
        return;
    }

    const client = prismaClient;
    prismaClient = undefined;
    await client.$disconnect();
}

module.exports = {
    DatabaseSchemaError,
    getPrismaClient,
    connectPrisma,
    disconnectPrisma,
    verifyDatabaseSchema
};
