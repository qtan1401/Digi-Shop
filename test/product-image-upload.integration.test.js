const assert = require("node:assert/strict");
const PNG = require("pngjs").PNG;
const sharp = require("sharp");
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
let productOptions;
let productOptionValues;
let productVariants;
let variantOptionValues;
let audits;
let nextProductId;
let nextOptionId;
let nextOptionValueId;
let nextVariantId;
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === "object" && "contains" in expected) return String(row[key] ?? "").includes(expected.contains);
    return row[key] === expected;
});
const hydrateVariant = (row, include = {}) => {
    if (!row) return row;
    const result = clone(row);
    if (include.optionValues) {
        result.optionValues = variantOptionValues
            .filter((link) => link.variantId === row.id)
            .map((link) => {
                const optionValue = productOptionValues.find((value) => value.id === link.optionValueId);
                const option = productOptions.find((candidate) => candidate.id === optionValue?.optionId);
                return {
                    ...clone(link),
                    optionValue: optionValue ? { ...clone(optionValue), option: clone(option) } : null
                };
            });
    }
    if (include.product) result.product = clone(products.find((product) => product.id === row.productId));
    return result;
};
const hydrateProduct = (row, include = {}) => {
    if (!row) return row;
    const result = clone(row);
    if (include.options) {
        const spec = include.options === true ? {} : include.options;
        result.options = productOptions
            .filter((option) => option.productId === row.id &&
                (spec.where?.isActive === undefined || option.isActive === spec.where.isActive))
            .map((option) => ({
                ...clone(option),
                values: productOptionValues
                    .filter((value) => value.optionId === option.id &&
                        (spec.include?.values?.where?.isActive === undefined ||
                            value.isActive === spec.include.values.where.isActive))
                    .map(clone)
            }));
    }
    if (include.variants) {
        const spec = include.variants === true ? {} : include.variants;
        result.variants = productVariants
            .filter((variant) => variant.productId === row.id &&
                (spec.where?.isActive === undefined || variant.isActive === spec.where.isActive))
            .map((variant) => hydrateVariant(variant, spec.include || {}));
    }
    return result;
};
const fakePrisma = {
    $transaction: async (work) => work(fakePrisma),
    product: {
        findMany: async ({ where = {}, orderBy, include } = {}) => {
            const rows = products.filter((row) => matches(row, where));
            if (orderBy?.id === "asc") rows.sort((a, b) => a.id - b.id);
            return rows.map((row) => hydrateProduct(row, include));
        },
        findUnique: async ({ where, include }) =>
            hydrateProduct(products.find((row) => matches(row, where)), include),
        create: async ({ data }) => {
            const row = { id: nextProductId++, ...clone(data) };
            products.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = products.find((candidate) => matches(candidate, where));
            if (!row) throw new Error("product not found");
            Object.assign(row, clone(data));
            return clone(row);
        },
        updateMany: async ({ where, data }) => {
            const row = products.find((candidate) => matches(candidate, where));
            if (!row) return { count: 0 };
            Object.assign(row, clone(data));
            return { count: 1 };
        }
    },
    productOption: {
        findMany: async ({ where }) => productOptions
            .filter((option) => matches(option, where))
            .map((option) => ({
                ...clone(option),
                values: productOptionValues.filter((value) => value.optionId === option.id).map(clone)
            })),
        create: async ({ data }) => {
            const row = { id: nextOptionId++, ...clone(data) };
            productOptions.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = productOptions.find((option) => matches(option, where));
            Object.assign(row, clone(data));
            return clone(row);
        }
    },
    productOptionValue: {
        create: async ({ data }) => {
            const row = { id: nextOptionValueId++, ...clone(data) };
            productOptionValues.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = productOptionValues.find((value) => matches(value, where));
            Object.assign(row, clone(data));
            return clone(row);
        }
    },
    productVariant: {
        findUnique: async ({ where, include }) => {
            const row = where.sku
                ? productVariants.find((variant) => variant.sku === where.sku)
                : where.productId_combinationKey
                    ? productVariants.find((variant) =>
                        variant.productId === where.productId_combinationKey.productId &&
                        variant.combinationKey === where.productId_combinationKey.combinationKey)
                    : productVariants.find((variant) => matches(variant, where));
            return row ? hydrateVariant(row, include) : null;
        },
        findMany: async ({ where = {}, take }) => {
            const rows = productVariants.filter((variant) => matches(variant, where));
            return rows.slice(0, take).map((row) => clone(row));
        },
        create: async ({ data }) => {
            const row = { id: nextVariantId++, ...clone(data) };
            productVariants.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = productVariants.find((variant) => matches(variant, where));
            Object.assign(row, clone(data));
            return clone(row);
        }
    },
    productVariantOptionValue: {
        deleteMany: async ({ where }) => {
            const before = variantOptionValues.length;
            variantOptionValues = variantOptionValues.filter((link) => !matches(link, where));
            return { count: before - variantOptionValues.length };
        },
        create: async ({ data }) => {
            const row = clone(data);
            variantOptionValues.push(row);
            return row;
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
    name: "iPhone 17",
    brand: "Apple",
    deviceType: "phone",
    description: "A new phone",
    options: "[]",
    variants: JSON.stringify([{ sku: "IP17-256", price: 999, stock: 7, optionValues: {} }])
};
const createPng = (pixel) => PNG.sync.write({ width: 1, height: 1, data: Buffer.from(pixel) });
const png = createPng([255, 0, 0, 255]);
const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
};
const createAncillaryChunk = (type, data) => {
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 4, "ascii");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
    return chunk;
};
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
    productOptions = [];
    productOptionValues = [];
    productVariants = [];
    variantOptionValues = [];
    audits = [];
    nextProductId = 1;
    nextOptionId = 1;
    nextOptionValueId = 1;
    nextVariantId = 1;
    await fs.rm(storageDirectory, { recursive: true, force: true });
    await fs.mkdir(storageDirectory, { recursive: true });
});

