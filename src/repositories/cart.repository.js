// ===== CART REPOSITORY =====
// Owns account-cart persistence and the SQL Server transaction used by Guest merge.
// Cart mutations never reserve stock; checkout revalidates stock independently.

const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");

const toProductId = (value) => {
    const productId = Number(value);
    return Number.isInteger(productId) && productId > 0 ? productId : null;
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

const mapProduct = (product) => product
    ? {
        id: toNumber(product.id),
        name: product.name,
        image: product.image,
        description: product.description,
        price: toNumber(product.price),
        stock: toNumber(product.stock),
        isDeleted: Boolean(product.isDeleted),
        deletedAt: toIsoString(product.deletedAt)
    }
    : undefined;

const mapCartItem = (item) => {
    const product = mapProduct(item.product);
    const available = Boolean(product) && !product.isDeleted && product.stock > 0;
    return {
        productId: toNumber(item.productId),
        quantity: toNumber(item.quantity),
        product: product || {
            id: toNumber(item.productId),
            name: "Sản phẩm không tồn tại",
            image: null,
            description: null,
            price: 0,
            stock: 0,
            isDeleted: true,
            deletedAt: null
        },
        available,
        unavailableReason: available
            ? null
            : product && product.isDeleted
                ? "soft_deleted"
                : product
                    ? "out_of_stock"
                    : "not_found"
    };
};

const includeItems = {
    items: {
        orderBy: { productId: "asc" },
        include: { product: true }
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

// SQL Server keeps UPDLOCK/HOLDLOCK until the interactive transaction commits.
// Cart is always locked before product rows; product IDs are then locked ascending.
const lockCart = async (transaction, userId) => {
    const rows = await transaction.$queryRaw`
        SELECT [id], [user_id] AS [userId], [created_at] AS [createdAt], [updated_at] AS [updatedAt]
        FROM [dbo].[carts] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        WHERE [user_id] = ${userId}
    `;
    return rows[0];
};

const lockProduct = async (transaction, productId) => {
    const rows = await transaction.$queryRaw`
        SELECT
            [id], [name], [image], [description], [price], [stock],
            [is_deleted] AS [isDeleted], [deleted_at] AS [deletedAt]
        FROM [dbo].[products] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
        WHERE [id] = ${productId}
    `;
    return rows[0] || null;
};

const readLockedCartItems = async (transaction, cartId) => transaction.cartItem.findMany({
    where: { cartId },
    orderBy: { productId: "asc" },
    include: { product: true }
});

const getCart = async (userId) => readCart(getPrismaClient(), userId);

const setQuantity = async (userId, productId, quantity) => {
    const prisma = getPrismaClient();
    return prisma.$transaction(async (transaction) => {
        await ensureCart(transaction, userId);
        const cart = await lockCart(transaction, userId);
        const product = await lockProduct(transaction, productId);
        if (!product) return { kind: "not_found" };
        if (Boolean(product.isDeleted) || Number(product.stock) <= 0) {
            return { kind: "unavailable", product: mapProduct(product) };
        }

        const finalQuantity = Math.min(quantity, Number(product.stock));
        await transaction.cartItem.upsert({
            where: { cartId_productId: { cartId: cart.id, productId } },
            create: { cartId: cart.id, productId, quantity: finalQuantity },
            update: { quantity: finalQuantity }
        });
        const items = await readLockedCartItems(transaction, cart.id);
        return {
            cart: mapCart({ ...cart, items }),
            adjustment: finalQuantity !== quantity
                ? { productId, requestedQuantity: quantity, finalQuantity, reason: "stock_capped" }
                : null
        };
    });
};

const removeItem = async (userId, productId) => {
    const prisma = getPrismaClient();
    return prisma.$transaction(async (transaction) => {
        await ensureCart(transaction, userId);
        const cart = await lockCart(transaction, userId);
        await transaction.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
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
    const existingByProductId = new Map(existingItems.map((item) => [item.productId, item]));
    const allProductIds = [...new Set([
        ...existingItems.map((item) => item.productId),
        ...normalizedItems.map((item) => item.productId)
    ])].sort((left, right) => left - right);
    const products = new Map();
    for (const productId of allProductIds) {
        products.set(productId, await lockProduct(transaction, productId));
    }

    const adjustments = [];
    for (const { productId, quantity: requestedQuantity } of normalizedItems) {
        const product = products.get(productId);
        const existing = existingByProductId.get(productId);
        if (!product) {
            adjustments.push({
                productId,
                requestedQuantity: (existing ? Number(existing.quantity) : 0) + requestedQuantity,
                finalQuantity: existing ? Number(existing.quantity) : 0,
                reason: "not_found"
            });
            continue;
        }
        if (Boolean(product.isDeleted)) {
            adjustments.push({
                productId,
                requestedQuantity: (existing ? Number(existing.quantity) : 0) + requestedQuantity,
                finalQuantity: existing ? Number(existing.quantity) : 0,
                reason: "soft_deleted"
            });
            continue;
        }
        if (Number(product.stock) <= 0) {
            adjustments.push({
                productId,
                requestedQuantity: (existing ? Number(existing.quantity) : 0) + requestedQuantity,
                finalQuantity: existing ? Number(existing.quantity) : 0,
                reason: "out_of_stock"
            });
            continue;
        }

        const requestedTotal = (existing ? Number(existing.quantity) : 0) + requestedQuantity;
        const finalQuantity = Math.min(requestedTotal, Number(product.stock));
        await transaction.cartItem.upsert({
            where: { cartId_productId: { cartId: cart.id, productId } },
            create: { cartId: cart.id, productId, quantity: finalQuantity },
            update: { quantity: finalQuantity }
        });
        if (finalQuantity !== requestedTotal) {
            adjustments.push({ productId, requestedQuantity: requestedTotal, finalQuantity, reason: "stock_capped" });
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
        // A concurrent request may win the operation's primary-key insert. Its
        // transaction is rolled back here; replay against committed state then
        // returns the canonical result instead of adding quantities twice.
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
    toProductId,
    toQuantity
};
