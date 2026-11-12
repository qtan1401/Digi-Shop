const assert = require("node:assert/strict");
const PNG = require("pngjs").PNG;
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { after, before, beforeEach, test } = require("node:test");

const storageDirectory = path.join(os.tmpdir(), `digi-shop-product-gallery-${process.pid}`);
process.env.APP_ORIGIN = "https://catalog.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.PRODUCT_IMAGE_STORAGE_DIR = storageDirectory;

const { createProductCatalogFake } = require("../test-support/product-catalog-fake");
const fake = createProductCatalogFake();
const db = require("../src/db/prisma");
db.getPrismaClient = () => fake.prisma;
const app = require("../src/app");

let server;
let baseUrl;
const accessToken = jwt.sign(
    { type: "access", ver: 1, role: "admin" },
    process.env.JWT_ACCESS_SECRET,
    { subject: "catalog-admin", expiresIn: "10m" }
);
const adminHeaders = {
    Cookie: `__Host-access_token=${accessToken}; __Host-csrf_token=gallery-csrf`,
    Origin: process.env.APP_ORIGIN,
    "X-CSRF-Token": "gallery-csrf"
};
const png = (shade) => PNG.sync.write({ width: 1, height: 1, data: Buffer.from([shade, 0, 0, 255]) });
const variantsJson = (variants) => JSON.stringify(variants);
const baseFields = (overrides = {}) => ({
    name: "Logitech MX Master 3S",
    brand: "Logitech",
    deviceType: "mouse",
    description: "A mouse with a gallery",
    options: "[]",
    variants: variantsJson([{ sku: "MXM-3S", price: 2000, costPrice: 1600, stock: 7, optionValues: {} }]),
    ...overrides
});

const send = async (method, url, { fields = baseFields(), cover = png(1), gallery = [], galleryOrder, removeImageIds } = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    if (cover) form.append("image", new Blob([cover], { type: "image/png" }), "cover.png");
    gallery.forEach((file, index) => form.append("gallery", new Blob([file], { type: "image/png" }), `extra-${index}.png`));
    if (galleryOrder !== undefined) form.append("galleryOrder", JSON.stringify(galleryOrder));
    if (removeImageIds !== undefined) form.append("removeImageIds", JSON.stringify(removeImageIds));
    return fetch(`${baseUrl}${url}`, { method, headers: adminHeaders, body: form });
};
const createProduct = (options) => send("POST", "/api/admin/products", options);
const updateProduct = (id, options = {}) => send("PUT", `/api/admin/products/${id}`, { cover: null, ...options });
const getAdminProduct = async (id) => (await (await fetch(`${baseUrl}/api/admin/products/${id}`, { headers: adminHeaders })).json()).data;
const storedFiles = async () => (await fs.readdir(storageDirectory)).sort();
const galleryUrls = (product) => product.gallery.map((image) => image.url);

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(storageDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
    fake.reset();
    await fs.rm(storageDirectory, { recursive: true, force: true });
    await fs.mkdir(storageDirectory, { recursive: true });
});

test("product info lists the main photo first, then the gallery in position order, and never exposes cost price", async () => {
    const created = (await (await createProduct({ gallery: [png(10), png(20), png(30)] })).json()).data;
    const response = await fetch(`${baseUrl}/api/products/info/${created.id}`);
    assert.equal(response.status, 200);
    const info = (await response.json()).data;
    assert.equal(info.images.length, 4);
    assert.deepEqual(info.images.map((image) => image.position), [0, 1, 2, 3]);
    assert.equal(info.images[0].url, created.image);
    assert.deepEqual(info.images.slice(1).map((image) => image.url), galleryUrls(created));
    assert.equal(new Set(info.images.map((image) => image.url)).size, 4);
    assert.equal("gallery" in info, false);
    assert.equal(info.variants.length, 1);
    assert.equal("costPrice" in info.variants[0], false);
    assert.doesNotMatch(JSON.stringify(info), /costPrice|1600/);
});

