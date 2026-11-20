const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 1000;

function createMemoryRateLimitStore() {
    const buckets = new Map();
    return {
        get size() { return buckets.size; },
        async hit(key, windowMs) {
            const now = Date.now();
            for (const [existingKey, bucket] of buckets) {
                if (bucket.expiresAt <= now) buckets.delete(existingKey);
            }
            while (buckets.size >= 10_000 && !buckets.has(key)) {
                const oldest = buckets.keys().next().value;
                if (oldest === undefined) break;
                buckets.delete(oldest);
            }
            const current = buckets.get(key);
            if (current && current.expiresAt > now) {
                current.count += 1;
            } else {
                buckets.set(key, { count: 1, expiresAt: now + windowMs });
            }
            const result = buckets.get(key);
            return { count: result.count, resetAt: result.expiresAt };
        }
    };
}

function createDatabaseRateLimitStore(client, { logger = console } = {}) {
    let cleanupRunning = false;
    const cleanup = async () => {
        if (cleanupRunning) return;
        cleanupRunning = true;
        try {
            await client.$executeRaw`
                WITH expired AS (
                    SELECT key FROM rate_limit_buckets
                    WHERE expires_at <= now()
                    ORDER BY expires_at
                    LIMIT ${CLEANUP_BATCH_SIZE}
                )
                DELETE FROM rate_limit_buckets bucket
                USING expired
                WHERE bucket.key = expired.key
            `;
        } catch {
            logger.warn("Rate limit bucket cleanup failed");
        } finally {
            cleanupRunning = false;
        }
    };
    const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();

    return {
        async hit(key, windowMs) {
            try {
                const [row] = await client.$queryRaw`
                    INSERT INTO rate_limit_buckets (key, count, expires_at)
                    VALUES (${key}, 1, now() + (${windowMs} * interval '1 millisecond'))
                    ON CONFLICT (key) DO UPDATE SET
                        count = CASE WHEN rate_limit_buckets.expires_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
                        expires_at = CASE WHEN rate_limit_buckets.expires_at <= now()
                            THEN now() + (${windowMs} * interval '1 millisecond')
                            ELSE rate_limit_buckets.expires_at END
                    RETURNING count, expires_at
                `;
                return { count: row.count, resetAt: row.expires_at.getTime() };
            } catch {
                // Rate limiting must not turn a database outage into an authentication outage; fail open without exposing bucket keys.
                logger.warn("Database rate limit unavailable; allowing request");
                return null;
            }
        },
        close() { clearInterval(cleanupTimer); }
    };
}

function createRateLimitStore() {
    if (process.env.RATE_LIMIT_STORE !== "memory") {
        return createDatabaseRateLimitStore(require("../db/prisma").getPrismaClient());
    }
    return createMemoryRateLimitStore();
}

module.exports = { createMemoryRateLimitStore, createDatabaseRateLimitStore, createRateLimitStore };
