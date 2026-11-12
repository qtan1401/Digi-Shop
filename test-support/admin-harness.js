// Boots the real Express app on a random port over createAdminFake(state). Call it once at module top level, before
// anything requires src/app. Sessions are real signed access tokens; the fake user table decides who is who.

const jwt = require("jsonwebtoken");
const { createAdminFake } = require("./admin-fake");

process.env.APP_ORIGIN = "https://admin.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";

const startAdminApp = (state) => {
    const db = require("../src/db/prisma");
    const fake = createAdminFake(state);
    db.getPrismaClient = () => fake;
    const app = require("../src/app");

    let server;
    let baseUrl;
    const harness = {
        state,
        async start() {
            server = app.listen(0, "127.0.0.1");
            await new Promise((resolve) => server.once("listening", resolve));
            baseUrl = `http://127.0.0.1:${server.address().port}`;
        },
        async stop() {
            if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        },
        /** who = [id, role] for a session, undefined for anonymous. `body` is JSON-encoded. */
        call(method, path, { as, body, version = 1, csrf = true } = {}) {
            const headers = { Origin: process.env.APP_ORIGIN, "Content-Type": "application/json" };
            const cookies = [];
            if (as) {
                const token = jwt.sign({ type: "access", ver: version, role: as[1] }, process.env.JWT_ACCESS_SECRET, { subject: as[0], expiresIn: "10m" });
                cookies.push(`__Host-access_token=${token}`);
            }
            if (csrf) { cookies.push("__Host-csrf_token=csrf-1"); headers["X-CSRF-Token"] = "csrf-1"; }
            if (cookies.length) headers.Cookie = cookies.join("; ");
            return fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
        },
        async json(method, path, options) {
            const response = await harness.call(method, path, options);
            return { status: response.status, body: await response.json().catch(() => null) };
        }
    };
    return harness;
};

module.exports = { startAdminApp };
