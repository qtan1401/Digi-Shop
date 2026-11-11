const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeSeedData } = require("../scripts/db/normalize-seed");

const product = {
    id: 12,
    brand: "Logitech",
    deviceType: "mouse",
    name: "Example mouse",
    slug: "example-mouse",
    image: "/uploads/products/example.png",
    description: "Example product",
    isDeleted: false,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    options: [{ name: "Finish", values: ["Silver"] }],
    variants: [{ sku: "MOUSE-SILVER", price: "100.00", stock: 4, optionValues: { Finish: "Silver" } }]
};

test("seed normalization accepts generic Product options and SKU-addressed variants", () => {
    const normalized = normalizeSeedData({
        products: [product],
        orders: [{
            id: "ORDER-SEED-1",
            subtotal: "100.00",
            shippingFee: "0.00",
            discount: "0.00",
            totalPrice: "100.00",
            customer: { name: "Customer", phone: "123", address: "Address" },
            paymentMethod: "COD",
            orderStatus: "PENDING",
            paymentStatus: "UNPAID",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            items: [{ variantSku: "MOUSE-SILVER", unitPrice: "100.00", quantity: 1, lineTotal: "100.00" }]
        }],
        audits: []
    });

    assert.equal(normalized.products[0].sku, undefined);
    assert.equal(normalized.products[0].variants[0].sku, "MOUSE-SILVER");
    assert.equal(normalized.orders[0].items[0].variantSku, "MOUSE-SILVER");
});

test("seed normalization rejects a brand or device type outside the catalog taxonomy", () => {
    assert.throws(() => normalizeSeedData({ products: [{ ...product, brand: "Google" }], orders: [], audits: [] }), /brand must be one of Apple, Samsung, MSI, Aula, Logitech, Razer, Keychron, Asus/);
    assert.throws(() => normalizeSeedData({ products: [{ ...product, deviceType: "watch" }], orders: [], audits: [] }), /deviceType must be one of laptop, keyboard, mouse, headphone, monitor, storage/);
});
