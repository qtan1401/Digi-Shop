require("dotenv").config();

const sql = require("mssql");
const { DatabaseConfigError, readDatabaseConfig } = require("../../src/db/config");

function validateDatabaseName(databaseName) {
    if (
        databaseName.length > 128 ||
        databaseName !== databaseName.trim() ||
        /[\u0000-\u001F\u007F]/.test(databaseName)
    ) {
        throw new DatabaseConfigError(["DB_NAME must be a valid SQL Server identifier of at most 128 characters"]);
    }

    return databaseName;
}

function classifyConnectionError(error) {
    const code = typeof error.code === "string" ? error.code : "UNKNOWN";
    const number = Number(error.number);

    if (code === "ELOGIN" || number === 18456) {
        return { category: "authentication", code };
    }
    if ([229, 262, 916, 15247].includes(number)) {
        return { category: "permission", code };
    }
    if (["ETIMEOUT", "ESOCKET", "ECONNCLOSED", "ENOTOPEN"].includes(code)) {
        return { category: "network", code };
    }

    return { category: "database", code };
}

async function createDatabase() {
    const { databaseName: configuredName, mssql } = readDatabaseConfig();
    const databaseName = validateDatabaseName(configuredName);
    const pool = new sql.ConnectionPool({ ...mssql, database: "master" });

    try {
        await pool.connect();
        const result = await pool.request()
            .input("databaseName", sql.NVarChar(128), databaseName)
            .query(`
                DECLARE @created BIT = 0;

                IF DB_ID(@databaseName) IS NULL
                BEGIN
                    DECLARE @statement NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@databaseName);
                    EXEC sys.sp_executesql @statement;
                    SET @created = 1;
                END;

                SELECT @created AS [created];
            `);

        return result.recordset[0].created === true;
    } finally {
        if (pool.connected || pool.connecting) {
            await pool.close();
        }
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
