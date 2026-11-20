const { randomUUID } = require("node:crypto");
const database = require("../db/prisma");

const POLL_MS = 1500;
const CLEANUP_MS = 10 * 60 * 1000;
const mode = () => process.env.REVIEW_EVENTS_MODE === "direct" ? "direct" : "database";

const createReviewEvents = ({ client = database.getPrismaClient(), origin = randomUUID(), mode: configuredMode } = {}) => {
    let cursor = 0n;
    let initialized = false;
    let polling = false;
    let pollTimer = null;
    let cleanupTimer = null;
    let inFlight = false;
    let onEvent = null;
    let generation = 0;

    const enabled = () => (configuredMode || mode()) === "database";
    const record = async (productId, payload) => {
        if (!enabled()) return;
        try {
            await client.$executeRawUnsafe(
                'INSERT INTO "review_events" ("product_id", "origin", "payload") VALUES ($1, $2, $3::jsonb)',
                productId, origin, JSON.stringify(payload)
            );
        } catch (_) {
            console.error("Review event record failed");
        }
    };

    const poll = async () => {
        if (!polling || inFlight) return;
        const pollGeneration = generation;
        inFlight = true;
        try {
            if (!initialized) {
                const rows = await client.$queryRawUnsafe('SELECT COALESCE(MAX("id"), 0) AS "maxId" FROM "review_events"');
                if (!polling || pollGeneration !== generation) return;
                cursor = BigInt(rows[0].maxId);
                initialized = true;
                return;
            }
            const rows = await client.$queryRawUnsafe(
                'SELECT "id", "product_id" AS "productId", "origin", "payload" FROM "review_events" WHERE "id" > $1 ORDER BY "id" ASC LIMIT 200',
                cursor
            );
            if (!polling || pollGeneration !== generation) return;
            for (const row of rows) {
                const id = BigInt(row.id);
                if (id > cursor) cursor = id;
                if (row.origin === origin) continue;
                onEvent?.(row.productId, row.payload);
            }
        } catch (_) {
            console.error(initialized ? "Review event polling failed" : "Review event polling initialization failed");
        } finally {
            inFlight = false;
        }
    };

    const cleanup = async () => {
        if (!enabled()) return;
        try {
            await client.$executeRawUnsafe('DELETE FROM "review_events" WHERE "created_at" < NOW() - INTERVAL \'1 hour\'');
        } catch (_) {
            console.error("Review event cleanup failed");
        }
    };

    const startPolling = (callback) => {
        if (!enabled() || polling) return;
        polling = true;
        generation += 1;
        cursor = 0n;
        initialized = false;
        onEvent = callback;
        pollTimer = setInterval(poll, POLL_MS);
        pollTimer.unref?.();
        cleanupTimer = setInterval(cleanup, CLEANUP_MS);
        cleanupTimer.unref?.();
        void poll();
    };

    const stopPolling = () => {
        polling = false;
        generation += 1;
        onEvent = null;
        cursor = 0n;
        initialized = false;
        clearInterval(pollTimer);
        clearInterval(cleanupTimer);

        pollTimer = null;
        cleanupTimer = null;
    };
    const isDatabaseMode = () => enabled();

    return { record, startPolling, stopPolling, cleanup, isDatabaseMode, origin };
};

const defaultEvents = createReviewEvents();
module.exports = { ...defaultEvents, createReviewEvents };
