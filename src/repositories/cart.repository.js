// ===== CART REPOSITORY =====
// Owns account-cart persistence and the SQL Server transaction used by Guest merge.
// Cart mutations never reserve stock; checkout revalidates stock independently.

const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");

const toVariantId = (value) => {
    const variantId = Number(value);
    return Number.isInteger(variantId) && variantId > 0 ? variantId : null;
};

const toQuantity = (value) => {
    const quantity = Number(value);
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
};

const toNumber = (value) =>
    value === undefined || value === null ? value : Number(value);

const toIsoString = (value) =>
    value === undefined || value === null
        ? value
        : value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString();

const optionValuesFor = (variant) => {
    const values = {};
    for (const link of variant.optionValues || []) {
        const optionValue = link.optionValue;
        if (optionValue?.option?.isActive !== false && optionValue?.isActive !== false) {
            values[optionValue.option.name] = optionValue.value;
        }
    }
    return values;
};

const variantLabel = (values) => Object.entries(values)
    .map(([name, value]) => `${name}: ${value}`)
    .join(" · ");

const mapProduct = (product) => product ? {
    id: toNumber(product.id),
    name: product.name,
    image: product.image,
    description: product.description,
    isDeleted: Boolean(product.isDeleted),
    deletedAt: toIsoString(product.deletedAt)
} : undefined;

const mapCartItem = (item) => {
    const variant = item.variant;
    const product = mapProduct(variant?.product);
    const optionValues = variant ? optionValuesFor(variant) : {};
    const available = Boolean(variant && product) &&
        !product.isDeleted && Boolean(variant.isActive) && Number(variant.stock) > 0;
    const id = toNumber(item.variantId);
    const mappedVariant = variant ? {
        id: toNumber(variant.id),
        sku: variant.sku,
        price: toNumber(variant.price),
        stock: toNumber(variant.stock),
        isActive: Boolean(variant.isActive),
        optionValues
    } : {
        id,
        sku: null,
        price: 0,
        stock: 0,
        isActive: false,
        optionValues: {}
    };
    return {
        variantId: id,
        productId: product?.id ?? null,
        quantity: toNumber(item.quantity),
        name: product?.name || "Sản phẩm không tồn tại",
        variantLabel: variantLabel(optionValues),
        sku: mappedVariant.sku,
        optionValues,
        image: product?.image || null,
        description: product?.description || null,
        price: mappedVariant.price,
        stock: mappedVariant.stock,
        product: product || {
            id: null,
            name: "Sản phẩm không tồn tại",
            image: null,
            description: null,
            isDeleted: true,
            deletedAt: null
        },
        variant: mappedVariant,
        available,
        unavailableReason: available
            ? null
            : product?.isDeleted
                ? "soft_deleted"
                : variant
                    ? variant.isActive ? "out_of_stock" : "variant_unavailable"
                    : "not_found"
    };
};

const includeItems = {
    items: {
        orderBy: { variantId: "asc" },
        include: {
            variant: {
                include: {
                    product: true,
                    optionValues: {
                        include: {
                            optionValue: { include: { option: true } }
                        }
                    }
                }
            }
        }
    }
};

const mapCart = (cart) => ({
    id: cart.id,
    userId: cart.userId,
    items: (cart.items || []).map(mapCartItem),
    createdAt: toIsoString(cart.createdAt),
    updatedAt: toIsoString(cart.updatedAt)
});

const newCartId = () => crypto.randomUUID();

const ensureCart = async (client, userId) => client.cart.upsert({
    where: { userId },
    create: { id: newCartId(), userId },
    update: {}
});

const readCart = async (client, userId) => {
    await ensureCart(client, userId);
    const cart = await client.cart.findUnique({
        where: { userId },
        include: includeItems
    });
    return mapCart(cart);
};

// SQL Server keeps UPDLOCK/HOLDLOCK until transaction completion.
const lockCart = async (transaction, userId) => {
    const rows = await transaction.$queryRaw`
        SELECT [id], [user_id] AS [userId], [created_at] AS [createdAt], [updated_at] AS [updatedAt]
        FROM [dbo].[carts] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        WHERE [user_id] = ${userId}
    `;
    return rows[0];
};

const lockVariant = async (transaction, variantId) => {
    const rows = await transaction.$queryRaw`
        SELECT
            variant.[id], variant.[product_id] AS [productId], variant.[sku],
            variant.[price], variant.[stock], variant.[is_active] AS [isActive],
            product.[name], product.[image], product.[description],
            product.[is_deleted] AS [isDeleted], product.[deleted_at] AS [deletedAt]
        FROM [dbo].[product_variants] AS variant WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        INNER JOIN [dbo].[products] AS product WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            ON product.[id] = variant.[product_id]
        WHERE variant.[id] = ${variantId}
    `;
    return rows[0] || null;
};

const readLockedCartItems = async (transaction, cartId) => transaction.cartItem.findMany({
    where: { cartId },
    orderBy: { variantId: "asc" },
    include: includeItems.items.include
});

const getCart = async (userId) => readCart(getPrismaClient(), userId);

