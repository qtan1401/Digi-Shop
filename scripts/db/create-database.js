require("dotenv").config();

const { Pool } = require("pg");
const { DatabaseConfigError, readDatabaseConfig } = require("../../src/db/config");

function validateDatabaseName(databaseName) {
    if (typeof databaseName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(databaseName)) {
        throw new DatabaseConfigError(["DATABASE_URL must name a valid PostgreSQL database"]);
    }
    return databaseName;
}

function classifyConnectionError(error) {
    const code = typeof error.code === "string" ? error.code : "UNKNOWN";
    if (code === "28P01") return { category: "authentication", code };
    if (code === "42501") return { category: "permission", code };
    if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P03"].includes(code)) {
        return { category: "network", code };
    }
    return { category: "database", code };
}

async function createDatabase() {
    const { connectionString, ssl, connectionTimeout, poolMax } = readDatabaseConfig();
    let url;
    try {
        url = new URL(connectionString);
    } catch {
        throw new DatabaseConfigError(["DATABASE_URL must be a valid PostgreSQL URL"]);
    }
    const databaseName = validateDatabaseName(decodeURIComponent(url.pathname.slice(1)));
    url.pathname = "/postgres";
    const pool = new Pool({
        connectionString: url.toString(),
        max: poolMax,
        ssl,
        ...(connectionTimeout === undefined ? {} : { connectionTimeoutMillis: connectionTimeout })
    });

    try {
        const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
        if (existing.rowCount) return false;
        try {
            await pool.query(`CREATE DATABASE "${databaseName}"`);
        } catch (error) {
            if (error.code === "42P04") return false;
            throw error;
        }
        return true;
    } finally {
        await pool.end();
    }
}

async function main() {
    try {
        const created = await createDatabase();
        console.log(created ? "Database created." : "Database already exists.");
    } catch (error) {
        if (error instanceof DatabaseConfigError) {
            console.error(error.message);
        } else {
            const diagnostic = classifyConnectionError(error);
            console.error(`Database bootstrap failed [${diagnostic.category}] (${diagnostic.code}).`);
        }
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    classifyConnectionError,
    createDatabase,
    validateDatabaseName
};
