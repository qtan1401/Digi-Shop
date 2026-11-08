// ===== GUEST ACCOUNT =====
// Guest checkout attaches the Order to the customer account of the typed email, creating a password-less one when there
// is none. Nothing here signs anybody in or tells the caller whether the account already existed beyond the internal
// `created` flag (used only to decide whether to send the account email).

const crypto = require("node:crypto");
const authRepository = require("../repositories/auth.repository");
const { normalizeEmail, isEmailAddress, isUniqueConflict, FULL_NAME_MAX_LENGTH } = require("./auth.service");
const { NodemailerSmtpMailer } = require("../auth/mailer");

class GuestCheckoutError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "GuestCheckoutError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

/** Validates the guest-specific part of a request body and returns the normalised email. */
const parseGuestRequest = (body) => {
    const email = normalizeEmail(body?.email);
    if (!isEmailAddress(email)) {
        throw new GuestCheckoutError("GUEST_EMAIL_INVALID", "Email không hợp lệ, vui lòng kiểm tra lại.");
    }
    // Points belong to an account; a guest is never signed in, so they cannot be spent.
    if (body.pointsToUse !== undefined && body.pointsToUse !== null) {
        throw new GuestCheckoutError("GUEST_POINTS_NOT_ALLOWED", "Khách chưa đăng nhập không thể dùng điểm tích lũy.");
    }
    return email;
};

const ownerOf = (user, created) => ({
    // An administrator's email is not a customer account: the Order stays unattached.
    userId: user.role === "user" ? user.id : null,
    created
});

// An account left behind by a checkout that failed (no password, never ordered) has not had its welcome mail yet.
const isUnusedGuestAccount = (user) => user.role === "user" && user.status === "UNVERIFIED" && !user.passwordHash;

/**
 * Find the customer account for a normalised email or create a password-less one (UNVERIFIED: the mailbox is proven
 * later through the recover flow). Race-safe: users_email_unique rejects the second INSERT (P2002), and the loser
 * re-reads the winner's row. Returns { userId | null, created }.
 */
const resolveBuyer = async ({ email, fullName }, repository = authRepository) => {
    const existing = await repository.findUserByEmail(email);
    if (existing) {
        const unused = isUnusedGuestAccount(existing) && await repository.countOrdersByUser(existing.id) === 0;
        return ownerOf(existing, unused);
    }
    const name = typeof fullName === "string" ? fullName.trim().replace(/\s+/g, " ").slice(0, FULL_NAME_MAX_LENGTH) : "";
    try {
        const user = await repository.createUser({
            id: crypto.randomUUID(),
            email,
            fullName: name || null,
            role: "user",
            status: "UNVERIFIED",
            failedPasswordAttempts: 0,
            forcePasswordChange: false,
            authVersion: 1
        });
        return ownerOf(user, true);
    } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const winner = await repository.findUserByEmail(email);
        if (!winner) throw error;
        return ownerOf(winner, false);
    }
};

// Created on first use and reused; a failed construction is not cached, so the next email tries again.
let defaultMailer;
const getDefaultMailer = () => {
    if (!defaultMailer) defaultMailer = new NodemailerSmtpMailer();
    return defaultMailer;
};

/** Tells a newly created account's owner that it exists and how to set a password. Never rejects. */
const sendAccountEmail = async (email, { mailer, logger = console } = {}) => {
    try {
        await (mailer || getDefaultMailer()).sendGuestAccountEmail({ to: email });
        return true;
    } catch (error) {
        logger.error("Guest account email failed:", error?.message || error);
        return false;
    }
};

module.exports = { GuestCheckoutError, parseGuestRequest, resolveBuyer, sendAccountEmail };
