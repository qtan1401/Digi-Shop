// ===== PRODUCT REPOSITORY =====
// Prisma persistence for shared Product data and its purchasable variants.

const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");
const { Prisma } = require("@prisma/client");
const productImageRepository = require("./product-image.repository");
const tagRepository = require("./tag.repository");
const { escapeLike } = require("./like-escape");

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
    category: { select: { id: true, slug: true, name: true } },
    variants: {
        where: { isActive: true },
        select: { price: true, stock: true }
    }
};

const DETAIL_INCLUDE = {
    category: { select: { id: true, slug: true, name: true } },
    images: { orderBy: { position: "asc" } },
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
        categoryId: row.categoryId,
        category: row.category ? { id: row.category.id, slug: row.category.slug, name: row.category.name } : undefined,
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
        // costPrice is admin data: only this configuration view carries it (mapVariant, used by cart and checkout, never does)
        // and the product service strips it from public responses.
        product.variants = variants.map((variant) => ({ ...mapVariant(variant), costPrice: toNumber(variant.costPrice ?? 0) }));
        product.gallery = (row.images || []).map((image) => ({ id: image.id, url: image.url, position: image.position }));
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
            costPrice: variantInput.costPrice ?? 0,
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

// Lock the Category in the same transaction as the Product write: concurrent soft-delete must either
// finish first (and fail this write), or wait until this Product is visible to its in-use check.
const lockActiveCategory = async (transaction, categoryId) => {
    await transaction.$queryRaw`SELECT id FROM categories WHERE id = ${categoryId} FOR UPDATE`;
    const row = await transaction.category.findFirst({ where: { id: categoryId, isDeleted: false }, select: { slug: true } });
    if (!row) {
        const error = new Error("Danh mục không tồn tại hoặc đã bị xóa.");
        error.statusCode = 409;
        error.errors = [{ field: "categoryId", message: error.message }];
        throw error;
    }
    return row;
};

const applyTags = async (transaction, productId, tagIds) => {
    if (tagIds === undefined) return;
    const result = await tagRepository.replaceProductTags(productId, tagIds.map(Number), transaction);
    if (result === null) {
        const error = new Error("Có thẻ không tồn tại hoặc đã bị xóa.");
        error.statusCode = 400;
        error.errors = [{ field: "tagIds", message: error.message }];
        throw error;
    }
};
const createProduct = async (productData = {}) => {
    const prisma = getPrismaClient();
    return prisma.$transaction(async (transaction) => {
        const category = await lockActiveCategory(transaction, productData.categoryId);
        const data = {
            brand: productData.brand,
            categoryId: productData.categoryId,
            deviceType: category.slug,
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
        await productImageRepository.applyGalleryPlan(transaction, row.id, productData.galleryPlan);
        await applyTags(transaction, row.id, productData.tagIds);
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
        const category = await lockActiveCategory(transaction, changes.categoryId);
        const data = {};
        for (const field of ["brand", "name", "image", "description", "isDeleted"]) {
            if (Object.prototype.hasOwnProperty.call(changes, field)) data[field] = changes[field];
        }
        data.categoryId = changes.categoryId;
        data.deviceType = category.slug;
        if (Object.prototype.hasOwnProperty.call(changes, "deletedAt")) data.deletedAt = toDate(changes.deletedAt);
        await transaction.product.update({ where: { id: productId }, data });
        await saveConfiguration(transaction, productId, changes.options || [], changes.variants || []);
        await productImageRepository.applyGalleryPlan(transaction, productId, changes.galleryPlan);
        await applyTags(transaction, productId, changes.tagIds);
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

const restore = async (id) => {
    const productId = toId(id);
    if (productId === null) return null;
    return getPrismaClient().$transaction(async (tx) => {
        const current = await tx.product.findUnique({ where: { id: productId } });
        if (!current) return null;
        const category = await lockActiveCategory(tx, current.categoryId);
        await tx.product.update({ where: { id: productId }, data: {
            isDeleted: false, deletedAt: null, updatedAt: new Date(), deviceType: category.slug
        } });
        return getProductByIdFrom(tx, productId);
    });
};

const restoreProduct = async (id) => restore(id);



const getCatalogPage = async ({ page, pageSize, q, category, tag, brand, minPrice, maxPrice, minRating = null, sort, order }) => {
    const client = getPrismaClient();
    const predicates = [Prisma.sql`p.is_deleted = false`];
    if (q) {
        // Treat LIKE wildcards as literal characters, matching substring-search semantics.
        const escapedQuery = escapeLike(q);
        predicates.push(Prisma.sql`(
            lower(immutable_unaccent(p.name)) LIKE '%' || lower(immutable_unaccent(${escapedQuery})) || '%' ESCAPE E'\\\\'
            OR lower(immutable_unaccent(p.description)) LIKE '%' || lower(immutable_unaccent(${escapedQuery})) || '%' ESCAPE E'\\\\'
        )`);
    }
    if (category.length) predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM categories c WHERE c.id = p.category_id AND c.slug IN (${Prisma.join(category)}) AND c.is_deleted = false)`);
    if (tag.length) predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = p.id AND t.slug IN (${Prisma.join(tag)}) AND t.is_deleted = false)`);
    if (brand.length) predicates.push(Prisma.sql`p.brand IN (${Prisma.join(brand)})`);
    if (minPrice !== null) predicates.push(Prisma.sql`COALESCE(v.min_price, 0) >= ${minPrice}`);
    if (maxPrice !== null) predicates.push(Prisma.sql`COALESCE(v.min_price, 0) <= ${maxPrice}`);
    // Same figure the cards show: average of visible star ratings rounded to one decimal; unrated Products never match.
    if (minRating !== null) predicates.push(Prisma.sql`(
        SELECT ROUND(AVG(r.rating::numeric), 1) FROM product_reviews r
        WHERE r.product_id = p.id AND r.is_hidden = false AND r.rating IS NOT NULL
    ) >= ${minRating}`);

    const primaryOrder = sort === "name"
        ? Prisma.sql`p.name COLLATE "vi-VN-x-icu" ${Prisma.raw(order === "desc" ? "DESC" : "ASC")}`
        : sort === "price"
            ? Prisma.sql`f.min_price ${Prisma.raw(order === "desc" ? "DESC" : "ASC")}`
            : null;
    const orderBy = primaryOrder ? Prisma.sql`${primaryOrder}, p.id ASC` : Prisma.sql`p.id ASC`;
    const cte = Prisma.sql`
        WITH prices AS (
            SELECT product_id, MIN(price) AS min_price
            FROM product_variants WHERE is_active = true GROUP BY product_id
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
        LIMIT ${pageSize} OFFSET ${(actualPage - 1) * pageSize}
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