test("creating a product stores uploaded gallery photos in the requested order", async () => {
    const response = await createProduct({ gallery: [png(10), png(20), png(30)], galleryOrder: ["new:2", "new:0", "new:1"] });
    assert.equal(response.status, 201);
    const product = (await response.json()).data;
    assert.deepEqual(product.gallery.map((image) => image.position), [1, 2, 3]);
    const files = await Promise.all(galleryUrls(product).map((url) => fs.readFile(path.join(storageDirectory, path.basename(url)))));
    assert.deepEqual(files, [png(30), png(10), png(20)]);
    assert.equal((await storedFiles()).length, 4);
});

test("updating the gallery reorders photos, adds new ones and deletes removed files only after the save", async () => {
    const created = (await (await createProduct({ gallery: [png(10), png(20), png(30)] })).json()).data;
    const [first, second, third] = created.gallery;
    const response = await updateProduct(created.id, {
        gallery: [png(40)],
        removeImageIds: [second.id],
        galleryOrder: [third.id, "new:0", first.id]
    });
    assert.equal(response.status, 200);
    const updated = (await response.json()).data;
    assert.equal(updated.gallery.length, 3);
    assert.deepEqual(updated.gallery.map((image) => image.position), [1, 2, 3]);
    assert.equal(updated.gallery[0].id, third.id);
    assert.equal(updated.gallery[2].id, first.id);
    assert.deepEqual(
        await fs.readFile(path.join(storageDirectory, path.basename(updated.gallery[1].url))),
        png(40)
    );
    const files = await storedFiles();
    assert.equal(files.includes(path.basename(second.url)), false);
    assert.equal(files.length, 4);
    assert.deepEqual(galleryUrls(await getAdminProduct(created.id)), galleryUrls(updated));
});

test("without galleryOrder, kept photos keep their place and new ones are appended", async () => {
    const created = (await (await createProduct({ gallery: [png(10), png(20)] })).json()).data;
    const response = await updateProduct(created.id, { gallery: [png(30)], removeImageIds: [created.gallery[0].id] });
    assert.equal(response.status, 200);
    const updated = (await response.json()).data;
    assert.equal(updated.gallery[0].id, created.gallery[1].id);
    assert.equal(updated.gallery.length, 2);
    assert.deepEqual(updated.gallery.map((image) => image.position), [1, 2]);
});

