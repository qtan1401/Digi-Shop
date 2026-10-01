const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const PNG = require("pngjs").PNG;
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://catalog.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.PRODUCT_IMAGE_STORAGE_DIR = path.join(os.tmpdir(), `digi-shop-taxonomy-images-${process.pid}`);

let products;
let audits;
let nextProductId;

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === "object" && "contains" in expected) {
        return String(row[key] ?? "").includes(expected.contains);
    }
    return row[key] === expected;
});

const fakePrisma = {
    product: {
        findMany: async ({ where = {}, orderBy } = {}) => {
            const rows = products.filter((row) => matches(row, where)).map(clone);
            if (orderBy?.id === "asc") rows.sort((a, b) => a.id - b.id);
            return rows;
        },
        findUnique: async ({ where }) => clone(products.find((row) => matches(row, where)) || null),
        create: async ({ data }) => {
            const row = { id: nextProductId++, ...clone(data) };
            products.push(row);
            return clone(row);
        },
        updateMany: async ({ where, data }) => {
            const row = products.find((candidate) => matches(candidate, where));
            if (!row) return { count: 0 };
            Object.assign(row, clone(data));
            return { count: 1 };
        }
    },
    user: {
        findUnique: async ({ where }) => where.id === "catalog-admin"
            ? { id: "catalog-admin", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false }
            : null
    },
    auditLog: {
        create: async ({ data }) => {
            const row = clone(data);
            audits.push(row);
            return row;
        }
    }
};

const db = require("../src/db/prisma");
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

let server;
let baseUrl;
const accessToken = jwt.sign(
    { type: "access", ver: 1, role: "admin" },
    process.env.JWT_ACCESS_SECRET,
    { subject: "catalog-admin", expiresIn: "10m" }
);
const productInput = (overrides = {}) => ({
    name: "iPhone 17",
    brand: "Apple",
    deviceType: "phone",
    sku: "IP17-256",
    price: 999,
    stock: 7,
    image: "https://catalog.example.test/iphone.png",
    description: "A new phone",
    ...overrides
});

const productPng = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) });

const createProduct = (input) => {
    const body = new FormData();
    for (const [field, value] of Object.entries(input)) {
        if (field !== "image" && value !== undefined && value !== null) body.append(field, String(value));
    }
    body.append("image", new Blob([productPng], { type: "image/png" }), "product.png");
    return fetch(`${baseUrl}/api/admin/products`, {
        method: "POST",
        headers: {
            Cookie: `__Host-access_token=${accessToken}; __Host-csrf_token=catalog-csrf`,
            Origin: process.env.APP_ORIGIN,
            "X-CSRF-Token": "catalog-csrf"
        },
        body
    });
};
const adminHeaders = {
    Cookie: `__Host-access_token=${accessToken}; __Host-csrf_token=catalog-csrf`,
    Origin: process.env.APP_ORIGIN,
    "Content-Type": "application/json",
    "X-CSRF-Token": "catalog-csrf"
};

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(process.env.PRODUCT_IMAGE_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
    products = [];
    audits = [];
    nextProductId = 1;
});

test("admin creates supported taxonomy and public listing returns both fields", async () => {
    const created = await createProduct(productInput());
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(createdPayload.data.brand, "Apple");
    assert.equal(createdPayload.data.deviceType, "phone");

    const response = await fetch(`${baseUrl}/api/products`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(
        { brand: payload.data[0].brand, deviceType: payload.data[0].deviceType },
        { brand: "Apple", deviceType: "phone" }
    );
});

test("product create reports missing and unsupported taxonomy with field errors", async () => {
    for (const [input, field] of [
        [productInput({ brand: "Google" }), "brand"],
        [productInput({ deviceType: "watch" }), "deviceType"],
        [productInput({ brand: undefined }), "brand"],
        [productInput({ deviceType: undefined }), "deviceType"]
    ]) {
        const response = await createProduct(input);
        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.ok(payload.errors.some((error) => error.field === field));
    }
    products = [{
        id: 1, ...productInput(), slug: "iphone-17", isDeleted: false,
        deletedAt: null, createdAt: new Date(), updatedAt: new Date()
    }];
    for (const [changes, field] of [
        [{ brand: "Google" }, "brand"],
        [{ deviceType: "watch" }, "deviceType"],
        [{ brand: null }, "brand"],
        [{ deviceType: null }, "deviceType"]
    ]) {
        const response = await fetch(`${baseUrl}/api/admin/products/1`, {
            method: "PUT", headers: adminHeaders, body: JSON.stringify(changes)
        });
        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.ok(payload.errors.some((error) => error.field === field));
    }
});

test("product update accepts a different supported brand and device type", async () => {
    products = [{
        id: 1, ...productInput(), slug: "iphone-17", isDeleted: false,
        deletedAt: null, createdAt: new Date(), updatedAt: new Date()
    }];
    const response = await fetch(`${baseUrl}/api/admin/products/1`, {
        method: "PUT", headers: adminHeaders,
        body: JSON.stringify({ brand: "MSI", deviceType: "laptop" })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.brand, "MSI");
    assert.equal(payload.data.deviceType, "laptop");
});

test("the remaining supported Samsung and tablet values persist through HTTP", async () => {
    const response = await createProduct(productInput({
        name: "Samsung Galaxy Tab",
        brand: "Samsung",
        deviceType: "tablet",
        sku: "SG-TAB-1"
    }));
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.deepEqual(
        { brand: payload.data.brand, deviceType: payload.data.deviceType },
        { brand: "Samsung", deviceType: "tablet" }
    );
});

test("legacy category APIs are no longer mounted", async () => {
    const publicResponse = await fetch(`${baseUrl}/api/categories`);
    assert.equal(publicResponse.status, 404);
    const adminResponse = await fetch(`${baseUrl}/api/admin/categories`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ name: "Phones" })
    });
    assert.equal(adminResponse.status, 404);
});
