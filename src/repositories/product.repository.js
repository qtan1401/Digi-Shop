// ===== PRODUCT REPOSITORY =====
// Prisma persistence for shared Product data and its purchasable variants.

const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");

const toId = (id) => {
    const value = Number(id);
    return Number.isInteger(value) && value > 0 ? value : null;
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

const normalizeText = (value) => String(value ?? "").trim().normalize("NFC");
const normalizeKey = (value) => normalizeText(value).toLocaleLowerCase("vi");

const SUMMARY_INCLUDE = {
    variants: {
        where: { isActive: true },
        select: { price: true, stock: true }
    }
};

const DETAIL_INCLUDE = {
    options: {
        where: { isActive: true },
        orderBy: { position: "asc" },
        include: {
            values: {
                where: { isActive: true },
                orderBy: { position: "asc" }
            }
        }
    },
    variants: {
        where: { isActive: true },
        orderBy: { id: "asc" },
        include: {
            optionValues: {
                include: {
                    optionValue: {
                        include: { option: true }
                    }
                }
            }
        }
    }
};

const mapVariant = (row) => {
    const optionValues = {};
    for (const link of row.optionValues || []) {
        const value = link.optionValue;
        if (value?.option?.isActive !== false && value?.isActive !== false) {
            optionValues[value.option.name] = value.value;
        }
    }
    return {
        id: row.id,
        sku: row.sku,
        price: toNumber(row.price),
        stock: toNumber(row.stock),
        image: row.image || null,
        isActive: Boolean(row.isActive),
        optionValues
    };
};

const mapProduct = (row, { includeConfiguration = false } = {}) => {
    if (!row) return undefined;
    const variants = row.variants || [];
    const prices = variants.map((variant) => toNumber(variant.price)).filter(Number.isFinite);
    const stock = variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);
    const product = {
        id: row.id,
        brand: row.brand,
        deviceType: row.deviceType,
        name: row.name,
        slug: row.slug,
        image: row.image,
        description: row.description,
        price: prices.length ? Math.min(...prices) : 0,
        priceMax: prices.length ? Math.max(...prices) : 0,
        stock,
        variantCount: variants.length,
        isDeleted: row.isDeleted,
        deletedAt: toIsoString(row.deletedAt),
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt)
    };
    if (includeConfiguration) {
        product.options = (row.options || []).map((option) => ({
            name: option.name,
            values: (option.values || []).map((value) => ({ value: value.value, colorHex: value.colorHex || null }))
        }));
        product.variants = variants.map(mapVariant);
    }
    return product;
};

const VARIANT_DETAIL_INCLUDE = {
    product: true,
    optionValues: {
        include: {
            optionValue: {
                include: { option: true }
            }
        }
    }
};

const mapVariantWithProduct = (row) => {
    if (!row) return undefined;
    const product = row.product;
    return {
        ...mapVariant(row),
        productId: row.productId,
        product: product ? {
            id: product.id,
            brand: product.brand,
            deviceType: product.deviceType,
            name: product.name,
            slug: product.slug,
            image: product.image,
            description: product.description,
            isDeleted: Boolean(product.isDeleted),
            deletedAt: toIsoString(product.deletedAt)
        } : undefined
    };
};

const getProductByIdFrom = async (client, id, includeConfiguration = true) => {
    const productId = toId(id);
    if (productId === null) return undefined;
    const row = await client.product.findUnique({
        where: { id: productId },
        include: includeConfiguration ? DETAIL_INCLUDE : SUMMARY_INCLUDE
    });
    return mapProduct(row, { includeConfiguration });
};

const getAllProducts = async () => {
    const rows = await getPrismaClient().product.findMany({
        include: SUMMARY_INCLUDE,
        orderBy: { id: "asc" }
    });
    return rows.map((row) => mapProduct(row));
};