test("administrator can upload one PNG and retrieve it at the persisted public image path", async () => {
    const response = await upload({ filename: "iphone-duo.PNG" });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.match(result.data.image, /^\/uploads\/products\/[a-f0-9-]+\.png$/);
    assert.deepEqual(await fs.readFile(path.join(storageDirectory, path.basename(result.data.image))), png);
    const publicImage = await fetch(`${baseUrl}${result.data.image}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), png);
});

test("administrator can upload a WebP image mislabeled with a PNG filename", async () => {
    const webp = await fs.readFile(path.join(__dirname, "..", "iphone_duo.png"));
    const response = await upload({ file: webp, filename: "iphone_duo.png", type: "image/png" });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.match(result.data.image, /^\/uploads\/products\/[a-f0-9-]+\.webp$/);
    assert.deepEqual(await fs.readFile(path.join(storageDirectory, path.basename(result.data.image))), webp);
    const publicImage = await fetch(`${baseUrl}${result.data.image}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get("content-type"), "image/webp");
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), webp);
});

test("malformed WebP is rejected before product or file storage", async () => {
    const webp = await fs.readFile(path.join(__dirname, "..", "iphone_duo.png"));
    const response = await upload({
        file: webp.subarray(0, 20),
        filename: "truncated.webp",
        type: "image/webp"
    });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.errors?.[0]?.message, "Ảnh bị hỏng hoặc không đúng định dạng.");
    assert.equal(products.length, 0);
    assert.deepEqual(await uploadedNames(), []);
});

test("WebP beyond the product dimension boundary returns a resolution error", async () => {
    const tooWideWebP = await sharp({
        create: {
            width: 8_193,
            height: 1,
            channels: 3,
            background: { r: 0, g: 0, b: 0 }
        }
    }).webp().toBuffer();
    const response = await upload({ file: tooWideWebP, filename: "wide.webp", type: "image/webp" });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.errors?.[0]?.message, "Ảnh vượt giới hạn độ phân giải (tối đa 8.192 px mỗi cạnh và 25 MP).");
    assert.equal(products.length, 0);
    assert.deepEqual(await uploadedNames(), []);
});

