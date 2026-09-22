require("dotenv").config();

const { readDatabaseConfig } = require("./config");
const REQUIRED_TABLES = [
    "_prisma_migrations",
    "categories",
    "products",
    "orders",
    "order_items",
    "audit_logs",
    "users",
    "oauth_identities",
    "refresh_sessions",
    "email_verification_tokens",
    "carts",
    "cart_items",
    "cart_merge_operations"
];
const REQUIRED_MIGRATION = "20260922000000_auth_data_foundation";

class DatabaseSchemaError extends Error {
    constructor() {
        super("Database schema is not ready");
        this.name = "DatabaseSchemaError";
        this.code = "SCHEMA_NOT_READY";
    }
}

let prismaClient;

function createPrismaClient() {
    const { PrismaMssql } = require("@prisma/adapter-mssql");
    const { PrismaClient } = require("@prisma/client");
    const { mssql } = readDatabaseConfig();
    const adapter = new PrismaMssql({
        ...mssql,
        pool: { ...mssql.pool },
        options: { ...mssql.options }
    });

    return new PrismaClient({ adapter });
}

function getPrismaClient() {
    if (!prismaClient) {
        prismaClient = createPrismaClient();
    }

    return prismaClient;
}

async function verifyDatabaseSchema(client) {
    const rows = await client.$queryRawUnsafe(`
        SELECT [TABLE_NAME] AS [tableName]
        FROM [INFORMATION_SCHEMA].[TABLES]
        WHERE [TABLE_SCHEMA] = N'dbo'
          AND [TABLE_TYPE] = N'BASE TABLE'
          AND [TABLE_NAME] IN (
              N'_prisma_migrations', N'categories', N'products', N'orders', N'order_items', N'audit_logs',
              N'users', N'oauth_identities', N'refresh_sessions', N'email_verification_tokens',
              N'carts', N'cart_items', N'cart_merge_operations'
          );
    `);
    const existingTables = new Set(rows.map(({ tableName }) => tableName));
    const missingTables = REQUIRED_TABLES.filter((tableName) => !existingTables.has(tableName));

    if (missingTables.length > 0) {
        throw new DatabaseSchemaError();
    }

    const migrations = await client.$queryRawUnsafe(`
        SELECT TOP (1) [migration_name] AS [migrationName]
        FROM [dbo].[_prisma_migrations]
        WHERE [migration_name] = N'20260922000000_auth_data_foundation'
          AND [finished_at] IS NOT NULL
          AND [rolled_back_at] IS NULL;
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