const getProductByID = async (id) => getProductByIdFrom(getPrismaClient(), id);
const getVariantByID = async (id) => {
    const variantId = toId(id);
    if (variantId === null) return undefined;
    const row = await getPrismaClient().productVariant.findUnique({
        where: { id: variantId },
        include: VARIANT_DETAIL_INCLUDE
    });
    return mapVariantWithProduct(row);
};
const getLegacyDefaultVariantByProductID = async (id) => {
    const productId = toId(id);
    if (productId === null) return undefined;
    const rows = await getPrismaClient().productVariant.findMany({
        where: { productId },
        orderBy: { id: "asc" },
        take: 2,
        include: VARIANT_DETAIL_INCLUDE
    });
    return rows.length === 1 ? mapVariantWithProduct(rows[0]) : undefined;
};



const findBySku = async (sku) => {
    if (typeof sku !== "string") return undefined;
    const normalizedSku = sku.trim().toUpperCase();
    const row = await getPrismaClient().productVariant.findUnique({
        where: { sku: normalizedSku },
        select: { id: true, productId: true, sku: true, combinationKey: true, isActive: true }
    });
    return row || undefined;
};

const isSkuTaken = async (sku) => Boolean(await findBySku(sku));
const checkSku = async (sku) => isSkuTaken(sku);

const combinationKey = (optionValueIds) => crypto
    .createHash("sha256")
    .update(JSON.stringify([...optionValueIds].sort((left, right) => left - right)))
    .digest("hex")
    .toUpperCase();

const saveConfiguration = async (transaction, productId, options, variants) => {
    const existingOptions = await transaction.productOption.findMany({
        where: { productId },
        include: { values: true }
    });
    const existingVariants = await transaction.productVariant.findMany({
        where: { productId }
    });

    for (const option of existingOptions) {
        await transaction.productOption.update({
            where: { id: option.id },
            data: { isActive: false, position: -option.id - 1 }
        });
        for (const value of option.values || []) {
            await transaction.productOptionValue.update({
                where: { id: value.id },
                data: { isActive: false, position: -value.id - 1 }
            });
        }
    }
    for (const variant of existingVariants) {
        if (variant.isActive) {
            await transaction.productVariant.update({
                where: { id: variant.id },
                data: { isActive: false }
            });
        }
    }

    const optionValueIdsByName = new Map();
    for (let optionPosition = 0; optionPosition < options.length; optionPosition += 1) {
        const optionInput = options[optionPosition];
        let optionRow = existingOptions.find((candidate) => normalizeKey(candidate.name) === normalizeKey(optionInput.name));
        let existingValues = optionRow?.values || [];
        if (optionRow) {
            optionRow = await transaction.productOption.update({
                where: { id: optionRow.id },
                data: { name: optionInput.name, position: optionPosition, isActive: true }
            });
        } else {
            optionRow = await transaction.productOption.create({
                data: { productId, name: optionInput.name, position: optionPosition, isActive: true }
            });
        }

        const valuesByKey = new Map(existingValues.map((value) => [normalizeKey(value.value), value]));
        const idsByKey = new Map();
        for (let valuePosition = 0; valuePosition < optionInput.values.length; valuePosition += 1) {
            const { value: valueText, colorHex } = optionInput.values[valuePosition];
            const existingValue = valuesByKey.get(normalizeKey(valueText));
            const valueRow = existingValue
                ? await transaction.productOptionValue.update({
                    where: { id: existingValue.id },
                    data: { value: valueText, colorHex: colorHex || null, position: valuePosition, isActive: true }
                })
                : await transaction.productOptionValue.create({
                    data: { optionId: optionRow.id, value: valueText, colorHex: colorHex || null, position: valuePosition, isActive: true }
                });
            idsByKey.set(normalizeKey(valueText), valueRow.id);
        }
        optionValueIdsByName.set(normalizeKey(optionInput.name), idsByKey);
    }

    for (const variantInput of variants) {
        const optionValueIds = Object.entries(variantInput.optionValues).map(([name, value]) => {
            const optionValues = optionValueIdsByName.get(normalizeKey(name));
            return optionValues?.get(normalizeKey(value));
        });
        const key = combinationKey(optionValueIds);
        const existingVariant = await transaction.productVariant.findUnique({
            where: { productId_combinationKey: { productId, combinationKey: key } }
        });
        const data = {
            sku: variantInput.sku,
            combinationKey: key,
            price: variantInput.price,
            stock: variantInput.stock,
            image: variantInput.image || null,
            isActive: true
        };
        const variantRow = existingVariant
            ? await transaction.productVariant.update({ where: { id: existingVariant.id }, data })
            : await transaction.productVariant.create({ data: { ...data, productId } });

        await transaction.productVariantOptionValue.deleteMany({ where: { variantId: variantRow.id } });
        for (const optionValueId of optionValueIds) {
            await transaction.productVariantOptionValue.create({
                data: { variantId: variantRow.id, optionValueId }
            });
        }
    }
};

