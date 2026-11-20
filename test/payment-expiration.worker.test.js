const assert = require("node:assert/strict");
const { test } = require("node:test");
const { startPaymentExpirationWorker } = require("../src/services/payment-expiration.worker");

const withFakeInterval = async (run) => {
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    let scheduled;
    let cleared;
    global.setInterval = (callback, delay) => {
        scheduled = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true; } };
        return scheduled;
    };
    global.clearInterval = (timer) => { cleared = timer; };
    try {
        await run(() => scheduled, () => cleared);
    } finally {
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    }
};

test("one worker does not overlap a scheduled expiry sweep and waits for it during shutdown", async () => {
    await withFakeInterval(async (timer, cleared) => {
        let finishSweep;
        let calls = 0;
        const stop = startPaymentExpirationWorker({
            expire: () => {
                calls += 1;
                return new Promise((resolve) => { finishSweep = resolve; });
            },
            logger: { error() {} }
        });

        assert.equal(calls, 1);
        assert.equal(timer().delay, 10_000);
        assert.equal(timer().unrefCalled, true);
        timer().callback();
        assert.equal(calls, 1);

        let stopped = false;
        const stopping = stop().then(() => { stopped = true; });
        await Promise.resolve();
        assert.equal(stopped, false);
        finishSweep();
        await stopping;
        assert.equal(stopped, true);
        assert.equal(cleared(), timer());
    });
});

test("one worker starts the next expiry sweep after the current sweep settles", async () => {
    await withFakeInterval(async (timer) => {
        const finish = [];
        let calls = 0;
        const stop = startPaymentExpirationWorker({
            expire: () => {
                calls += 1;
                return new Promise((resolve) => finish.push(resolve));
            },
            logger: { error() {} }
        });

        timer().callback();
        assert.equal(calls, 1);
        finish.shift()();
        await Promise.resolve();
        timer().callback();
        assert.equal(calls, 2);
        finish.shift()();
        await stop();
    });
});
