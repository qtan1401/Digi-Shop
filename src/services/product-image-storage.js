const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const storageDirectory = () => path.resolve(process.env.PRODUCT_IMAGE_STORAGE_DIR || path.join(process.cwd(), "data", "product-images"));
const cloudinaryEnabled = () => process.env.PRODUCT_IMAGE_STORAGE === "cloudinary";

const cloudinaryConfig = () => {
    try {
        const parsed = new URL(process.env.CLOUDINARY_URL || "");
        if (parsed.protocol !== "cloudinary:" || !parsed.hostname || !parsed.username || !parsed.password) throw new Error();
        return { cloud: parsed.hostname, apiKey: decodeURIComponent(parsed.username), apiSecret: decodeURIComponent(parsed.password) };
    } catch {
        throw new Error("Cloudinary image storage is not configured.");
    }
};

const cloudinarySignature = (parameters, apiSecret) => {
    const value = Object.keys(parameters).sort().map((key) => `${key}=${parameters[key]}`).join("&");
    return crypto.createHash("sha1").update(`${value}${apiSecret}`).digest("hex");
};

const cloudinaryRequest = async (url, options) => {
    let response;
    try {
        response = await fetch(url, options);
        if (!response.ok) throw new Error();
        return await response.json();
    } catch {
        throw new Error("Cloudinary image operation failed.");
    }
};

const saveProductImage = async (file) => {
    const extension = file.productImageFormat === "webp" ? "webp" : "png";
    if (cloudinaryEnabled()) {
        const config = cloudinaryConfig();
        const publicId = `digishop/products/${crypto.randomUUID()}`;
        const timestamp = Math.floor(Date.now() / 1000);
        const params = { public_id: publicId, timestamp: String(timestamp) };
        const form = new FormData();
        form.set("file", new Blob([file.buffer], { type: `image/${extension}` }), `image.${extension}`);
        form.set("api_key", config.apiKey);
        form.set("timestamp", String(timestamp));
        form.set("public_id", publicId);
        form.set("signature", cloudinarySignature(params, config.apiSecret));
        const result = await cloudinaryRequest(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloud)}/image/upload`, { method: "POST", body: form });
        if (typeof result.secure_url !== "string") throw new Error("Cloudinary image operation failed.");
        return { name: `${publicId}.${extension}`, publicPath: result.secure_url, fullPath: null };
    }
    const name = `${crypto.randomUUID()}.${extension}`;
    const directory = storageDirectory();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, name), file.buffer, { flag: "wx", mode: 0o644 });
    return { name, publicPath: `/uploads/products/${name}`, fullPath: path.join(directory, name) };
};

const removeProductImage = async (stored) => {
    if (!stored) return;
    if (cloudinaryEnabled()) {
        const matched = cloudinaryImageFromPublicPath(stored.publicPath);
        if (!matched) return;
        const config = cloudinaryConfig();
        const timestamp = Math.floor(Date.now() / 1000);
        const params = { public_id: matched.publicId, timestamp: String(timestamp) };
        const form = new FormData();
        form.set("public_id", matched.publicId);
        form.set("timestamp", String(timestamp));
        form.set("api_key", config.apiKey);
        form.set("signature", cloudinarySignature(params, config.apiSecret));
        await cloudinaryRequest(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloud)}/image/destroy`, { method: "POST", body: form });
        return;
    }
    await fs.rm(stored.fullPath, { force: true });
};

// Only files this module wrote (random UUID names) may be deleted when a photo is dropped: the sample catalog's
// photos live in the same directory under descriptive names and must survive an admin removing them from a product.
const UPLOADED_IMAGE_PATH = /^\/uploads\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|webp))$/;
const CLOUDINARY_IMAGE_PATH = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/image\/upload\/v(\d+)\/digishop\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|webp)$/;
const cloudinaryImageFromPublicPath = (publicPath) => {
    const config = cloudinaryConfig();
    const match = CLOUDINARY_IMAGE_PATH.exec(String(publicPath));
    if (!match || match[1] !== config.cloud) return null;
    return { publicId: `digishop/products/${match[3]}`, name: `${match[3]}.${match[4]}` };
};

const uploadedImageFromPublicPath = (publicPath) => {
    if (cloudinaryEnabled()) {
        const matched = cloudinaryImageFromPublicPath(publicPath);
        return matched ? { name: matched.name, publicPath, fullPath: null } : null;
    }
    const match = UPLOADED_IMAGE_PATH.exec(String(publicPath));
    return match ? { name: match[1], publicPath, fullPath: path.join(storageDirectory(), match[1]) } : null;
};

module.exports = { storageDirectory, saveProductImage, removeProductImage, uploadedImageFromPublicPath };
