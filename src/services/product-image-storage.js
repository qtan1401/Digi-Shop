const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const storageDirectory = () => path.resolve(process.env.PRODUCT_IMAGE_STORAGE_DIR || path.join(process.cwd(), "data", "product-images"));

const saveProductImage = async (file) => {
    const name = `${crypto.randomUUID()}.png`;
    const directory = storageDirectory();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, name), file.buffer, { flag: "wx", mode: 0o644 });
    return { name, publicPath: `/uploads/products/${name}`, fullPath: path.join(directory, name) };
};

const removeProductImage = async (stored) => {
    if (!stored) return;
    await fs.rm(stored.fullPath, { force: true });
};

module.exports = { storageDirectory, saveProductImage, removeProductImage };
