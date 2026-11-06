const crypto = require("crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const repository = require("../repositories/auth.repository");
const { readAuthConfig } = require("../auth/config");
const { GoogleIdentityVerifier } = require("../auth/google-verifier");
const { NodemailerSmtpMailer } = require("../auth/mailer");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 6;
const VERIFICATION_TTL_MS = 15 * 60 * 1000;
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$YWJjZGVmZ2hpamtsbW5vcA$B5xV7V6J8R3m9Y3s3VQJ8VQ2JmN6nZ8uJfYw2cY5e9k";

class AuthError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.name = "AuthError";
        this.code = code;
        this.statusCode = statusCode;
        if (details) this.details = details;
    }
}

const normalizeEmail = (value) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
const normalizeUsername = (value) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
const hashOpaque = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const userSummary = (user) => user && ({
    id: user.id,
    email: user.email || undefined,
    username: user.username || undefined,
    role: user.role,
    status: user.status,
    forcePasswordChange: Boolean(user.forcePasswordChange)
});
const maskEmail = (email) => {
    const [local, domain] = email.split("@");
    if (!local || !domain) return "***";
    return `${local.slice(0, 1)}***@${domain}`;
};
const validPassword = (password) => typeof password === "string" && password.length >= PASSWORD_MIN_LENGTH && password.length <= 1024;
const isUniqueConflict = (error) => error && error.code === "P2002";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const USERNAME_SEPARATORS_REPEATED = /[._-]{2}/;
const RESERVED_USERNAMES = Object.freeze(["admin", "administrator", "root", "system", "support", "nodeshop"]);
const USERNAME_INVALID_MESSAGE = "Username phải dài 3-30 ký tự, chỉ gồm chữ, số và . _ -, bắt đầu và kết thúc bằng chữ hoặc số, không có hai dấu phân cách liền nhau";
const USERNAME_RESERVED_MESSAGE = "Username này không được phép sử dụng";

// Single shared rule set for every path that assigns a Username. Returns "INVALID", "RESERVED" or null.
const usernameProblem = (value) => {
    if (typeof value !== "string") return "INVALID";
    if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) return "INVALID";
    if (!USERNAME_PATTERN.test(value) || USERNAME_SEPARATORS_REPEATED.test(value)) return "INVALID";
    const squashed = value.toLowerCase().replace(/[._-]/g, "");
    if (RESERVED_USERNAMES.includes(squashed)) return "RESERVED";
    return null;
};
const validUsername = (value) => usernameProblem(value) === null;
const cleanUsername = (value) => typeof value === "string" ? value.trim() : "";
const usernameInvalidError = (value, statusCode) => new AuthError(
    "VALIDATION_FAILED",
    usernameProblem(value) === "RESERVED" ? USERNAME_RESERVED_MESSAGE : USERNAME_INVALID_MESSAGE,
    statusCode,
    { username: true }
);
const usernameTakenError = () => new AuthError("USERNAME_TAKEN", "Username đã được sử dụng", 409, { username: true });

const hashPassword = async (password) => {
    if (!validPassword(password)) throw new AuthError("VALIDATION_FAILED", "Password is invalid", 400);
    return argon2.hash(password, { type: argon2.argon2id });
};

