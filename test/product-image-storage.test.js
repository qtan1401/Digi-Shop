const assert = require("node:assert/strict");
const { test } = require("node:test");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const storage = require("../src/services/product-image-storage");
const originalFetch = global.fetch;
const originalUrl = process.env.CLOUDINARY_URL;
const originalMode = process.env.PRODUCT_IMAGE_STORAGE;
const originalDirectory = process.env.PRODUCT_IMAGE_STORAGE_DIR;
const cloudUrl = "cloudinary://api-key:api-secret@test-cloud";

test("local image storage keeps local paths and only recognizes uploaded UUID images", async () => {
    delete process.env.PRODUCT_IMAGE_STORAGE;
    const previousDirectory = process.env.PRODUCT_IMAGE_STORAGE_DIR;
    process.env.PRODUCT_IMAGE_STORAGE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "image-storage-"));
    try {
        const saved = await storage.saveProductImage({ buffer: Buffer.from("image"), productImageFormat: "png" });
        assert.match(saved.publicPath, /^\/uploads\/products\/[a-f0-9-]+\.png$/);
        assert.deepEqual(await fs.readFile(saved.fullPath), Buffer.from("image"));
        assert.equal(storage.uploadedImageFromPublicPath("/uploads/products/sample.png"), null);
        assert.equal(storage.uploadedImageFromPublicPath(saved.publicPath).fullPath, saved.fullPath);
    } finally {
        await fs.rm(process.env.PRODUCT_IMAGE_STORAGE_DIR, { recursive: true, force: true });
        if (previousDirectory === undefined) delete process.env.PRODUCT_IMAGE_STORAGE_DIR;
        else process.env.PRODUCT_IMAGE_STORAGE_DIR = previousDirectory;
    }
});

test("Cloudinary upload uses a fresh UUID and configured folder, without leaking credentials on failure", async () => {
    process.env.PRODUCT_IMAGE_STORAGE = "cloudinary";
    process.env.CLOUDINARY_URL = cloudUrl;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return { ok: true, json: async () => ({ secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v42/digishop/products/12345678-1234-4123-8123-123456789abc.png" }) };
    };
    try {
        const saved = await storage.saveProductImage({ buffer: Buffer.from("png"), productImageFormat: "png" });
        assert.equal(saved.publicPath, "https://res.cloudinary.com/test-cloud/image/upload/v42/digishop/products/12345678-1234-4123-8123-123456789abc.png");
        assert.match(calls[0].url, /\/test-cloud\/image\/upload$/);
        const body = calls[0].options.body;
        assert.match(body.get("public_id"), /^digishop\/products\/[0-9a-f-]{36}$/);
        assert.match(body.get("signature"), /^[a-f0-9]{40}$/);
        global.fetch = async () => { throw new Error("request failed with cloudinary://api-key:api-secret@test-cloud"); };
        await assert.rejects(storage.saveProductImage({ buffer: Buffer.from("png"), productImageFormat: "png" }), (error) => !error.message.includes("api-secret"));
    } finally {
        global.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = originalUrl;
        if (originalMode === undefined) delete process.env.PRODUCT_IMAGE_STORAGE; else process.env.PRODUCT_IMAGE_STORAGE = originalMode;
        if (originalDirectory === undefined) delete process.env.PRODUCT_IMAGE_STORAGE_DIR; else process.env.PRODUCT_IMAGE_STORAGE_DIR = originalDirectory;
    }
});

test("Cloudinary deletion recognizes only exact configured app URLs", async () => {
    process.env.PRODUCT_IMAGE_STORAGE = "cloudinary";
    process.env.CLOUDINARY_URL = cloudUrl;
    const deleted = [];
    global.fetch = async (url, options) => {
        deleted.push({ url: String(url), body: options.body });
        return { ok: true, json: async () => ({ result: "ok" }) };
    };
    try {
        const valid = "https://res.cloudinary.com/test-cloud/image/upload/v42/digishop/products/12345678-1234-4123-8123-123456789abc.webp";
        const recognized = storage.uploadedImageFromPublicPath(valid);
        assert.ok(recognized);
        for (const invalid of ["/uploads/products/12345678-1234-4123-8123-123456789abc.png", valid.replace("test-cloud", "other-cloud"), valid.replace("/v42/", "/v42_extra/"), valid.replace("/digishop/products/", "/other/"), "https://res.cloudinary.com/test-cloud/image/upload/v42/digishop/products/sample.png"]) assert.equal(storage.uploadedImageFromPublicPath(invalid), null);
        await storage.removeProductImage(recognized);
        assert.equal(deleted.length, 1);
        assert.equal(deleted[0].body.get("public_id"), "digishop/products/12345678-1234-4123-8123-123456789abc");
        assert.match(deleted[0].body.get("signature"), /^[a-f0-9]{40}$/);
    } finally {
        global.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = originalUrl;
        if (originalMode === undefined) delete process.env.PRODUCT_IMAGE_STORAGE; else process.env.PRODUCT_IMAGE_STORAGE = originalMode;
    }
});
