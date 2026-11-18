class DatabaseConfigError extends Error {
    constructor(problems) {
        super(`Invalid database environment: ${problems.join("; ")}`);
        this.name = "DatabaseConfigError";
    }
}


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
    const connectionString = environment.DATABASE_URL;
    if (typeof connectionString !== "string" || connectionString.trim() === "") {
        problems.push("missing DATABASE_URL");
    } else if (!/^postgres(?:ql)?:\/\//.test(connectionString)) {
        problems.push("DATABASE_URL must start with postgresql:// or postgres://");
    } else {
        try {
            const url = new URL(connectionString);
            if (!url.hostname || url.pathname.length <= 1) {
                problems.push("DATABASE_URL must include a host and database name");
            }
        } catch {
            problems.push("DATABASE_URL must be a valid PostgreSQL URL");
        }
    }

    const poolMax = environment.DB_POOL_MAX === undefined || environment.DB_POOL_MAX === ""
        ? 10 : parseInteger(environment.DB_POOL_MAX, "DB_POOL_MAX", 1, 1000, problems);
    const ssl = environment.DB_SSL === undefined || environment.DB_SSL === ""
        ? false : parseBoolean(environment.DB_SSL, "DB_SSL", problems);
    const connectionTimeout = environment.DB_CONNECT_TIMEOUT_MS === undefined || environment.DB_CONNECT_TIMEOUT_MS === ""
        ? undefined : parseInteger(environment.DB_CONNECT_TIMEOUT_MS, "DB_CONNECT_TIMEOUT_MS", 1, 2147483647, problems);

    if (problems.length > 0) {
        throw new DatabaseConfigError(problems);
    }
    return Object.freeze({ connectionString, poolMax, ssl, connectionTimeout });
}

module.exports = {
    DatabaseConfigError,
    readDatabaseConfig
};
