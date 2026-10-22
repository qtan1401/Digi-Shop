const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeSeedData } = require("../scripts/db/normalize-seed");

const product = {
    id: 12,
    brand: "Apple",
    deviceType: "phone",
    name: "Example phone",
    slug: "example-phone",
    image: "/uploads/products/example.png",
    description: "Example product",
    isDeleted: false,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    options: [{ name: "Finish", values: ["Silver"] }],
    variants: [{ sku: "PHONE-SILVER", price: "100.00", stock: 4, optionValues: { Finish: "Silver" } }]
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
            items: [{ variantSku: "PHONE-SILVER", unitPrice: "100.00", quantity: 1, lineTotal: "100.00" }]
        }],
        audits: []
    });

    assert.equal(normalized.products[0].sku, undefined);
    assert.equal(normalized.products[0].variants[0].sku, "PHONE-SILVER");
    assert.equal(normalized.orders[0].items[0].variantSku, "PHONE-SILVER");
});
