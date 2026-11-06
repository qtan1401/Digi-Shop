// ===== PRODUCT REPOSITORY =====
// Prisma persistence for shared Product data and its purchasable variants.

const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");
const { Prisma } = require("@prisma/client");

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



const getCatalogPage = async ({ page, pageSize, q, category, tag, minPrice, maxPrice, sort, order }) => {
    const client = getPrismaClient();
    const predicates = [Prisma.sql`p.is_deleted = 0`];
    if (q) predicates.push(Prisma.sql`(
        CHARINDEX(${q} COLLATE Latin1_General_100_CI_AI, p.name COLLATE Latin1_General_100_CI_AI) > 0
        OR CHARINDEX(${q} COLLATE Latin1_General_100_CI_AI, p.description COLLATE Latin1_General_100_CI_AI) > 0
    )`);
    if (category.length) predicates.push(Prisma.sql`p.device_type IN (${Prisma.join(category)})`);
    if (tag.length) predicates.push(Prisma.sql`p.brand IN (${Prisma.join(tag)})`);
    if (minPrice !== null) predicates.push(Prisma.sql`COALESCE(v.min_price, 0) >= ${minPrice}`);
    if (maxPrice !== null) predicates.push(Prisma.sql`COALESCE(v.min_price, 0) <= ${maxPrice}`);

    const primaryOrder = sort === "name"
        ? Prisma.sql`p.name COLLATE Vietnamese_100_CI_AS ${Prisma.raw(order === "desc" ? "DESC" : "ASC")}`
        : sort === "price"
            ? Prisma.sql`f.min_price ${Prisma.raw(order === "desc" ? "DESC" : "ASC")}`
            : null;
    const orderBy = primaryOrder ? Prisma.sql`${primaryOrder}, p.id ASC` : Prisma.sql`p.id ASC`;
    const cte = Prisma.sql`
        WITH prices AS (
            SELECT product_id, MIN(price) AS min_price
            FROM product_variants WHERE is_active = 1 GROUP BY product_id
        ), filtered AS (
            SELECT p.id, COALESCE(v.min_price, 0) AS min_price
            FROM products p LEFT JOIN prices v ON v.product_id = p.id
            WHERE ${Prisma.join(predicates, " AND ")}
        )`;
    const countRows = await client.$queryRaw(Prisma.sql`${cte} SELECT COUNT(*) AS total FROM filtered`);
    const total = Number(countRows[0]?.total || 0);
    const catalogTotal = await client.product.count({ where: { isDeleted: false } });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const actualPage = Math.min(page, totalPages);
    const rows = total === 0 ? [] : await client.$queryRaw(Prisma.sql`
        ${cte}
        SELECT f.id, f.min_price FROM filtered f
        JOIN products p ON p.id = f.id
        ORDER BY ${orderBy}
        OFFSET ${(actualPage - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY
    `);
    const ids = rows.map((row) => Number(row.id));
    const records = ids.length ? await client.product.findMany({
        where: { id: { in: ids } },
        include: SUMMARY_INCLUDE
    }) : [];
    const byId = new Map(records.map((row) => [row.id, mapProduct(row)]));
    const data = rows.map((row) => {
        const product = byId.get(Number(row.id));
        if (product) product.price = Number(row.min_price);
        return product;
    }).filter(Boolean);
    return { data, meta: { page: actualPage, pageSize, total, totalPages, catalogTotal } };
};

const countProducts = async (where) => getPrismaClient().product.count({ where });
const findAdminPage = async (where, page, pageSize) => {
    const rows = await getPrismaClient().product.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: { id: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize
    });
    return rows.map((row) => mapProduct(row));
};

module.exports = {
    isSkuTaken,
    getProductByID,
    getVariantByID,
    getLegacyDefaultVariantByProductID,
    findBySku,
    checkSku,
    getCatalogPage,
    countProducts,
    findAdminPage,
    createProduct,
    updateProduct,
    softDelete,
    deleteProduct,
    restore,
    restoreProduct
};
