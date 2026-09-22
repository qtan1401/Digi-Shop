const crypto = require("crypto");
const authService = require("../services/auth.service");
const { readAuthConfig } = require("../auth/config");

const serializeCookie = (name, value, options) => {
    const pieces = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `SameSite=${options.sameSite}`];
    if (options.httpOnly) pieces.push("HttpOnly");
    if (options.secure) pieces.push("Secure");
    if (options.maxAge !== undefined) pieces.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    return pieces.join("; ");
};

const cookieSettings = () => {
    const config = readAuthConfig();
    return {
        config,
        access: { path: "/", httpOnly: true, sameSite: "Lax", secure: config.secure },
        refresh: { path: "/api/auth/refresh", httpOnly: true, sameSite: "Strict", secure: config.secure },
        csrf: { path: "/", httpOnly: false, sameSite: "Strict", secure: config.secure }
    };
};

const setCookie = (res, name, value, options) => res.append("Set-Cookie", serializeCookie(name, value, options));
const clearCookie = (res, name, options) => setCookie(res, name, "", { ...options, maxAge: 0 });

const setSessionCookies = (res, session) => {
    const settings = cookieSettings();
    const access = session.remembered
        ? { ...settings.access, maxAge: settings.config.accessTtlSeconds }
        : settings.access;
    const refresh = { ...settings.refresh };
    if (session.remembered) refresh.maxAge = Math.floor((new Date(session.refreshExpiresAt).getTime() - Date.now()) / 1000);
    setCookie(res, settings.config.cookieNames.access, session.accessToken, access);
    setCookie(res, settings.config.cookieNames.refresh, session.refreshToken, refresh);
    setCookie(res, settings.config.cookieNames.csrf, session.csrfToken, session.remembered ? { ...settings.csrf, maxAge: refresh.maxAge } : settings.csrf);
};

const clearSessionCookies = (res) => {
    const settings = cookieSettings();
    clearCookie(res, settings.config.cookieNames.access, settings.access);
    clearCookie(res, settings.config.cookieNames.refresh, settings.refresh);
    clearCookie(res, settings.config.cookieNames.csrf, settings.csrf);
};

const SAFE_MESSAGES = new Map([
    ["AUTH_CONFIGURATION", "Authentication is temporarily unavailable"],
    ["INTERNAL_ERROR", "Request failed"],
    ["INVALID_CREDENTIALS", "Invalid credentials"],
    ["EMAIL_UNVERIFIED", "Email verification is required"],
    ["PASSWORD_LOCKED", "Password login is locked"],
    ["GOOGLE_TOKEN_INVALID", "Google credential is invalid"],
    ["GOOGLE_LINK_REQUIRES_PASSWORD", "Password confirmation is required"],
    ["MAIL_UNAVAILABLE", "Email service is unavailable"],
    ["REFRESH_INVALID", "Refresh session is invalid"],
    ["REFRESH_REUSED", "Refresh session reuse detected"],
    ["TOKEN_INVALID", "Verification token is invalid"],
    ["TOKEN_EXPIRED", "Verification token has expired"],
    ["CURRENT_PASSWORD_INVALID", "Current password is invalid"],
    ["VALIDATION_FAILED", "Request validation failed"]
]);

const publicError = (error) => {
    const code = error?.code || "INTERNAL_ERROR";
    return {
        code,
        message: SAFE_MESSAGES.get(code) || "Request failed",
        ...(error?.details && code === "VALIDATION_FAILED" ? { fields: error.details } : {})
    };
};

const sendError = (res, error) => {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(status).json({ success: false, error: publicError(error) });
};

const successUser = (result) => ({ user: result.user });

const register = async (req, res) => {
    try {
        const data = await authService.register(req.body || {});
        return res.status(201).json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

const verifyEmail = async (req, res) => {
    try {
        const data = await authService.verifyEmail(req.body?.token);
        return res.json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

const resendVerification = async (req, res) => {
    try {
        const data = await authService.resendVerification(req.body?.email);
        return res.status(202).json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

const login = async (req, res) => {
    try {
        const result = await authService.loginPassword(req.body || {});
        setSessionCookies(res, result.session);
        return res.json({ success: true, data: successUser(result) });
    } catch (error) {
        return sendError(res, error);
    }
};

const loginGoogle = async (req, res) => {
    try {
        const result = await authService.loginGoogle(req.body || {});
        setSessionCookies(res, result.session);
        return res.json({ success: true, data: successUser(result) });
    } catch (error) {
        return sendError(res, error);
    }
};

const refresh = async (req, res) => {
    try {
        const config = readAuthConfig();
        const result = await authService.refresh(req.cookies?.[config.cookieNames.refresh]);
        setSessionCookies(res, result.session);
        return res.status(204).send();
    } catch (error) {
        clearSessionCookies(res);
        return sendError(res, error);
    }
};

const logout = async (req, res) => {
    try {
        const config = readAuthConfig();
        await authService.logout({ userId: req.user?.id, refreshToken: req.cookies?.[config.cookieNames.refresh] });
    } catch (error) {
        if (error?.code === "AUTH_CONFIGURATION") return sendError(res, error);
    }
    clearSessionCookies(res);
    return res.status(204).send();
};

const session = async (req, res) => {
    try {
        const config = readAuthConfig();
        if (!req.cookies?.[config.cookieNames.csrf]) {
            setCookie(res, config.cookieNames.csrf, crypto.randomBytes(32).toString("base64url"), { path: "/", httpOnly: false, sameSite: "Strict", secure: config.secure });
        }
        return res.json({ success: true, data: { authenticated: Boolean(req.user), ...(req.user ? { user: req.user } : {}) } });
    } catch (error) {
        return sendError(res, error);
    }
};

const recover = async (req, res) => {
    try {
        const data = await authService.recover(req.body?.email);
        return res.status(202).json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

const changePassword = async (req, res) => {
    try {
        const result = await authService.changePassword({
            user: req.user,
            currentPassword: req.body?.currentPassword,
            newPassword: req.body?.newPassword
        });
        setSessionCookies(res, result.session);
        return res.status(204).send();
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = {
    register,
    verifyEmail,
    resendVerification,
    login,
    loginGoogle,
    refresh,
    logout,
    session,
    recover,
    changePassword,
    setSessionCookies,
    clearSessionCookies,
    sendError
};