test("PNG images exactly 5 MiB are accepted and served unchanged", async () => {
    const data = Buffer.alloc(5 * 1024 * 1024 - png.length - 12, 0x20);
    Buffer.from("Padding\0").copy(data);
    const chunk = createAncillaryChunk("tEXt", data);
    const maximumSizePng = Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
    assert.equal(maximumSizePng.length, 5 * 1024 * 1024);
    const response = await upload({ file: maximumSizePng });
    assert.equal(response.status, 201);
    const created = (await response.json()).data;
    const publicImage = await fetch(`${baseUrl}${created.image}`);
    assert.equal(publicImage.status, 200);
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), maximumSizePng);
});

test("signature-correct truncated PNG is rejected before product or file storage", async () => {
    const malformedPng = Buffer.concat([png.subarray(0, 8), Buffer.from([0, 0, 0])]);
    const response = await upload({ file: malformedPng });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.errors?.[0]?.message, "Ảnh bị hỏng hoặc không đúng định dạng.");
    assert.equal(products.length, 0);
    assert.deepEqual(await uploadedNames(), []);
});

test("PNG with invalid CRC is reported as corrupt before storage", async () => {
    const corruptPng = Buffer.from(png);
    corruptPng.writeUInt32BE(corruptPng.readUInt32BE(29) ^ 1, 29);
    const response = await upload({ file: corruptPng, filename: "corrupt.PNG" });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.errors?.[0]?.message, "Ảnh bị hỏng hoặc không đúng định dạng.");
    assert.equal(products.length, 0);
    assert.deepEqual(await uploadedNames(), []);
});

test("PNG beyond the product dimension boundary returns a resolution error", async () => {
    const tooWidePng = PNG.sync.write({
        width: 8_193,
        height: 1,
        data: Buffer.alloc(8_193 * 4, 0)
    });
    const response = await upload({ file: tooWidePng, filename: "wide.PNG" });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.errors?.[0]?.message, "Ảnh vượt giới hạn độ phân giải (tối đa 8.192 px mỗi cạnh và 25 MP).");
    assert.equal(products.length, 0);
    assert.deepEqual(await uploadedNames(), []);
});

test("PNG declaring more pixels than the decoded budget gets a resolution error", async () => {
    const tooManyPixelsPng = Buffer.from(png);
    tooManyPixelsPng.writeUInt32BE(5_000, 16);
    tooManyPixelsPng.writeUInt32BE(5_001, 20);
    tooManyPixelsPng.writeUInt32BE(crc32(tooManyPixelsPng.subarray(12, 29)), 29);
    const response = await upload({ file: tooManyPixelsPng, filename: "large-dimensions.PNG" });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.errors?.[0]?.message, "Ảnh vượt giới hạn độ phân giải (tối đa 8.192 px mỗi cạnh và 25 MP).");
    assert.equal(products.length, 0);
    assert.deepEqual(await uploadedNames(), []);
});

test("unsupported formats, malformed images, and oversized files return image field errors without storing bytes", async () => {
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
        body: JSON.stringify({
            ...productFields,
            name: "Updated phone",
            variants: JSON.stringify([{ sku: "IP17-256", price: 1000, stock: 8, optionValues: {} }])
        })
    });
    assert.equal(retainedResponse.status, 200);
    assert.equal((await retainedResponse.json()).data.image, created.image);

    const replacement = createPng([0, 0, 255, 255]);
    const form = new FormData();
    for (const [key, value] of Object.entries({
        ...productFields,
        name: "Replaced phone",
        variants: JSON.stringify([{ sku: "IP17-256", price: 1000, stock: 8, optionValues: {} }])
    })) form.append(key, value);
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
