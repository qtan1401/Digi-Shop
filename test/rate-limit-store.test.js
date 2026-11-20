const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createMemoryRateLimitStore } = require("../src/infra/rate-limit-store");

test("first request starts a bucket and later requests share its expiry", async () => {
    const store = createMemoryRateLimitStore();
    const first = await store.hit("login:ip", 60_000);
    const second = await store.hit("login:ip", 60_000);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    assert.equal(second.resetAt, first.resetAt);
});

test("different keys maintain independent counts", async () => {
    const store = createMemoryRateLimitStore();
    assert.equal((await store.hit("one", 60_000)).count, 1);
    assert.equal((await store.hit("two", 60_000)).count, 1);
    assert.equal((await store.hit("one", 60_000)).count, 2);
});

test("expired buckets restart their window", async () => {
    const store = createMemoryRateLimitStore();
    const first = await store.hit("expires", 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const next = await store.hit("expires", 1_000);
    assert.equal(next.count, 1);
    assert.ok(next.resetAt > first.resetAt);
});

test("memory store bounds retained keys at ten thousand", async () => {
    const store = createMemoryRateLimitStore();
    for (let index = 0; index < 10_001; index += 1) await store.hit(`key-${index}`, 60_000);
    assert.equal(store.size, 10_000);
    assert.equal((await store.hit("key-0", 60_000)).count, 1);
});
