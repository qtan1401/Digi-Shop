const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { readAuthConfig, AuthConfigError } = require("../auth/config");
const { findUserById } = require("../repositories/auth.repository");

const parseCookies = (req, _res, next) => {
    const cookies = {};
    const header = req.headers.cookie;
    if (typeof header === "string") {
        for (const part of header.split(";")) {
            const separator = part.indexOf("=");
            if (separator <= 0) continue;
            const key = part.slice(0, separator).trim();
            const value = part.slice(separator + 1).trim();
            try {
                cookies[key] = decodeURIComponent(value);
            } catch {
                cookies[key] = value;
            }
        }
    }
    req.cookies = cookies;
    next();
};

const serializeCookie = (name, value, options) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `SameSite=${options.sameSite}`];
    if (options.httpOnly) parts.push("HttpOnly");
    if (options.secure) parts.push("Secure");
    if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    return parts.join("; ");
};
const rateBuckets = new Map();
const RATE_LIMITS = Object.freeze({
    login: Object.freeze({ windowMs: 15 * 60 * 1000, ipMax: 30, identifierMax: 10 }),
    resend: Object.freeze({ windowMs: 15 * 60 * 1000, ipMax: 10, identifierMax: 5 }),
    recover: Object.freeze({ windowMs: 15 * 60 * 1000, ipMax: 10, identifierMax: 5 }),
    refresh: Object.freeze({ windowMs: 60 * 1000, ipMax: 60, identifierMax: 60 })
});

const normalizeRateIdentifier = (value) =>
    typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";

const rateKey = (kind, value) =>
    crypto.createHash("sha256").update(`${kind}\u0000${value}`, "utf8").digest("hex");

const pruneRateBuckets = (now) => {
    for (const [key, bucket] of rateBuckets) {
        if (bucket.expiresAt <= now) rateBuckets.delete(key);
    }
    while (rateBuckets.size > 10000) {
        const oldest = rateBuckets.keys().next().value;
        if (oldest === undefined) break;
        rateBuckets.delete(oldest);
    }
};

const rateLimitAuth = (kind) => (req, res, next) => {
    const policy = RATE_LIMITS[kind] || RATE_LIMITS.login;
    const now = Date.now();
    pruneRateBuckets(now);
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const identifier = normalizeRateIdentifier(req.body?.identifier || req.body?.email);
    const descriptors = [
        { key: rateKey(`${kind}:ip`, ip), limit: policy.ipMax },
        ...(identifier ? [{ key: rateKey(`${kind}:identifier`, identifier), limit: policy.identifierMax }] : [])
    ];
    const blocked = descriptors.some(({ key, limit }) => {
        const bucket = rateBuckets.get(key);
        return bucket && bucket.expiresAt > now && bucket.count >= limit;
    });
    if (blocked) {
        res.set("Retry-After", String(Math.ceil(policy.windowMs / 1000)));
        return res.status(429).json({
            success: false,
            error: { code: "RATE_LIMITED", message: "Too many requests" }
        });
    }
    for (const { key } of descriptors) {
        const bucket = rateBuckets.get(key);
        if (bucket && bucket.expiresAt > now) {
            bucket.count += 1;
        } else {
            rateBuckets.set(key, { count: 1, expiresAt: now + policy.windowMs });
        }
    }
    return next();
};

const ensureCsrfCookie = (req, res, next) => {
    try {
        const config = readAuthConfig();
        if (!req.cookies[config.cookieNames.csrf]) {
            const value = crypto.randomBytes(32).toString("base64url");
            res.append("Set-Cookie", serializeCookie(config.cookieNames.csrf, value, {
                path: "/", httpOnly: false, sameSite: "Strict", secure: config.secure
            }));
            req.cookies[config.cookieNames.csrf] = value;
        }
    } catch (error) {
        if (!(error instanceof AuthConfigError) && error?.code !== "AUTH_CONFIGURATION") return next(error);
        req.authError = error;
    }
    return next();
};