test("removing a sample-catalog photo never deletes its file", async () => {
    const created = (await (await createProduct()).json()).data;
    await fs.writeFile(path.join(storageDirectory, "301-gallery-1.png"), png(99));
    fake.tables.productImages.push({ id: fake.tables.nextImageId++, productId: created.id, url: "/uploads/products/301-gallery-1.png", position: 1 });
    const imageId = fake.tables.productImages[0].id;
    const response = await updateProduct(created.id, { removeImageIds: [imageId] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.gallery.length, 0);
    assert.ok((await storedFiles()).includes("301-gallery-1.png"));
});

test("a gallery-only update leaves the product configuration and cost price untouched", async () => {
    const created = (await (await createProduct()).json()).data;
    const response = await updateProduct(created.id, { fields: {}, gallery: [png(10)] });
    assert.equal(response.status, 200);
    const updated = (await response.json()).data;
    assert.equal(updated.gallery.length, 1);
    assert.equal(updated.variants[0].costPrice, 1600);
    assert.equal(updated.variants[0].sku, "MXM-3S");
});

test("more than ten gallery files or a non-image gallery file is rejected before anything is stored", async () => {
    const tooMany = await createProduct({ gallery: Array.from({ length: 11 }, (_, index) => png(index)) });
    assert.equal(tooMany.status, 400);
    assert.match((await tooMany.json()).message, /tối đa 10/);

    const form = new FormData();
    for (const [key, value] of Object.entries(baseFields())) form.append(key, value);
    form.append("image", new Blob([png(1)], { type: "image/png" }), "cover.png");
    form.append("gallery", new Blob(["GIF89a"], { type: "image/gif" }), "extra.gif");
    const wrongFormat = await fetch(`${baseUrl}/api/admin/products`, { method: "POST", headers: adminHeaders, body: form });
    assert.equal(wrongFormat.status, 400);
    const corrupt = await createProduct({ gallery: [Buffer.from("not an image at all")] });
    assert.equal(corrupt.status, 400);

    assert.equal(fake.tables.products.length, 0);
    assert.deepEqual(await storedFiles(), []);
});

test("an invalid gallery order or foreign image id is a 400 and the new uploads are cleaned up", async () => {
    const created = (await (await createProduct({ gallery: [png(10)] })).json()).data;
    const before = await storedFiles();
    for (const options of [
        { gallery: [png(50)], galleryOrder: ["new:5"] },
        { gallery: [png(50)], galleryOrder: ["new:0", "new:0"] },
        { gallery: [png(50)], removeImageIds: [9999] }
    ]) {
        const response = await updateProduct(created.id, options);
        assert.equal(response.status, 400);
    }
    assert.deepEqual(await storedFiles(), before);
    assert.equal((await getAdminProduct(created.id)).gallery.length, 1);
});

test("cost price must be a whole number from 0 to the selling price", async () => {
    for (const costPrice of [2001, -1, 10.5, "abc"]) {
        const response = await createProduct({
            fields: baseFields({ variants: variantsJson([{ sku: "MXM-3S", price: 2000, costPrice, stock: 7, optionValues: {} }]) })
        });
        assert.equal(response.status, 400, `costPrice ${costPrice}`);
    }
    assert.equal(fake.tables.products.length, 0);
    assert.deepEqual(await storedFiles(), []);
    const zero = await createProduct({
        fields: baseFields({ variants: variantsJson([{ sku: "MXM-3S", price: 2000, costPrice: 0, stock: 7, optionValues: {} }]) })
    });
    assert.equal(zero.status, 201);
});

test("cost price is saved per variant, shown to the admin, kept when an update omits it and checked against a new price", async () => {
    const fields = baseFields({
        options: JSON.stringify([{ name: "Dung lượng", values: [{ value: "256GB" }, { value: "512GB" }] }]),
        variants: variantsJson([
            { sku: "MXM-256", price: 2000, costPrice: 1500, stock: 3, optionValues: { "Dung lượng": "256GB" } },
            { sku: "MXM-512", price: 3000, costPrice: 2400, stock: 3, optionValues: { "Dung lượng": "512GB" } }
        ])
    });
    const created = (await (await createProduct({ fields })).json()).data;
    assert.deepEqual(created.variants.map((variant) => variant.costPrice), [1500, 2400]);
    assert.deepEqual((await getAdminProduct(created.id)).variants.map((variant) => variant.costPrice), [1500, 2400]);

    const withoutCost = variantsJson([
        { sku: "MXM-256", price: 2100, stock: 3, optionValues: { "Dung lượng": "256GB" } },
        { sku: "MXM-512", price: 3000, stock: 3, optionValues: { "Dung lượng": "512GB" } }
    ]);
    const kept = await updateProduct(created.id, { fields: { ...fields, variants: withoutCost } });
    assert.equal(kept.status, 200);
    assert.deepEqual((await kept.json()).data.variants.map((variant) => variant.costPrice), [1500, 2400]);

    const tooLow = variantsJson([
        { sku: "MXM-256", price: 1000, stock: 3, optionValues: { "Dung lượng": "256GB" } },
        { sku: "MXM-512", price: 3000, stock: 3, optionValues: { "Dung lượng": "512GB" } }
    ]);
    const rejected = await updateProduct(created.id, { fields: { ...fields, variants: tooLow } });
    assert.equal(rejected.status, 400);
});
