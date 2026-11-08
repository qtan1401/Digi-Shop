const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
    calculateDiscount, unusableReason, MAX_DISCOUNT_PER_ORDER, MAX_DISCOUNT_PER_VOUCHER, MIN_TOTAL_PRICE
} = require("../src/services/voucher-calculator");

const pct = (id, percent, maxDiscount) => ({ id, code: `P${id}`, type: "PERCENT", percent, maxDiscount });
const ship = (id) => ({ id, code: `S${id}`, type: "FREE_SHIPPING", percent: null, maxDiscount: null });

const cases = [
    { name: "no vouchers", subtotal: 500_000, shippingFee: 100_000, vouchers: [], amounts: [], discount: 0, totalPrice: 600_000 },
    { name: "percent under its cap", subtotal: 200_000, shippingFee: 100_000, vouchers: [pct(1, 10, 50_000)], amounts: [20_000], discount: 20_000, totalPrice: 280_000 },
    { name: "percent over its cap", subtotal: 2_000_000, shippingFee: 100_000, vouchers: [pct(1, 10, 50_000)], amounts: [50_000], discount: 50_000, totalPrice: 2_050_000 },
    { name: "rounds down to whole VND", subtotal: 12_345, shippingFee: 100_000, vouchers: [pct(1, 15, 500_000)], amounts: [1_851], discount: 1_851, totalPrice: 110_494 },
    { name: "percent 100 with cap", subtotal: 3_000_000, shippingFee: 100_000, vouchers: [pct(1, 100, 500_000)], amounts: [500_000], discount: 500_000, totalPrice: 2_600_000 },
    { name: "percent above 100 is treated as 100", subtotal: 100_000, shippingFee: 0, vouchers: [pct(1, 250, 500_000)], amounts: [99_000], discount: 99_000, totalPrice: 1_000 },
    { name: "Discount larger than the cart is capped by subtotal (then the floor)", subtotal: 200_000, shippingFee: 100_000, vouchers: [pct(1, 100, 500_000)], amounts: [200_000], discount: 200_000, totalPrice: 100_000 },
    { name: "free shipping equals the shipping fee", subtotal: 200_000, shippingFee: 100_000, vouchers: [ship(1)], amounts: [100_000], discount: 100_000, totalPrice: 200_000 },
    { name: "free shipping with zero shipping fee", subtotal: 200_000, shippingFee: 0, vouchers: [ship(1)], amounts: [0], discount: 0, totalPrice: 200_000 },
    { name: "free shipping plus percent", subtotal: 300_000, shippingFee: 100_000, vouchers: [pct(1, 10, 50_000), ship(2)], amounts: [30_000, 100_000], discount: 130_000, totalPrice: 270_000 },
    { name: "percent vouchers all use the original subtotal", subtotal: 1_000_000, shippingFee: 100_000, vouchers: [pct(1, 10, 500_000), pct(2, 10, 500_000)], amounts: [100_000, 100_000], discount: 200_000, totalPrice: 900_000 },
    {
        name: "goods Discount never exceeds subtotal: reduced from the last voucher",
        subtotal: 100_000, shippingFee: 100_000, vouchers: [pct(1, 70, 500_000), pct(2, 70, 500_000)],
        amounts: [70_000, 30_000], discount: 100_000, totalPrice: 100_000
    },
    {
        name: "three 500,000 vouchers on a rich cart hit the 1,000,000 order cap, reducing the last",
        subtotal: 10_000_000, shippingFee: 100_000, vouchers: [pct(1, 50, 500_000), pct(2, 50, 500_000), pct(3, 50, 500_000)],
        amounts: [500_000, 500_000, 0], discount: 1_000_000, totalPrice: 9_100_000
    },
    {
        name: "three 500,000 vouchers on a cheap cart: the goods cap (subtotal) binds, later vouchers get nothing",
        subtotal: 300_000, shippingFee: 100_000, vouchers: [pct(1, 100, 500_000), pct(2, 100, 500_000), pct(3, 100, 500_000)],
        amounts: [300_000, 0, 0], discount: 300_000, totalPrice: 100_000
    },
    {
        name: "three 500,000 vouchers where the 1,000 floor binds after the goods cap",
        subtotal: 100_000, shippingFee: 0, vouchers: [pct(1, 100, 500_000), pct(2, 100, 500_000), pct(3, 100, 500_000)],
        amounts: [99_000, 0, 0], discount: 99_000, totalPrice: 1_000
    },
    { name: "cart so cheap the total would fall below 1,000", subtotal: 1_000, shippingFee: 0, vouchers: [pct(1, 100, 500_000)], amounts: [0], discount: 0, totalPrice: 1_000 },
    { name: "cart already below the floor is left alone", subtotal: 500, shippingFee: 0, vouchers: [pct(1, 50, 500_000)], amounts: [0], discount: 0, totalPrice: 500 },
    { name: "zero subtotal, free shipping reduced to keep 1,000 payable", subtotal: 0, shippingFee: 100_000, vouchers: [ship(1)], amounts: [99_000], discount: 99_000, totalPrice: 1_000 }
];

for (const { name, subtotal, shippingFee, vouchers, amounts, discount, totalPrice } of cases) {
    test(`calculateDiscount: ${name}`, () => {
        const result = calculateDiscount({ subtotal, shippingFee, vouchers });
        assert.deepEqual(result.lines, vouchers.map((voucher, index) => ({ voucherId: voucher.id, amount: amounts[index] })));
        assert.equal(result.discount, discount);
        assert.equal(result.totalPrice, totalPrice);
    });
}

