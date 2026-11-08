// ===== GUEST ORDER ACCESS TOKEN =====
// A guest has no session, so the checkout response hands out one random token per Order. Only its SHA-256 is stored
// (Order.guestAccessTokenHash); whoever presents the token may read and retry that Order's payment attempts.
// The token travels in the GUEST_TOKEN_HEADER request header, never in a URL.

const crypto = require("node:crypto");

const GUEST_TOKEN_HEADER = "x-guest-order-token";
const MAX_TOKEN_LENGTH = 200;

const hashToken = (token) => crypto.createHash("sha256").update(String(token), "utf8").digest("hex");

/** A fresh token and the hash to store for it. */
const issueToken = () => {
    const token = crypto.randomBytes(32).toString("base64url");
    return { token, hash: hashToken(token) };
};

/** Constant-time check of a presented token against a stored hash. Anything malformed or missing is a mismatch. */
const tokenMatches = (token, storedHash) => {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
    if (typeof storedHash !== "string" || storedHash.length === 0) return false;
    const presented = Buffer.from(hashToken(token), "utf8");
    const stored = Buffer.from(storedHash, "utf8");
    return presented.length === stored.length && crypto.timingSafeEqual(presented, stored);
};

/** The presented token from a request, or undefined. */
const tokenFromRequest = (req) => {
    const value = req?.headers?.[GUEST_TOKEN_HEADER];
    return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH ? value : undefined;
};

module.exports = { GUEST_TOKEN_HEADER, hashToken, issueToken, tokenMatches, tokenFromRequest };
