const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const storageDirectory = () => path.resolve(process.env.PRODUCT_IMAGE_STORAGE_DIR || path.join(process.cwd(), "data", "product-images"));

const saveProductImage = async (file) => {
    const extension = file.productImageFormat === "webp" ? "webp" : "png";
    const name = `${crypto.randomUUID()}.${extension}`;
    const directory = storageDirectory();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, name), file.buffer, { flag: "wx", mode: 0o644 });
    return { name, publicPath: `/uploads/products/${name}`, fullPath: path.join(directory, name) };
};

const removeProductImage = async (stored) => {
    if (!stored) return;
    await fs.rm(stored.fullPath, { force: true });
};

// Only files this module wrote (random UUID names) may be deleted when a photo is dropped: the sample catalog's
// photos live in the same directory under descriptive names and must survive an admin removing them from a product.
const UPLOADED_IMAGE_PATH = /^\/uploads\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|webp))$/;

const uploadedImageFromPublicPath = (publicPath) => {
    const match = UPLOADED_IMAGE_PATH.exec(String(publicPath));
    return match ? { name: match[1], publicPath, fullPath: path.join(storageDirectory(), match[1]) } : null;
};

module.exports = { storageDirectory, saveProductImage, removeProductImage, uploadedImageFromPublicPath };
