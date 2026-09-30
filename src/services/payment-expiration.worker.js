const { expireDueAttempts } = require("../repositories/payment.repository");

const startPaymentExpirationWorker = ({ intervalMs = 10_000, expire = expireDueAttempts, logger = console } = {}) => {
    let running = false;
    let timer;
    let currentRun = Promise.resolve();

    const run = async () => {
        if (running) return currentRun;
        running = true;
        currentRun = (async () => {
            try {
                await expire();
            } catch (error) {
                logger.error?.(`Payment expiry sweep failed (${error?.code || error?.name || "unknown"}).`);
            } finally {
                running = false;
            }
        })();
        return currentRun;
    };

    void run();
    timer = setInterval(() => { void run(); }, intervalMs);
    timer.unref?.();

    return async () => {
        clearInterval(timer);
        await currentRun;
    };
};

module.exports = { startPaymentExpirationWorker };