const attachUser = async (req, _res, next) => {
    req.user = null;
    try {
        const config = readAuthConfig();
        const token = req.cookies?.[config.cookieNames.access];
        if (!token) return next();
        let claims;
        try {
            claims = jwt.verify(token, config.jwtAccessSecret);
        } catch {
            return next();
        }
        if (!claims || claims.type !== "access" || typeof claims.sub !== "string" || !Number.isInteger(claims.ver)) return next();
        const user = await findUserById(claims.sub);
        if (!user || user.status !== "ACTIVE" || user.authVersion !== claims.ver || user.role !== claims.role) return next();
        req.user = {
            id: user.id,
            email: user.email || undefined,
            username: user.username || undefined,
            role: user.role,
            status: user.status,
            authVersion: user.authVersion,
            forcePasswordChange: Boolean(user.forcePasswordChange)
        };
        return next();
    } catch (error) {
        if (error instanceof AuthConfigError || error?.code === "AUTH_CONFIGURATION") {
            req.authError = error;
            return next();
        }
        return next(error);
    }
};

const sendMiddlewareError = (res, status, code, message) =>
    res.status(status).json({ success: false, error: { code, message } });

const requireAuth = (req, res, next) => {
    if (req.authError) return sendMiddlewareError(res, 500, "AUTH_CONFIGURATION", "Authentication is temporarily unavailable");
    if (!req.user) return sendMiddlewareError(res, 401, "AUTH_REQUIRED", "Authentication is required");
    return next();
};

const requireRole = (...roles) => (req, res, next) => {
    if (req.authError) return sendMiddlewareError(res, 500, "AUTH_CONFIGURATION", "Authentication is temporarily unavailable");
    if (!req.user) return sendMiddlewareError(res, 401, "AUTH_REQUIRED", "Authentication is required");
    if (!roles.includes(req.user.role)) return sendMiddlewareError(res, 403, "FORBIDDEN", "You do not have permission for this resource");
    if (req.user.role === "admin" && req.user.forcePasswordChange) {
        return sendMiddlewareError(res, 403, "PASSWORD_CHANGE_REQUIRED", "Change your password before continuing");
    }
    return next();
};

const originAllowed = (origin, origins) => typeof origin === "string" && origins.includes(origin);

const requireCsrf = (req, res, next) => {
    if (req.authError) return sendMiddlewareError(res, 500, "AUTH_CONFIGURATION", "Authentication is temporarily unavailable");
    let config;
    try {
        config = readAuthConfig();
    } catch {
        return sendMiddlewareError(res, 500, "AUTH_CONFIGURATION", "Authentication is temporarily unavailable");
    }
    if (!originAllowed(req.headers.origin, config.appOrigins)) {
        return sendMiddlewareError(res, 403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed");
    }
    const cookieToken = req.cookies?.[config.cookieNames.csrf];
    const headerToken = req.headers["x-csrf-token"];
    if (typeof cookieToken !== "string" || typeof headerToken !== "string") {
        return sendMiddlewareError(res, 403, "CSRF_FAILED", "CSRF validation failed");
    }
    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerToken);
    if (cookieBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(cookieBuffer, headerBuffer)) {
        return sendMiddlewareError(res, 403, "CSRF_FAILED", "CSRF validation failed");
    }
    return next();
};

const requireGoogleCsrf = (req, res, next) => {
    let config;
    try {
        config = readAuthConfig();
    } catch {
        return sendMiddlewareError(res, 500, "AUTH_CONFIGURATION", "Authentication is temporarily unavailable");
    }
    if (!originAllowed(req.headers.origin, config.appOrigins)) {
        return sendMiddlewareError(res, 403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed");
    }
    const cookieToken = req.cookies?.g_csrf_token;
    const bodyToken = req.body?.g_csrf_token;
    if (typeof cookieToken !== "string" || typeof bodyToken !== "string") {
        return sendMiddlewareError(res, 403, "CSRF_FAILED", "CSRF validation failed");
    }
    const cookieBuffer = Buffer.from(cookieToken);
    const bodyBuffer = Buffer.from(bodyToken);
    if (cookieBuffer.length !== bodyBuffer.length || !crypto.timingSafeEqual(cookieBuffer, bodyBuffer)) {
        return sendMiddlewareError(res, 403, "CSRF_FAILED", "CSRF validation failed");
    }
    return next();
};

module.exports = {
    parseCookies,
    ensureCsrfCookie,
    attachUser,
    requireAuth,
    requireRole,
    requireCsrf,
    requireGoogleCsrf,
    rateLimitAuth
};