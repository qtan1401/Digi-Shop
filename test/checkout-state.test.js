const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/js/checkout-state.js"), "utf8");

const checkoutState = () => {
    const stored = new Map();
    const window = {
        location: { origin: "http://localhost:3100" },
        sessionStorage: {
            getItem: (key) => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, value),
            removeItem: (key) => stored.delete(key)
        }
    };
    vm.runInNewContext(source, { window, URL, Date });
    return { state: window.DigiCheckoutState, stored };
};

test("checkout draft retains a valid step through save and reload", () => {
    const { state } = checkoutState();
    const draft = state.saveDraft({ mode: "cart", returnPath: "/checkouts.html?source=cart", cartSnapshot: [], step: 2 });
    assert.equal(draft.step, 2);
    assert.equal(state.readDraft().step, 2);
    assert.equal(state.DRAFT_VERSION, 2);
});

test("checkout draft falls back to shipping for absent or invalid steps", () => {
    const { state, stored } = checkoutState();
    const original = state.saveDraft({ mode: "cart", returnPath: "/checkouts.html?source=cart", cartSnapshot: [] });
    const cases = [undefined, -1, 3, 1.5, "2", null];
    for (const step of cases) {
        const legacy = { ...original };
        if (step !== undefined) legacy.step = step;
        else delete legacy.step;
        stored.set(state.DRAFT_KEY, JSON.stringify(legacy));
        assert.equal(state.readDraft().step, 0, `invalid or legacy step ${String(step)}`);
    }
});

test("guest checkout draft keeps the email needed to resume payment", () => {
    const { state } = checkoutState();
    state.saveDraft({
        mode: "buy-now", productId: 405, variantId: 159,
        returnPath: "/checkouts.html?id=405&variantId=159",
        cartSnapshot: [], step: 1, form: { email: "guest@example.test" }
    });
    assert.equal(state.readDraft().form.email, "guest@example.test");
    assert.equal(state.readDraft().step, 1);
});