const setQuantity = async (userId, variantId, quantity) => {
    const prisma = getPrismaClient();
    return prisma.$transaction(async (transaction) => {
        await ensureCart(transaction, userId);
        const cart = await lockCart(transaction, userId);
        const variant = await lockVariant(transaction, variantId);
        if (!variant) return { kind: "not_found" };
        if (Boolean(variant.isDeleted) || !Boolean(variant.isActive) || Number(variant.stock) <= 0) {
            return { kind: "unavailable", variant };
        }

        const finalQuantity = Math.min(quantity, Number(variant.stock));
        await transaction.cartItem.upsert({
            where: { cartId_variantId: { cartId: cart.id, variantId } },
            create: { cartId: cart.id, variantId, quantity: finalQuantity },
            update: { quantity: finalQuantity }
        });
        const items = await readLockedCartItems(transaction, cart.id);
        return {
            cart: mapCart({ ...cart, items }),
            adjustment: finalQuantity !== quantity
                ? { variantId, requestedQuantity: quantity, finalQuantity, reason: "stock_capped" }
                : null
        };
    });
};

const removeItem = async (userId, variantId) => {
    const prisma = getPrismaClient();
    return prisma.$transaction(async (transaction) => {
        await ensureCart(transaction, userId);
        const cart = await lockCart(transaction, userId);
        await transaction.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
        const items = await readLockedCartItems(transaction, cart.id);
        return mapCart({ ...cart, items });
    });
};

const isUniqueViolation = (error) => error && error.code === "P2002";

const mergeInTransaction = async (transaction, userId, operationId, requestHash, normalizedItems) => {
    const existingOperation = await transaction.cartMergeOperation.findUnique({
        where: { operationId }
    });

    if (existingOperation) {
        if (existingOperation.userId !== userId || existingOperation.requestHash !== requestHash) {
            const error = new Error("Merge operation does not match the submitted request");
            error.code = "IDEMPOTENCY_CONFLICT";
            error.statusCode = 409;
            throw error;
        }
        if (existingOperation.status === "COMPLETED" && existingOperation.resultJson) {
            return JSON.parse(existingOperation.resultJson);
        }
    } else {
        await transaction.cartMergeOperation.create({
            data: {
                operationId,
                userId,
                requestHash,
                status: "IN_PROGRESS"
            }
        });
    }

    await ensureCart(transaction, userId);
    const cart = await lockCart(transaction, userId);
    const existingItems = await readLockedCartItems(transaction, cart.id);
    const existingByVariantId = new Map(existingItems.map((item) => [item.variantId, item]));
    const allVariantIds = [...new Set([
        ...existingItems.map((item) => item.variantId),
        ...normalizedItems.map((item) => item.variantId)
    ])].sort((left, right) => left - right);
    const variants = new Map();
    for (const variantId of allVariantIds) {
        variants.set(variantId, await lockVariant(transaction, variantId));
    }

    const adjustments = [];
    for (const { variantId, quantity: requestedQuantity } of normalizedItems) {
        const variant = variants.get(variantId);
        const existing = existingByVariantId.get(variantId);
        const existingQuantity = existing ? Number(existing.quantity) : 0;
        const requestedTotal = existingQuantity + requestedQuantity;
        if (!variant) {
            adjustments.push({ variantId, requestedQuantity: requestedTotal, finalQuantity: existingQuantity, reason: "not_found" });
            continue;
        }
        if (Boolean(variant.isDeleted)) {
            adjustments.push({ variantId, requestedQuantity: requestedTotal, finalQuantity: existingQuantity, reason: "soft_deleted" });
            continue;
        }
        if (!Boolean(variant.isActive)) {
            adjustments.push({ variantId, requestedQuantity: requestedTotal, finalQuantity: existingQuantity, reason: "variant_unavailable" });
            continue;
        }
        if (Number(variant.stock) <= 0) {
            adjustments.push({ variantId, requestedQuantity: requestedTotal, finalQuantity: existingQuantity, reason: "out_of_stock" });
            continue;
        }

        const finalQuantity = Math.min(requestedTotal, Number(variant.stock));
        await transaction.cartItem.upsert({
            where: { cartId_variantId: { cartId: cart.id, variantId } },
            create: { cartId: cart.id, variantId, quantity: finalQuantity },
            update: { quantity: finalQuantity }
        });
        if (finalQuantity !== requestedTotal) {
            adjustments.push({ variantId, requestedQuantity: requestedTotal, finalQuantity, reason: "stock_capped" });
        }
    }

    const items = await readLockedCartItems(transaction, cart.id);
    const result = {
        items: items.map(mapCartItem),
        adjustments
    };
    await transaction.cartMergeOperation.update({
        where: { operationId },
        data: {
            status: "COMPLETED",
            resultJson: JSON.stringify(result),
            completedAt: new Date()
        }
    });
    return result;
};

const mergeGuestCart = async (userId, operationId, requestHash, normalizedItems) => {
    const prisma = getPrismaClient();
    try {
        return await prisma.$transaction((transaction) =>
            mergeInTransaction(transaction, userId, operationId, requestHash, normalizedItems)
        );
    } catch (error) {
        if (isUniqueViolation(error)) {
            return prisma.$transaction((transaction) =>
                mergeInTransaction(transaction, userId, operationId, requestHash, normalizedItems)
            );
        }
        throw error;
    }
};

module.exports = {
    getCart,
    setQuantity,
    removeItem,
    mergeGuestCart,
    toVariantId,
    toQuantity
};
