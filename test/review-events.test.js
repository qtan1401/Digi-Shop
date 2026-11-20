const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createReviewEvents } = require("../src/realtime/review-events");

test("review polling waits for a successful max-id cursor before reading events", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    let maxReads = 0;
    const eventCursors = [];
    const client = {
        async $queryRawUnsafe(sql, cursor) {
            if (sql.includes("MAX(")) {
                maxReads += 1;
                if (maxReads === 1) throw new Error("temporary database failure");
                return [{ maxId: 42n }];
            }
            eventCursors.push(cursor);
            return [];
        }
    };
    const events = createReviewEvents({ client, origin: "instance-a", mode: "database" });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    events.startPolling(() => {});
    await flush();
    assert.equal(maxReads, 1);
    assert.deepEqual(eventCursors, []);

    t.mock.timers.tick(1500);
    await flush();
    assert.equal(maxReads, 2, "retries cursor initialization after a failure");
    assert.deepEqual(eventCursors, [], "does not fetch historical rows on the retry");

    t.mock.timers.tick(1500);
    await flush();
    assert.deepEqual(eventCursors, [42n], "event polling starts after the max-id cursor is established");
    events.stopPolling();
});
