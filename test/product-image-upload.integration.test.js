const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

const storageDirectory = path.join(os.tmpdir(), `digi-shop-product-images-${process.pid}`);
process.env.APP_ORIGIN = "https://catalog.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.PRODUCT_IMAGE_STORAGE_DIR = storageDirectory;

let products;
let audits;
let nextProductId;
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === "object" && "contains" in expected) return String(row[key] ?? "").includes(expected.contains);
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
    auditLog: { create: async ({ data }) => { const row = clone(data); audits.push(row); return row; } }
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
const adminCookie = `__Host-access_token=${accessToken}; __Host-csrf_token=image-upload-csrf`;
const productFields = {
    name: "iPhone 17", brand: "Apple", deviceType: "phone", sku: "IP17-256",
    price: "999", stock: "7", description: "A new phone"
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/eWQAAAAASUVORK5CYII=", "base64");
const upload = async ({ fields = productFields, file = png, filename = "phone.png", type = "image/png", headers = {} } = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    if (file !== null) form.append("image", new Blob([file], { type }), filename);
    return fetch(`${baseUrl}/api/admin/products`, {
        method: "POST",
        headers: { Cookie: adminCookie, Origin: process.env.APP_ORIGIN, "X-CSRF-Token": "image-upload-csrf", ...headers },
        body: form
    });
};
const uploadedNames = async () => (await fs.readdir(storageDirectory)).sort();

before(async () => {
    await fs.mkdir(storageDirectory, { recursive: true });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(storageDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
    products = [];
    audits = [];
    nextProductId = 1;
    await fs.rm(storageDirectory, { recursive: true, force: true });
    await fs.mkdir(storageDirectory, { recursive: true });
});

test("administrator can upload one PNG and retrieve it at the persisted public image path", async () => {
    const response = await upload();
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.match(result.data.image, /^\/uploads\/products\/[a-f0-9-]+\.png$/);
    assert.deepEqual(await fs.readFile(path.join(storageDirectory, path.basename(result.data.image))), png);
    const publicImage = await fetch(`${baseUrl}${result.data.image}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), png);
});

test("PNG images exactly 5 MiB are accepted", async () => {
    const maximumSizePng = Buffer.alloc(5 * 1024 * 1024);
    png.copy(maximumSizePng);
    const response = await upload({ file: maximumSizePng });
    assert.equal(response.status, 201);
    const created = (await response.json()).data;
    assert.equal((await fs.stat(path.join(storageDirectory, path.basename(created.image)))).size, 5 * 1024 * 1024);
});

test("non-PNG, malformed PNG, and oversized files return image field errors without storing bytes", async () => {
    const invalidUploads = [
        { file: Buffer.from("GIF89a"), filename: "phone.gif", type: "image/gif" },
        { file: png, filename: "phone.png", type: "image/jpeg" },
        { file: png, filename: "phone.jpg", type: "image/png" },
        { file: Buffer.from("not a PNG"), filename: "phone.png", type: "image/png" },
        { file: Buffer.alloc(5 * 1024 * 1024 + 1, 1), filename: "large.png", type: "image/png" }
    ];
    for (const invalid of invalidUploads) {
        const response = await upload(invalid);
        assert.equal(response.status, 400);
        const result = await response.json();
        assert.ok(result.errors?.some((error) => error.field === "image"));
        assert.deepEqual(await uploadedNames(), []);
    }
});

test("unauthorized and CSRF-failing uploads are rejected before any file is stored", async () => {
    const unauthorized = await upload({ headers: { Cookie: "__Host-csrf_token=image-upload-csrf" } });
    assert.equal(unauthorized.status, 401);
    const csrfFailure = await upload({ headers: { "X-CSRF-Token": "wrong-token" } });
    assert.equal(csrfFailure.status, 403);
    assert.deepEqual(await uploadedNames(), []);
});

test("editing without a replacement retains the image and a replacement changes its public path", async () => {
    const createdResponse = await upload();
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).data;
    const retainedResponse = await fetch(`${baseUrl}/api/admin/products/${created.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, Origin: process.env.APP_ORIGIN, "X-CSRF-Token": "image-upload-csrf", "Content-Type": "application/json" },
        body: JSON.stringify({ ...productFields, name: "Updated phone", price: 1000, stock: 8 })
    });
    assert.equal(retainedResponse.status, 200);
    assert.equal((await retainedResponse.json()).data.image, created.image);

    const replacement = Buffer.concat([png, Buffer.from("replacement")]);
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...productFields, name: "Replaced phone", price: "1000", stock: "8" })) form.append(key, value);
    form.append("image", new Blob([replacement], { type: "image/png" }), "replacement.png");
    const replaceResponse = await fetch(`${baseUrl}/api/admin/products/${created.id}`, {
        method: "PUT",
        headers: { Cookie: adminCookie, Origin: process.env.APP_ORIGIN, "X-CSRF-Token": "image-upload-csrf" },
        body: form
    });
    assert.equal(replaceResponse.status, 200);
    const updated = (await replaceResponse.json()).data;
    assert.notEqual(updated.image, created.image);
    assert.deepEqual(await fs.readFile(path.join(storageDirectory, path.basename(updated.image))), replacement);
});

test("malformed multipart request does not create a file or product", async () => {
    const response = await fetch(`${baseUrl}/api/admin/products`, {
        method: "POST",
        headers: { Cookie: adminCookie, Origin: process.env.APP_ORIGIN, "X-CSRF-Token": "image-upload-csrf", "Content-Type": "multipart/form-data; boundary=broken" },
        body: "--broken\r\nContent-Disposition: form-data; name=\"image\"; filename=\"broken.png\"\r\n\r\ntruncated"
    });
    assert.ok(response.status >= 400);
    const result = await response.json();
    assert.ok(result.errors?.some((error) => error.field === "image"));
    assert.equal(products.length, 0);
    assert.deepEqual(await uploadedNames(), []);
});
