const nodemailer = require("nodemailer");
const { readMailerConfig } = require("./config");

class NodemailerSmtpMailer {
    constructor({ config = readMailerConfig(), transport } = {}) {
        this.config = config;
        this.transport = transport || nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: { user: config.smtp.user, pass: config.smtp.password }
        });
    }

    async sendVerificationEmail({ to, token, expiresAt }) {
        const url = new URL("/verify-email", this.config.appOrigins[0]);
        url.searchParams.set("token", token);
        await this.transport.sendMail({
            from: this.config.mailFrom,
            to,
            subject: "Verify your Digi-Shop email",
            text: `Verify your email before ${new Date(expiresAt).toISOString()} by opening: ${url.toString()}`
        });
    }

    async sendTemporaryPasswordEmail({ to, temporaryPassword }) {
        await this.transport.sendMail({
            from: this.config.mailFrom,
            to,
            subject: "Your Digi-Shop temporary password",
            text: `Use this temporary password to sign in, then change it immediately: ${temporaryPassword}`
        });
    }
}

module.exports = { NodemailerSmtpMailer };
