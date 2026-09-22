const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 24 * 60 * 60;
const REMEMBER_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

class AuthConfigError extends Error {
    constructor(problems) {
        super(`Invalid auth environment: ${problems.join("; ")}`);
        this.name = "AuthConfigError";
        this.code = "AUTH_CONFIGURATION";
        this.statusCode = 500;
    }
}

function required(environment, key, problems) {
    const value = environment[key];
    if (typeof value !== "string" || value.trim() === "") {
        problems.push(`missing ${key}`);
        return undefined;
    }
    return value.trim();
}

function parseBoolean(value, key, problems) {
    if (value === "true") return true;
    if (value === "false") return false;
    problems.push(`${key} must be true or false`);
    return undefined;
}

function parsePort(value, key, problems) {
    if (!/^\d+$/.test(value)) {
        problems.push(`${key} must be an integer`);
        return undefined;
    }
    const port = Number(value);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        problems.push(`${key} must be between 1 and 65535`);
        return undefined;
    }
    return port;
}

function parseOrigins(value, problems) {
    const values = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (values.length === 0) {
        problems.push("APP_ORIGIN must contain an origin");
        return [];
    }

    const origins = [];
    for (const value of values) {
        let parsed;
        try {
            parsed = new URL(value);
        } catch {
            problems.push("APP_ORIGIN must contain valid origins");
            continue;
        }
        if (!/^https?:$/.test(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash) {
            problems.push("APP_ORIGIN must contain http(s) origins without a path");
            continue;
        }
        origins.push(parsed.origin);
    }
    return [...new Set(origins)];
}

function readAuthConfig(environment = process.env) {
    const problems = [];
    const jwtSecret = required(environment, "JWT_ACCESS_SECRET", problems);
    if (jwtSecret && Buffer.byteLength(jwtSecret, "utf8") < 32) {
        problems.push("JWT_ACCESS_SECRET must be at least 32 bytes");
    }
    const appOrigin = required(environment, "APP_ORIGIN", problems);
    const origins = appOrigin ? parseOrigins(appOrigin, problems) : [];
    if (problems.length > 0) throw new AuthConfigError(problems);

    const secure = origins.every((origin) => origin.startsWith("https://"));
    return Object.freeze({
        jwtAccessSecret: jwtSecret,
        appOrigins: Object.freeze(origins),
        secure,
        accessTtlSeconds: DEFAULT_ACCESS_TTL_SECONDS,
        refreshTtlSeconds: DEFAULT_REFRESH_TTL_SECONDS,
        rememberedRefreshTtlSeconds: REMEMBER_REFRESH_TTL_SECONDS,
        cookieNames: Object.freeze(secure
            ? {
                access: "__Host-access_token",
                refresh: "__Secure-refresh_token",
                csrf: "__Host-csrf_token"
            }
            : {
                access: "access_token",
                refresh: "refresh_token",
                csrf: "csrf_token"
            })
    });
}

function readGoogleConfig(environment = process.env) {
    const auth = readAuthConfig(environment);
    const problems = [];
    const clientId = required(environment, "GOOGLE_CLIENT_ID", problems);
    if (problems.length > 0) throw new AuthConfigError(problems);
    return Object.freeze({ ...auth, googleClientId: clientId });
}

function readMailerConfig(environment = process.env) {
    const auth = readAuthConfig(environment);
    const problems = [];
    const host = required(environment, "SMTP_HOST", problems);
    const user = required(environment, "SMTP_USER", problems);
    const password = required(environment, "SMTP_PASSWORD", problems);
    const from = required(environment, "MAIL_FROM", problems);
    const portValue = required(environment, "SMTP_PORT", problems);
    const secureValue = required(environment, "SMTP_SECURE", problems);
    const port = portValue ? parsePort(portValue, "SMTP_PORT", problems) : undefined;
    const secure = secureValue ? parseBoolean(secureValue, "SMTP_SECURE", problems) : undefined;
    if (problems.length > 0) throw new AuthConfigError(problems);
    return Object.freeze({ ...auth, smtp: Object.freeze({ host, port, secure, user, password }), mailFrom: from });
}

module.exports = {
    AuthConfigError,
    DEFAULT_ACCESS_TTL_SECONDS,
    DEFAULT_REFRESH_TTL_SECONDS,
    REMEMBER_REFRESH_TTL_SECONDS,
    readAuthConfig,
    readGoogleConfig,
    readMailerConfig
};