test("calculateDiscount rejects duplicates, more than three vouchers and two free-shipping vouchers", () => {
    const input = (vouchers) => ({ subtotal: 1_000_000, shippingFee: 100_000, vouchers });
    assert.throws(() => calculateDiscount(input([pct(1, 10, 50_000), pct(1, 10, 50_000)])), { code: "VOUCHER_DUPLICATE" });
    assert.throws(() => calculateDiscount(input([pct(1, 10, 50_000), { ...pct(2, 10, 50_000), id: undefined, code: "P1" }, pct(3, 1, 1_000)].slice(0, 2).concat([{ ...pct(9, 1, 1_000), id: undefined, code: "P1" }]))), { code: "VOUCHER_DUPLICATE" });
    assert.throws(() => calculateDiscount(input([pct(1, 1, 1_000), pct(2, 1, 1_000), pct(3, 1, 1_000), pct(4, 1, 1_000)])), { code: "VOUCHER_LIMIT_EXCEEDED", statusCode: 422 });
    assert.throws(() => calculateDiscount(input([ship(1), ship(2)])), { code: "VOUCHER_FREE_SHIPPING_LIMIT", statusCode: 422 });
});

test("calculateDiscount refuses non-integer or negative money", () => {
    for (const [subtotal, shippingFee] of [[-1, 0], [1.5, 0], [0, -5], [Number.NaN, 0], [10, undefined]]) {
        assert.throws(() => calculateDiscount({ subtotal, shippingFee, vouchers: [] }), TypeError);
    }
});

test("the total Discount does not depend on voucher order", () => {
    const pool = [pct(1, 70, 400_000), pct(2, 40, 300_000), ship(3)];
    const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const [subtotal, shippingFee] of [[100_000, 100_000], [300_000, 100_000], [1_000_000, 100_000], [50_000, 100_000], [10_000_000, 0]]) {
        const totals = new Set(permutations.map((order) =>
            calculateDiscount({ subtotal, shippingFee, vouchers: order.map((index) => pool[index]) }).discount));
        assert.equal(totals.size, 1, `subtotal ${subtotal}`);
    }
});

test("unusableReason: disabled, not started, expired, exhausted, and inclusive boundaries", () => {
    const start = new Date("2030-01-01T00:00:00.000Z");
    const end = new Date("2030-01-02T00:00:00.000Z");
    const base = { code: "ABC12", isEnabled: true, startsAt: start, endsAt: end, quantity: 2, redeemedCount: 1 };
    assert.equal(unusableReason(base, start), null);
    assert.equal(unusableReason(base, end), null);
    assert.equal(unusableReason(base, new Date(start.getTime() - 1)).reason, "NOT_STARTED");
    assert.equal(unusableReason(base, new Date(end.getTime() + 1)).reason, "EXPIRED");
    assert.equal(unusableReason({ ...base, isEnabled: false }, start).reason, "DISABLED");
    assert.equal(unusableReason({ ...base, redeemedCount: 2 }, start).reason, "EXHAUSTED");
    assert.match(unusableReason({ ...base, redeemedCount: 2 }, start).message, /ABC12/);
    // Codes from before the 5-character rule are never redeemable, whatever else is true of them.
    for (const code of ["WELCOME10", "FREESHIP", "ABCD", "AB-12", ""]) {
        assert.equal(unusableReason({ ...base, code }, start).reason, "NOT_FOUND", code);
    }
    assert.equal(unusableReason({ ...base, code: "abc12" }, start), null, "stored case does not matter");
});

test("property: invariants hold over many random carts and voucher sets", () => {
    let seed = 20261105;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
    const int = (min, max) => min + Math.floor(random() * (max - min + 1));

    for (let round = 0; round < 20_000; round += 1) {
        const subtotal = random() < 0.2 ? int(0, 5_000) : int(0, 30_000_000);
        const shippingFee = random() < 0.5 ? 100_000 : int(0, 200_000);
        const count = int(0, 3);
        const vouchers = [];
        let hasShip = false;
        for (let index = 0; index < count; index += 1) {
            if (!hasShip && random() < 0.35) {
                hasShip = true;
                vouchers.push(ship(index + 1));
            } else {
                vouchers.push(pct(index + 1, int(1, 100), int(1_000, MAX_DISCOUNT_PER_VOUCHER)));
            }
        }
        const result = calculateDiscount({ subtotal, shippingFee, vouchers });
        const payable = subtotal + shippingFee;
        assert.ok(Number.isInteger(result.discount) && result.discount >= 0 && result.discount <= MAX_DISCOUNT_PER_ORDER);
        assert.equal(result.totalPrice, payable - result.discount);
        assert.ok(result.totalPrice >= 0);
        if (payable >= MIN_TOTAL_PRICE) assert.ok(result.totalPrice >= MIN_TOTAL_PRICE);
        assert.equal(result.lines.reduce((sum, line) => sum + line.amount, 0), result.discount);
        result.lines.forEach((line, index) => {
            const voucher = vouchers[index];
            const cap = voucher.type === "FREE_SHIPPING" ? shippingFee : Math.min(voucher.maxDiscount, MAX_DISCOUNT_PER_VOUCHER, subtotal);
            assert.ok(Number.isInteger(line.amount) && line.amount >= 0 && line.amount <= cap);
        });
        const goods = result.lines.reduce((sum, line, index) => vouchers[index].type === "PERCENT" ? sum + line.amount : sum, 0);
        assert.ok(goods <= subtotal);
    }
});
