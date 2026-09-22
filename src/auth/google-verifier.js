const { OAuth2Client } = require("google-auth-library");
const { readGoogleConfig } = require("./config");

class GoogleIdentityVerifier {
    constructor({ config = readGoogleConfig() } = {}) {
        this.config = config;
        this.client = new OAuth2Client(config.googleClientId);
    }

    async verifyCredential(credential) {
        if (typeof credential !== "string" || credential.length === 0) {
            const error = new Error("Google credential is invalid");
            error.code = "GOOGLE_TOKEN_INVALID";
            error.statusCode = 401;
            throw error;
        }

        let payload;
        try {
            const ticket = await this.client.verifyIdToken({
                idToken: credential,
                audience: this.config.googleClientId
            });
            payload = ticket.getPayload();
        } catch {
            const error = new Error("Google credential is invalid");
            error.code = "GOOGLE_TOKEN_INVALID";
            error.statusCode = 401;
            throw error;
        }

        const issuerValid = payload && (payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com");
        const expiryValid = payload && Number.isFinite(payload.exp) && payload.exp * 1000 > Date.now();
        const audienceValid = payload && payload.aud === this.config.googleClientId;
        const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
        if (!payload || !issuerValid || !expiryValid || !audienceValid || !payload.sub || !email || payload.email_verified !== true) {
            const error = new Error("Google credential is invalid");
            error.code = "GOOGLE_TOKEN_INVALID";
            error.statusCode = 401;
            throw error;
        }

        return Object.freeze({
            subject: String(payload.sub),
            email,
            emailVerified: true,
            hostedDomain: typeof payload.hd === "string" ? payload.hd.toLowerCase() : null
        });
    }
}

module.exports = { GoogleIdentityVerifier };