function createAuthService({ authRepository = repository, mailer, googleVerifier } = {}) {
    const getMailer = () => mailer || new NodemailerSmtpMailer();
    const getGoogleVerifier = () => googleVerifier || new GoogleIdentityVerifier();

    const issueSession = async (user, remember = false) => {
        const config = readAuthConfig();
        const now = new Date();
        const refreshToken = randomToken();
        const csrfToken = randomToken();
        const familyId = crypto.randomUUID();
        const refreshExpiresAt = new Date(now.getTime() + (remember ? config.rememberedRefreshTtlSeconds : config.refreshTtlSeconds) * 1000);
        await authRepository.createRefreshSession({
            id: crypto.randomUUID(),
            userId: user.id,
            familyId,
            tokenHash: hashOpaque(refreshToken),
            remembered: Boolean(remember),
            expiresAt: refreshExpiresAt,
            createdAt: now,
            lastUsedAt: now
        });
        const accessToken = jwt.sign({
            sub: user.id,
            role: user.role,
            ver: user.authVersion,
            type: "access",
            jti: randomToken(16)
        }, config.jwtAccessSecret, { expiresIn: config.accessTtlSeconds });
        return { accessToken, refreshToken, csrfToken, refreshExpiresAt, remembered: Boolean(remember) };
    };

    const register = async ({ email, password, username }) => {
        const normalizedEmail = normalizeEmail(email);
        const trimmedUsername = cleanUsername(username);
        if (!EMAIL_PATTERN.test(normalizedEmail) || !validPassword(password) || !validUsername(trimmedUsername)) {
            throw new AuthError("VALIDATION_FAILED", "Email, mật khẩu hoặc username không hợp lệ", 400, {
                email: !EMAIL_PATTERN.test(normalizedEmail),
                password: !validPassword(password),
                username: !validUsername(trimmedUsername)
            });
        }

        const existing = await authRepository.findUserByEmail(normalizedEmail);
        if (existing) {
            if (existing.status === "UNVERIFIED") {
                try {
                    await sendVerification(existing);
                } catch {
                    // Preserve the generic duplicate response; resend remains available.
                }
            }
            return { email: maskEmail(normalizedEmail), verificationRequired: true, duplicate: true };
        }

        // Email duplicates are answered first so the response never reveals whether an email exists via the username error.
        if (await authRepository.findUserByUsername(trimmedUsername)) throw usernameTakenError();

        const passwordHash = await hashPassword(password);
        let user;
        try {
            user = await authRepository.createUser({
                id: crypto.randomUUID(),
                email: normalizedEmail,
                username: trimmedUsername,
                passwordHash,
                role: "user",
                status: "UNVERIFIED",
                failedPasswordAttempts: 0,
                forcePasswordChange: false,
                authVersion: 1
            });
        } catch (error) {
            if (!isUniqueConflict(error)) throw error;
            if (await authRepository.findUserByEmail(normalizedEmail)) {
                return { email: maskEmail(normalizedEmail), verificationRequired: true, duplicate: true };
            }
            throw usernameTakenError();
        }

        let verificationSent = true;
        try {
            await sendVerification(user);
        } catch (error) {
            if (error && error.code === "AUTH_CONFIGURATION") verificationSent = false;
            else if (error && error.code === "MAIL_UNAVAILABLE") verificationSent = false;
            else verificationSent = false;
        }
        return { email: maskEmail(normalizedEmail), verificationRequired: true, verificationSent };
    };

    const sendVerification = async (user) => {
        const rawToken = randomToken();
        const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
        await authRepository.createEmailVerificationToken({
            userId: user.id,
            tokenHash: hashOpaque(rawToken),
            expiresAt
        });
        try {
            await getMailer().sendVerificationEmail({ to: user.email, token: rawToken, expiresAt });
        } catch {
            const error = new AuthError("MAIL_UNAVAILABLE", "Email service is unavailable", 503);
            throw error;
        }
    };

    const verifyEmail = async (token) => {
        if (typeof token !== "string" || token.length < 20 || token.length > 256) {
            throw new AuthError("TOKEN_INVALID", "Verification token is invalid", 400);
        }
        const result = await authRepository.consumeEmailVerificationToken({ tokenHash: hashOpaque(token), now: new Date() });
        if (result.state === "EXPIRED") throw new AuthError("TOKEN_EXPIRED", "Verification token has expired", 410);
        if (result.state !== "VERIFIED") throw new AuthError("TOKEN_INVALID", "Verification token is invalid", 400);
        return { verified: true };
    };

    const resendVerification = async (email) => {
        const normalizedEmail = normalizeEmail(email);
        if (!EMAIL_PATTERN.test(normalizedEmail)) return { accepted: true };
        const user = await authRepository.findUserByEmail(normalizedEmail);
        if (user && user.status === "UNVERIFIED") await sendVerification(user);
        return { accepted: true };
    };

    const loginPassword = async ({ identifier, password, remember = false }) => {
        const normalizedIdentifier = normalizeEmail(identifier);
        const normalizedUsername = normalizeUsername(identifier);
        const user = await authRepository.findUserByIdentifier(normalizedIdentifier || normalizedUsername);
        if (!user || !user.passwordHash) {
            await argon2.verify(DUMMY_HASH, typeof password === "string" ? password : "").catch(() => false);
            throw new AuthError("INVALID_CREDENTIALS", "Invalid credentials", 401);
        }
        if (user.role === "user" && user.passwordLockedAt) {
            throw new AuthError("PASSWORD_LOCKED", "Password login is locked", 423);
        }
        const passwordMatches = await argon2.verify(user.passwordHash, typeof password === "string" ? password : "").catch(() => false);
        if (!passwordMatches) {
            if (user.role === "user") {
                const incremented = await authRepository.incrementFailedPasswordAttempts(user.id);
                if (incremented) {
                    const latest = await authRepository.findUserById(user.id);
                    if (latest && latest.passwordLockedAt) throw new AuthError("PASSWORD_LOCKED", "Password login is locked", 423);
                }
            }
            throw new AuthError("INVALID_CREDENTIALS", "Invalid credentials", 401);
        }
        if (user.role === "user" && user.status !== "ACTIVE") {
            throw new AuthError("EMAIL_UNVERIFIED", "Email verification is required", 403);
        }
        const cleanUser = user.role === "user" ? await authRepository.resetFailedPasswordAttempts(user.id) : user;
        const session = await issueSession(cleanUser, Boolean(remember));
        return { user: userSummary(cleanUser), session };
    };

    const isAuthoritativeEmail = (identity) => {
        const domain = identity.email.split("@")[1];
        return domain === "gmail.com" || (identity.hostedDomain && identity.hostedDomain === domain);
    };

    const loginGoogle = async ({ credential, password, remember = false }) => {
        let identity;
        try {
            identity = await getGoogleVerifier().verifyCredential(credential);
        } catch (error) {
            if (error && error.code === "GOOGLE_TOKEN_INVALID") throw error;
            throw new AuthError("GOOGLE_TOKEN_INVALID", "Google credential is invalid", 401);
        }
        const linked = await authRepository.findOAuthIdentity("google", identity.subject);
        let user = linked && linked.user;
        if (!user) {
            const existing = await authRepository.findUserByEmail(identity.email);
            if (existing) {
                if (!isAuthoritativeEmail(identity)) {
                    if (!validPassword(password) || !existing.passwordHash || !(await argon2.verify(existing.passwordHash, password).catch(() => false))) {
                        throw new AuthError("GOOGLE_LINK_REQUIRES_PASSWORD", "Password confirmation is required", 409);
                    }
                }
                try {
                    await authRepository.createOAuthIdentity({
                        userId: existing.id,
                        provider: "google",
                        providerSubject: identity.subject,
                        emailSnapshot: identity.email
                    });
                } catch (error) {
                    if (!isUniqueConflict(error)) throw error;
                }
                user = isAuthoritativeEmail(identity) && existing.status !== "ACTIVE"
                    ? await authRepository.activateUser(existing.id, new Date())
                    : await authRepository.findUserById(existing.id);
            } else {
                try {
                    user = await authRepository.createUserWithGoogle({
                        user: {
                            id: crypto.randomUUID(),
                            email: identity.email,
                            role: "user",
                            status: "ACTIVE",
                            emailVerifiedAt: new Date(),
                            failedPasswordAttempts: 0,
                            forcePasswordChange: false,
                            authVersion: 1
                        },
                        identity: {
                            id: crypto.randomUUID(),
                            provider: "google",
                            providerSubject: identity.subject,
                            emailSnapshot: identity.email
                        }
                    });
                } catch (error) {
                    if (!isUniqueConflict(error)) throw error;
                    const raced = await authRepository.findOAuthIdentity("google", identity.subject);
                    user = raced && raced.user;
                    if (!user) throw error;
                }
            }
        }
        if (!user || user.status !== "ACTIVE") throw new AuthError("GOOGLE_TOKEN_INVALID", "Google credential is invalid", 401);
        const session = await issueSession(user, Boolean(remember));
        return { user: userSummary(user), session };
    };

    const refresh = async (refreshToken) => {
        if (typeof refreshToken !== "string" || refreshToken.length < 20) throw new AuthError("REFRESH_INVALID", "Refresh session is invalid", 401);
        const config = readAuthConfig();
        const rawToken = randomToken();
        const result = await authRepository.rotateRefreshSession({
            oldTokenHash: hashOpaque(refreshToken),
            newTokenHash: hashOpaque(rawToken),
            now: new Date()
        });
        if (result.state === "REUSED") throw new AuthError("REFRESH_REUSED", "Refresh session reuse detected", 401);
        if (result.state !== "ROTATED") throw new AuthError("REFRESH_INVALID", "Refresh session is invalid", 401);
        const user = result.user;
        if (!user || user.status !== "ACTIVE") throw new AuthError("REFRESH_INVALID", "Refresh session is invalid", 401);
        const accessToken = jwt.sign({
            sub: user.id,
            role: user.role,
            ver: user.authVersion,
            type: "access",
            jti: randomToken(16)
        }, config.jwtAccessSecret, { expiresIn: config.accessTtlSeconds });
        return {
            user: userSummary(user),
            session: {
                accessToken,
                refreshToken: rawToken,
                csrfToken: randomToken(),
                refreshExpiresAt: result.session.expiresAt,
                remembered: result.session.remembered
            }
        };
    };

    const logout = async ({ userId, refreshToken }) => {
        let resolvedUserId = userId;
        if (!resolvedUserId && refreshToken) {
            const session = await authRepository.findRefreshSession(hashOpaque(refreshToken));
            resolvedUserId = session && session.userId;
        }
        if (resolvedUserId) await authRepository.revokeUserSessionsAndIncrementVersion(resolvedUserId);
    };

    const recover = async (email) => {
        const normalizedEmail = normalizeEmail(email);
        if (!EMAIL_PATTERN.test(normalizedEmail)) return { accepted: true };
        const user = await authRepository.findUserByEmail(normalizedEmail);
        if (!user || user.role !== "user" || user.status !== "ACTIVE") return { accepted: true };
        const temporaryPassword = randomToken(18);
        const passwordHash = await hashPassword(temporaryPassword);
        try {
            await getMailer().sendTemporaryPasswordEmail({ to: user.email, temporaryPassword });
        } catch {
            throw new AuthError("MAIL_UNAVAILABLE", "Email service is unavailable", 503);
        }
        const committed = await authRepository.commitRecovery({ userId: user.id, expectedAuthVersion: user.authVersion, passwordHash });
        if (!committed) return { accepted: true, concurrentChange: true };
        return { accepted: true };
    };

    const changePassword = async ({ user, currentPassword, newPassword }) => {
        if (!validPassword(newPassword)) throw new AuthError("VALIDATION_FAILED", "Password is invalid", 400);
        if (!user || !user.id) throw new AuthError("AUTH_REQUIRED", "Authentication is required", 401);
        const current = await authRepository.findUserById(user.id);
        if (!current || !current.passwordHash || !(await argon2.verify(current.passwordHash, typeof currentPassword === "string" ? currentPassword : "").catch(() => false))) {
            throw new AuthError("CURRENT_PASSWORD_INVALID", "Current password is invalid", 400);
        }
        const passwordHash = await hashPassword(newPassword);
        const updated = await authRepository.updatePasswordAndRevoke({
            userId: user.id,
            expectedAuthVersion: current.authVersion,
            passwordHash,
            forcePasswordChange: false
        });
        if (!updated) throw new AuthError("CURRENT_PASSWORD_INVALID", "Password changed concurrently", 409);
        const session = await issueSession(updated, false);
        return { user: userSummary(updated), session };
    };

    const setUsername = async ({ user, username }) => {
        if (!user || !user.id) throw new AuthError("AUTH_REQUIRED", "Authentication is required", 401);
        if (user.role !== "user") throw new AuthError("FORBIDDEN", "You do not have permission for this resource", 403);
        const trimmedUsername = cleanUsername(username);
        if (!validUsername(trimmedUsername)) throw usernameInvalidError(trimmedUsername, 422);
        const current = await authRepository.findUserById(user.id);
        if (!current || current.role !== "user") throw new AuthError("FORBIDDEN", "You do not have permission for this resource", 403);
        if (current.username) throw new AuthError("USERNAME_ALREADY_SET", "Username đã được đặt và không thể thay đổi", 409);
        if (await authRepository.findUserByUsername(trimmedUsername)) throw usernameTakenError();
        let updated;
        try {
            updated = await authRepository.setUsernameIfUnset({ userId: user.id, username: trimmedUsername });
        } catch (error) {
            if (isUniqueConflict(error)) throw usernameTakenError();
            throw error;
        }
        if (!updated) throw new AuthError("USERNAME_ALREADY_SET", "Username đã được đặt và không thể thay đổi", 409);
        return { user: userSummary(updated) };
    };

    return { register, verifyEmail, resendVerification, loginPassword, loginGoogle, refresh, logout, recover, changePassword, setUsername, issueSession };
}

const defaultService = createAuthService();
module.exports = {
    AuthError,
    createAuthService,
    normalizeEmail,
    normalizeUsername,
    hashOpaque,
    hashPassword,
    validPassword,
    userSummary,
    validUsername,
    usernameProblem,
    maskEmail,
    ...defaultService
};
