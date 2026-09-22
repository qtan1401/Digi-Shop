class DatabaseConfigError extends Error {
    constructor(problems) {
        super(`Invalid database environment: ${problems.join("; ")}`);
        this.name = "DatabaseConfigError";
    }
}

const REQUIRED_KEYS = [
    "DATABASE_URL",
    "DB_SERVER",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_ENCRYPT",
    "DB_TRUST_SERVER_CERTIFICATE",
    "DB_CONNECT_TIMEOUT_MS",
    "DB_POOL_MAX"
];

function parseInteger(value, key, minimum, maximum, problems) {
    if (!/^\d+$/.test(value)) {
        problems.push(`${key} must be an integer`);
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        problems.push(`${key} must be between ${minimum} and ${maximum}`);
        return undefined;
    }

    return parsed;
}

function parseBoolean(value, key, problems) {
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }

    problems.push(`${key} must be true or false`);
    return undefined;
}

function readDatabaseConfig(environment = process.env) {
    const problems = [];
    const values = {};

    for (const key of REQUIRED_KEYS) {
        const value = environment[key];
        if (typeof value !== "string" || value.trim() === "") {
            problems.push(`missing ${key}`);
        } else {
            values[key] = value;
        }
    }

    if (problems.length > 0) {
        throw new DatabaseConfigError(problems);
    }

    const port = parseInteger(values.DB_PORT, "DB_PORT", 1, 65535, problems);
    const connectionTimeout = parseInteger(
        values.DB_CONNECT_TIMEOUT_MS,
        "DB_CONNECT_TIMEOUT_MS",
        1,
        2147483647,
        problems
    );
    const poolMax = parseInteger(values.DB_POOL_MAX, "DB_POOL_MAX", 1, 1000, problems);
    const encrypt = parseBoolean(values.DB_ENCRYPT, "DB_ENCRYPT", problems);
    const trustServerCertificate = parseBoolean(
        values.DB_TRUST_SERVER_CERTIFICATE,
        "DB_TRUST_SERVER_CERTIFICATE",
        problems
    );

    if (problems.length > 0) {
        throw new DatabaseConfigError(problems);
    }

    return Object.freeze({
        connectionString: values.DATABASE_URL,
        databaseName: values.DB_NAME,
        mssql: Object.freeze({
            server: values.DB_SERVER,
            port,
            database: values.DB_NAME,
            user: values.DB_USER,
            password: values.DB_PASSWORD,
            connectionTimeout,
            pool: Object.freeze({ max: poolMax }),
            options: Object.freeze({
                encrypt,
                trustServerCertificate
            })
        })
    });
}

module.exports = {
    DatabaseConfigError,
    readDatabaseConfig
};
