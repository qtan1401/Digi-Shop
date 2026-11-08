const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { includedVat } = require("../src/services/vat");

// Catalogue prices include 10% VAT: the shown amount is round(subtotal * 10 / 110), and totals never change.
test("included VAT is round(subtotal * 10 / 110)", () => {
    assert.equal(includedVat(1_100_000), 100_000);
    assert.equal(includedVat(200_000), 18_182); // 18,181.8...
    assert.equal(includedVat(21_000_000), 1_909_091); // 1,909,090.9...
    assert.equal(includedVat(0), 0);
});

test("the storefront helper (public/js/vat.js) computes the same amounts as the server helper", () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "js", "vat.js"), "utf8"), { window });
    assert.equal(window.DigiVat.label, "Đã bao gồm VAT 10%");
    for (const subtotal of [0, 1, 5, 99_999, 200_000, 1_100_000, 21_000_000, 75_299_000]) {
        assert.equal(window.DigiVat.includedVat(subtotal), includedVat(subtotal), `subtotal ${subtotal}`);
    }
});
