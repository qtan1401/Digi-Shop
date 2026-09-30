// ===== PRODUCT REPOSITORY =====
// Prisma persistence only; product validation and lifecycle rules remain in services.

const { getPrismaClient } = require("../db/prisma");

const toId = (id) => {
    const value = Number(id);
    return Number.isInteger(value) ? value : null;
};

const toIsoString = (value) =>
    value === undefined || value === null
        ? value
        : value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString();

const toDate = (value) =>
    value === undefined || value === null || value instanceof Date
        ? value
        : new Date(value);

const toNumber = (value) =>
    value === undefined || value === null ? value : Number(value);

const mapProduct = (row) => row
    ? {
        id: row.id,
        brand: row.brand,
        deviceType: row.deviceType,
        name: row.name,
        slug: row.slug,
        sku: row.sku,
        stock: row.stock,
        price: toNumber(row.price),
        image: row.image,
        description: row.description,
        isDeleted: row.isDeleted,
        deletedAt: toIsoString(row.deletedAt),
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt)
    }
    : undefined;

const getAllProducts = async () => {
    const rows = await getPrismaClient().product.findMany({
        orderBy: { id: "asc" }
    });
    return rows.map(mapProduct);
};

const getProductByID = async (id) => {
    const productId = toId(id);
    if (productId === null) return undefined;

    const row = await getPrismaClient().product.findUnique({
        where: { id: productId }
    });
    return mapProduct(row);
};

const findById = async (id) => getProductByID(id);

const findBySku = async (sku) => {
    if (typeof sku !== "string") return undefined;
    const normalizedSku = sku.trim().toUpperCase();
    const row = await getPrismaClient().product.findUnique({
        where: { sku: normalizedSku }
    });
    return mapProduct(row);
};

const isSkuTaken = async (sku) => Boolean(await findBySku(sku));
const checkSku = async (sku) => isSkuTaken(sku);

const updateAndRead = async (id, data) => {
    const productId = toId(id);
    if (productId === null) return null;

    const prisma = getPrismaClient();
    const result = await prisma.product.updateMany({
        where: { id: productId },
        data
    });
    if (result.count === 0) return null;

    const row = await prisma.product.findUnique({
        where: { id: productId }
    });
    return mapProduct(row);
};

const updateStock = async (id, newStock) =>
    updateAndRead(id, { stock: newStock });

const decreaseStock = async (id, quantity) =>
    updateAndRead(id, { stock: { decrement: quantity } });

const createProduct = async (productData = {}) => {
    const data = {
        brand: productData.brand,
        deviceType: productData.deviceType,
        name: productData.name,
        slug: productData.slug,
        sku: productData.sku,
        stock: productData.stock,
        price: productData.price,
        image: productData.image,
        description: productData.description,
        isDeleted: productData.isDeleted
    };
    if (productData.deletedAt !== undefined) data.deletedAt = toDate(productData.deletedAt);
    if (productData.createdAt !== undefined) data.createdAt = toDate(productData.createdAt);
    if (productData.updatedAt !== undefined) data.updatedAt = toDate(productData.updatedAt);

    const row = await getPrismaClient().product.create({ data });
    return mapProduct(row);
};

const updateProduct = async (id, changes = {}) => {
    const data = {};
    for (const field of [
        "brand",
        "deviceType",
        "name",
        "slug",
        "sku",
        "stock",
        "price",
        "image",
        "description",
        "isDeleted"
    ]) {
        if (Object.prototype.hasOwnProperty.call(changes, field)) data[field] = changes[field];
    }
    if (Object.prototype.hasOwnProperty.call(changes, "deletedAt")) {
        data.deletedAt = toDate(changes.deletedAt);
    }

    return updateAndRead(id, data);
};

const softDelete = async (id) => {
    const timestamp = new Date();
    return updateAndRead(id, {
        isDeleted: true,
        deletedAt: timestamp,
        updatedAt: timestamp
    });
};

const deleteProduct = async (id) => softDelete(id);

const restore = async (id, changes = {}) => {
    const data = {
        isDeleted: false,
        deletedAt: null,
        updatedAt: new Date()
    };

    return updateAndRead(id, data);
};

const restoreProduct = async (id, changes = {}) => restore(id, changes);

const findWithFilter = async (q = "", status = "active") => {
    const where = {};
    if (status === "active") where.isDeleted = false;
    if (status === "deleted") where.isDeleted = true;

    const query = typeof q === "string" ? q.trim() : "";
    if (query) {
        where.OR = [
            { name: { contains: query } },
            { sku: { contains: query } }
        ];
    }

    const rows = await getPrismaClient().product.findMany({
        where,
        orderBy: { id: "asc" }
    });
    return rows.map(mapProduct);
};

const getProductsByFilter = async (filters = {}) =>
    findWithFilter(filters.q, filters.status || "active");

module.exports = {
    getAllProducts,
    getProductByID,
    findById,
    findBySku,
    isSkuTaken,
    checkSku,
    findWithFilter,
    getProductsByFilter,
    createProduct,
    updateProduct,
    softDelete,
    deleteProduct,
    restore,
    restoreProduct,
    updateStock,
    decreaseStock
};