const updateAndRead = async (id, data) => {
    const productId = toId(id);
    if (productId === null) return null;

    const prisma = getPrismaClient();
    const result = await prisma.product.updateMany({
        where: { id: productId },
        data
    });
    if (result.count === 0) return null;
    return getProductByIdFrom(prisma, productId);
};

const createProduct = async (productData = {}) => {
    const prisma = getPrismaClient();
    return prisma.$transaction(async (transaction) => {
        const data = {
            brand: productData.brand,
            deviceType: productData.deviceType,
            name: productData.name,
            slug: productData.slug,
            image: productData.image,
            description: productData.description,
            isDeleted: productData.isDeleted
        };
        if (productData.deletedAt !== undefined) data.deletedAt = toDate(productData.deletedAt);
        if (productData.createdAt !== undefined) data.createdAt = toDate(productData.createdAt);
        if (productData.updatedAt !== undefined) data.updatedAt = toDate(productData.updatedAt);

        const row = await transaction.product.create({ data });
        await saveConfiguration(transaction, row.id, productData.options || [], productData.variants || []);
        return await getProductByIdFrom(transaction, row.id);
    });
};

const updateProduct = async (id, changes = {}) => {
    const productId = toId(id);
    if (productId === null) return null;
    const prisma = getPrismaClient();
    return prisma.$transaction(async (transaction) => {
        const current = await transaction.product.findUnique({ where: { id: productId } });
        if (!current) return null;
        const data = {};
        for (const field of ["brand", "deviceType", "name", "image", "description", "isDeleted"]) {
            if (Object.prototype.hasOwnProperty.call(changes, field)) data[field] = changes[field];
        }
        if (Object.prototype.hasOwnProperty.call(changes, "deletedAt")) data.deletedAt = toDate(changes.deletedAt);
        await transaction.product.update({ where: { id: productId }, data });
        await saveConfiguration(transaction, productId, changes.options || [], changes.variants || []);
        return await getProductByIdFrom(transaction, productId);
    });
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

const restore = async (id) => updateAndRead(id, {
    isDeleted: false,
    deletedAt: null,
    updatedAt: new Date()
});

const restoreProduct = async (id) => restore(id);

const findWithFilter = async (q = "", status = "active") => {
    const where = {};
    if (status === "active") where.isDeleted = false;
    if (status === "deleted") where.isDeleted = true;

    const query = typeof q === "string" ? q.trim() : "";
    if (query) {
        where.OR = [
            { name: { contains: query } },
            { variants: { some: { isActive: true, sku: { contains: query } } } }
        ];
    }

    const rows = await getPrismaClient().product.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: { id: "asc" }
    });
    return rows.map((row) => mapProduct(row));
};

const getProductsByFilter = async (filters = {}) =>
    findWithFilter(filters.q, filters.status || "active");

module.exports = {
    getAllProducts,
    isSkuTaken,
    getProductByID,
    getVariantByID,
    getLegacyDefaultVariantByProductID,
    findBySku,
    checkSku,
    findWithFilter,
    getProductsByFilter,
    createProduct,
    updateProduct,
    softDelete,
    deleteProduct,
    restore,
    restoreProduct
};
