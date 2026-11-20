const express = require("express");
const database = require("../db/prisma");
const { instanceId } = require("../infra/instance");

const DB_CHECK_TIMEOUT_MS = 2000;
const router = express.Router();

const databaseIsReachable = async () => {
    let timeout;
    try {
        await Promise.race([
            database.getPrismaClient().$queryRaw`SELECT 1`,
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error("Database health check timed out")), DB_CHECK_TIMEOUT_MS);
            })
        ]);
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
};

router.get("/healthz", async (_req, res) => {
    const healthy = await databaseIsReachable();
    return res.status(healthy ? 200 : 503).json({
        status: healthy ? "ok" : "error",
        db: healthy ? "ok" : "down",
        instance: instanceId
    });
});

module.exports = router;
