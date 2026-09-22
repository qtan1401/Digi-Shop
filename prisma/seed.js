require("dotenv").config();

const crypto = require("crypto");
const argon2 = require("argon2");
const sql = require("mssql");
const seedData = require("./seed-data");
const { readDatabaseConfig } = require("../src/db/config");

const DEFAULT_ADMIN_USERNAME = "admin123";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || "admin140105";

async function ensureDefaultAdmin(transaction) {
    const lookup = transaction.request();
    lookup.input("username", sql.NVarChar(64), DEFAULT_ADMIN_USERNAME);
    const result = await lookup.query(`
        SELECT TOP (1)
            [id],
            [role],
            [password_hash] AS [passwordHash]
        FROM [dbo].[users] WITH (UPDLOCK, HOLDLOCK)
        WHERE [username] = @username;
    `);
    const existing = result.recordset[0];

    if (!existing) {
        const passwordHash = await argon2.hash(DEFAULT_ADMIN_PASSWORD, { type: argon2.argon2id });
        const insert = transaction.request();
        insert.input("id", sql.NVarChar(36), crypto.randomUUID());
        insert.input("username", sql.NVarChar(64), DEFAULT_ADMIN_USERNAME);
        insert.input("passwordHash", sql.NVarChar(255), passwordHash);
        await insert.query(`
            INSERT INTO [dbo].[users]
                ([id], [username], [password_hash], [role], [status], [force_password_change])
            VALUES
                (@id, @username, @passwordHash, N'admin', N'ACTIVE', 0);
        `);
        return;
    }

    if (existing.role !== "admin") {
        throw new Error("Default admin username is already used by another account");
    }

    if (existing.passwordHash === null) {
        const passwordHash = await argon2.hash(DEFAULT_ADMIN_PASSWORD, { type: argon2.argon2id });
        const update = transaction.request();
        update.input("id", sql.NVarChar(36), existing.id);
        update.input("passwordHash", sql.NVarChar(255), passwordHash);
        await update.query(`
            UPDATE [dbo].[users]
            SET [password_hash] = @passwordHash
            WHERE [id] = @id
              AND [password_hash] IS NULL;
        `);
    }
}
const {
    SeedDataError,
    decimalToCents,
    normalizeSeedData,
    redactedChanges,
    redactValue,
    stableJson
} = require("../scripts/db/normalize-seed");

class SeedConflictError extends Error {
    constructor(conflicts, summary) {
        super(`Seed conflicts detected (${conflicts.length}); no records were inserted`);
        this.name = "SeedConflictError";
        this.conflicts = conflicts;
        this.summary = summary;
    }
}

const ENTITY_NAMES = ["categories", "products", "orders", "audits"];

function createSummary(normalized) {
    return {
        inserted: { categories: 0, products: 0, orders: 0, audits: 0, total: 0 },
        unchanged: { categories: 0, products: 0, orders: 0, audits: 0, total: 0 },
        normalized: {
            records: normalized.normalizedRecords,
            fields: normalized.changes.length,
            changes: redactedChanges(normalized.changes)
        },
        conflicts: { count: 0, records: [] }
    };
}

function finalizeSummary(summary) {
    summary.inserted.total = ENTITY_NAMES.reduce((total, entity) => total + summary.inserted[entity], 0);
    summary.unchanged.total = ENTITY_NAMES.reduce((total, entity) => total + summary.unchanged[entity], 0);
    summary.conflicts.count = summary.conflicts.records.length;
    return summary;
}

function summarizeConflict(entity, id, field, expected, actual) {
    return {
        identity: `${entity}:${id}`,
        field,
        expected: redactValue(field, expected),
        actual: redactValue(field, actual)
    };
}

function addConflict(conflicts, entity, id, field, expected, actual) {
    const conflict = summarizeConflict(entity, id, field, expected, actual);
    const key = JSON.stringify(conflict);
    if (!conflicts.some((candidate) => JSON.stringify(candidate) === key)) {
        conflicts.push(conflict);
    }
}

function canonicalDate(value) {
    if (value === null || value === undefined) {
        return null;
    }
    return new Date(value).toISOString();
}

function canonicalMoney(value, field, identity) {
    const cents = decimalToCents(value, field, identity);
    const sign = cents < 0n ? "-" : "";
    const absolute = cents < 0n ? -cents : cents;
    return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function comparisonKey(value) {
    return value.normalize("NFKC").toLowerCase();
}

function compareFields(conflicts, entity, id, expected, actual, fields) {
    for (const field of fields) {
        if (!Object.is(expected[field], actual[field])) {
            addConflict(conflicts, entity, id, field, expected[field], actual[field]);
        }
    }
}

function bindList(request, prefix, type, values) {
    return values.map((value, index) => {
        const name = `${prefix}${index}`;
        request.input(name, type, value);
        return `@${name}`;
    }).join(", ");
}

async function loadCategoryCandidates(transaction, categories) {
    if (categories.length === 0) {
        return [];
    }
    const request = transaction.request();
    const ids = bindList(request, "categoryId", sql.Int, categories.map(({ id }) => id));
    const slugs = bindList(request, "categorySlug", sql.NVarChar(160), categories.map(({ slug }) => slug));
    const result = await request.query(`
        SELECT [id], [name], [slug], [description], [created_at] AS [createdAt]
        FROM [dbo].[categories] WITH (UPDLOCK, HOLDLOCK)
        WHERE [id] IN (${ids}) OR [slug] IN (${slugs});
    `);
    return result.recordset;
}

async function loadProductCandidates(transaction, products) {
    if (products.length === 0) {
        return [];
    }
    const request = transaction.request();
    const ids = bindList(request, "productId", sql.Int, products.map(({ id }) => id));
    const slugs = bindList(request, "productSlug", sql.NVarChar(240), products.map(({ slug }) => slug));
    const skus = bindList(request, "productSku", sql.NVarChar(100), products.map(({ sku }) => sku));
    const result = await request.query(`
        SELECT [id], [category_id] AS [categoryId], [name], [slug], [sku], [stock], [price], [image],
               [description], [is_deleted] AS [isDeleted], [deleted_at] AS [deletedAt],
               [created_at] AS [createdAt], [updated_at] AS [updatedAt]
        FROM [dbo].[products] WITH (UPDLOCK, HOLDLOCK)
        WHERE [id] IN (${ids}) OR [slug] IN (${slugs}) OR [sku] IN (${skus});
    `);
    return result.recordset;
}

async function loadOrderCandidates(transaction, orders) {
    if (orders.length === 0) {
        return { orders: [], items: [] };
    }
    const orderRequest = transaction.request();
    const ids = bindList(orderRequest, "orderId", sql.NVarChar(64), orders.map(({ id }) => id));
    const orderResult = await orderRequest.query(`
        SELECT [id], [subtotal], [shipping_fee] AS [shippingFee], [discount], [total_price] AS [totalPrice],
               [customer_name] AS [customerName], [customer_phone] AS [customerPhone],
               [customer_address] AS [customerAddress], [customer_note] AS [customerNote],
               [payment_method] AS [paymentMethod], [order_status] AS [orderStatus],
               [payment_status] AS [paymentStatus], [created_at] AS [createdAt], [updated_at] AS [updatedAt]
        FROM [dbo].[orders] WITH (UPDLOCK, HOLDLOCK)
        WHERE [id] IN (${ids});
    `);

    const itemRequest = transaction.request();
    const itemIds = bindList(itemRequest, "itemOrderId", sql.NVarChar(64), orders.map(({ id }) => id));
    const itemResult = await itemRequest.query(`
        SELECT [id], [order_id] AS [orderId], [product_id] AS [productId], [name_snapshot] AS [name],
               [image_snapshot] AS [image], [unit_price] AS [unitPrice], [quantity], [line_total] AS [lineTotal]
        FROM [dbo].[order_items] WITH (UPDLOCK, HOLDLOCK)
        WHERE [order_id] IN (${itemIds});
    `);
    return { orders: orderResult.recordset, items: itemResult.recordset };
}

async function loadAuditCandidates(transaction, audits) {
    if (audits.length === 0) {
        return [];
    }
    const request = transaction.request();
    const ids = bindList(request, "auditId", sql.NVarChar(80), audits.map(({ id }) => id));
    const result = await request.query(`
        SELECT [id], [actor], [action], [entity], [entity_id] AS [entityId],
               [changes_json] AS [changesJson], [timestamp]
        FROM [dbo].[audit_logs] WITH (UPDLOCK, HOLDLOCK)
        WHERE [id] IN (${ids});
    `);
    return result.recordset;
}

function classifyCategories(seedRecords, existingRecords, conflicts, summary) {
    const byId = new Map(existingRecords.map((record) => [record.id, record]));
    const bySlug = new Map(existingRecords.map((record) => [comparisonKey(record.slug), record]));
    const inserts = [];

    for (const seed of seedRecords) {
        const slugOwner = bySlug.get(comparisonKey(seed.slug));
        if (slugOwner && slugOwner.id !== seed.id) {
            addConflict(conflicts, "category", seed.id, "slug", seed.slug, `owned by category:${slugOwner.id}`);
        }
        const existing = byId.get(seed.id);
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        compareFields(conflicts, "category", seed.id, seed, existing, ["name", "slug", "description"]);
        if (!conflicts.some(({ identity }) => identity === `category:${seed.id}`)) {
            summary.unchanged.categories += 1;
        }
    }
    return inserts;
}

function classifyProducts(seedRecords, existingRecords, conflicts, summary) {
    const byId = new Map(existingRecords.map((record) => [record.id, record]));
    const bySlug = new Map(existingRecords.map((record) => [comparisonKey(record.slug), record]));
    const bySku = new Map(existingRecords.map((record) => [comparisonKey(record.sku), record]));
    const inserts = [];

    for (const seed of seedRecords) {
        for (const [field, owner] of [
            ["slug", bySlug.get(comparisonKey(seed.slug))],
            ["sku", bySku.get(comparisonKey(seed.sku))]
        ]) {
            if (owner && owner.id !== seed.id) {
                addConflict(conflicts, "product", seed.id, field, seed[field], `owned by product:${owner.id}`);
            }
        }
        const existing = byId.get(seed.id);
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        const canonical = {
            ...existing,
            price: canonicalMoney(existing.price, "price", `product:${seed.id}`),
            deletedAt: canonicalDate(existing.deletedAt),
            isDeleted: Boolean(existing.isDeleted)
        };
        compareFields(conflicts, "product", seed.id, seed, canonical, [
            "categoryId", "name", "slug", "sku", "stock", "price", "image", "description", "isDeleted", "deletedAt"
        ]);
        if (!conflicts.some(({ identity }) => identity === `product:${seed.id}`)) {
            summary.unchanged.products += 1;
        }
    }
    return inserts;
}

function canonicalOrderItems(items) {
    return items.map((item) => ({
        productId: item.productId,
        name: item.name,
        image: item.image,
        unitPrice: canonicalMoney(item.unitPrice, "unitPrice", `order:${item.orderId}`),
        quantity: item.quantity,
        lineTotal: canonicalMoney(item.lineTotal, "lineTotal", `order:${item.orderId}`)
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function classifyOrders(seedRecords, existingRecords, existingItems, conflicts, summary) {
    const byId = new Map(existingRecords.map((record) => [comparisonKey(record.id), record]));
    const itemsByOrder = new Map();
    for (const item of existingItems) {
        const key = comparisonKey(item.orderId);
        const items = itemsByOrder.get(key) || [];
        items.push(item);
        itemsByOrder.set(key, items);
    }
    const inserts = [];

    for (const seed of seedRecords) {
        const existing = byId.get(comparisonKey(seed.id));
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        const canonical = {
            ...existing,
            subtotal: canonicalMoney(existing.subtotal, "subtotal", `order:${seed.id}`),
            shippingFee: canonicalMoney(existing.shippingFee, "shippingFee", `order:${seed.id}`),
            discount: canonicalMoney(existing.discount, "discount", `order:${seed.id}`),
            totalPrice: canonicalMoney(existing.totalPrice, "totalPrice", `order:${seed.id}`)
        };
        compareFields(conflicts, "order", seed.id, seed, canonical, [
            "id", "subtotal", "shippingFee", "discount", "totalPrice", "customerName", "customerPhone",
            "customerAddress", "customerNote", "paymentMethod", "orderStatus", "paymentStatus"
        ]);
        const expectedItems = canonicalOrderItems(seed.items.map((item) => ({ ...item, orderId: seed.id })));
        const actualItems = canonicalOrderItems(itemsByOrder.get(comparisonKey(seed.id)) || []);
        if (JSON.stringify(expectedItems) !== JSON.stringify(actualItems)) {
            addConflict(conflicts, "order", seed.id, "items", expectedItems, actualItems);
        }
        if (!conflicts.some(({ identity }) => identity === `order:${seed.id}`)) {
            summary.unchanged.orders += 1;
        }
    }
    return inserts;
}

function canonicalChangesJson(value, identity) {
    try {
        return stableJson(JSON.parse(value), identity);
    } catch (error) {
        if (error instanceof SeedDataError || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
}

function classifyAudits(seedRecords, existingRecords, conflicts, summary) {
    const byId = new Map(existingRecords.map((record) => [comparisonKey(record.id), record]));
    const inserts = [];
    for (const seed of seedRecords) {
        const existing = byId.get(comparisonKey(seed.id));
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        const canonical = { ...existing, changesJson: canonicalChangesJson(existing.changesJson, `audit:${seed.id}`) };
        compareFields(conflicts, "audit", seed.id, seed, canonical, ["id", "actor", "action", "entity", "entityId", "changesJson"]);
        if (!conflicts.some(({ identity }) => identity === `audit:${seed.id}`)) {
            summary.unchanged.audits += 1;
        }
    }
    return inserts;
}

async function insertCategories(transaction, records) {
    for (const record of records) {
        const request = transaction.request();
        request.input("id", sql.Int, record.id);
        request.input("name", sql.NVarChar(100), record.name);
        request.input("slug", sql.NVarChar(160), record.slug);
        request.input("description", sql.NVarChar(1000), record.description);
        request.input("createdAt", sql.DateTime2(3), new Date(record.createdAt));
        await request.query(`
            SET IDENTITY_INSERT [dbo].[categories] ON;
            BEGIN TRY
                INSERT INTO [dbo].[categories] ([id], [name], [slug], [description], [created_at])
                VALUES (@id, @name, @slug, @description, @createdAt);
                SET IDENTITY_INSERT [dbo].[categories] OFF;
            END TRY
            BEGIN CATCH
                SET IDENTITY_INSERT [dbo].[categories] OFF;
                THROW;
            END CATCH;
        `);
    }
}

async function insertProducts(transaction, records) {
    for (const record of records) {
        const request = transaction.request();
        request.input("id", sql.Int, record.id);
        request.input("categoryId", sql.Int, record.categoryId);
        request.input("name", sql.NVarChar(200), record.name);
        request.input("slug", sql.NVarChar(240), record.slug);
        request.input("sku", sql.NVarChar(100), record.sku);
        request.input("stock", sql.Int, record.stock);
        request.input("price", sql.Decimal(18, 2), record.price);
        request.input("image", sql.NVarChar(500), record.image);
        request.input("description", sql.NVarChar(sql.MAX), record.description);
        request.input("isDeleted", sql.Bit, record.isDeleted);
        request.input("deletedAt", sql.DateTime2(3), record.deletedAt ? new Date(record.deletedAt) : null);
        request.input("createdAt", sql.DateTime2(3), new Date(record.createdAt));
        request.input("updatedAt", sql.DateTime2(3), new Date(record.updatedAt));
        await request.query(`
            SET IDENTITY_INSERT [dbo].[products] ON;
            BEGIN TRY
                INSERT INTO [dbo].[products]
                    ([id], [category_id], [name], [slug], [sku], [stock], [price], [image], [description],
                     [is_deleted], [deleted_at], [created_at], [updated_at])
                VALUES
                    (@id, @categoryId, @name, @slug, @sku, @stock, @price, @image, @description,
                     @isDeleted, @deletedAt, @createdAt, @updatedAt);
                SET IDENTITY_INSERT [dbo].[products] OFF;
            END TRY
            BEGIN CATCH
                SET IDENTITY_INSERT [dbo].[products] OFF;
                THROW;
            END CATCH;
        `);
    }
}

async function insertOrders(transaction, records) {
    for (const record of records) {
        const request = transaction.request();
        request.input("id", sql.NVarChar(64), record.id);
        request.input("subtotal", sql.Decimal(18, 2), record.subtotal);
        request.input("shippingFee", sql.Decimal(18, 2), record.shippingFee);
        request.input("discount", sql.Decimal(18, 2), record.discount);
        request.input("totalPrice", sql.Decimal(18, 2), record.totalPrice);
        request.input("customerName", sql.NVarChar(200), record.customerName);
        request.input("customerPhone", sql.NVarChar(32), record.customerPhone);
        request.input("customerAddress", sql.NVarChar(500), record.customerAddress);
        request.input("customerNote", sql.NVarChar(1000), record.customerNote);
        request.input("paymentMethod", sql.NVarChar(64), record.paymentMethod);
        request.input("orderStatus", sql.NVarChar(32), record.orderStatus);
        request.input("paymentStatus", sql.NVarChar(32), record.paymentStatus);
        request.input("createdAt", sql.DateTime2(3), new Date(record.createdAt));
        request.input("updatedAt", sql.DateTime2(3), new Date(record.updatedAt));
        await request.query(`
            INSERT INTO [dbo].[orders]
                ([id], [subtotal], [shipping_fee], [discount], [total_price], [customer_name], [customer_phone],
                 [customer_address], [customer_note], [payment_method], [order_status], [payment_status], [created_at], [updated_at])
            VALUES
                (@id, @subtotal, @shippingFee, @discount, @totalPrice, @customerName, @customerPhone,
                 @customerAddress, @customerNote, @paymentMethod, @orderStatus, @paymentStatus, @createdAt, @updatedAt);
        `);

        for (const item of record.items) {
            const itemRequest = transaction.request();
            itemRequest.input("orderId", sql.NVarChar(64), record.id);
            itemRequest.input("productId", sql.Int, item.productId);
            itemRequest.input("name", sql.NVarChar(200), item.name);
            itemRequest.input("image", sql.NVarChar(500), item.image);
            itemRequest.input("unitPrice", sql.Decimal(18, 2), item.unitPrice);
            itemRequest.input("quantity", sql.Int, item.quantity);
            itemRequest.input("lineTotal", sql.Decimal(18, 2), item.lineTotal);
            await itemRequest.query(`
                INSERT INTO [dbo].[order_items]
                    ([order_id], [product_id], [name_snapshot], [image_snapshot], [unit_price], [quantity], [line_total])
                VALUES (@orderId, @productId, @name, @image, @unitPrice, @quantity, @lineTotal);
            `);
        }
    }
}

async function insertAudits(transaction, records) {
    for (const record of records) {
        const request = transaction.request();
        request.input("id", sql.NVarChar(80), record.id);
        request.input("actor", sql.NVarChar(120), record.actor);
        request.input("action", sql.NVarChar(40), record.action);
        request.input("entity", sql.NVarChar(40), record.entity);
        request.input("entityId", sql.NVarChar(80), record.entityId);
        request.input("changesJson", sql.NVarChar(sql.MAX), record.changesJson);
        request.input("timestamp", sql.DateTime2(3), new Date(record.timestamp));
        await request.query(`
            INSERT INTO [dbo].[audit_logs]
                ([id], [actor], [action], [entity], [entity_id], [changes_json], [timestamp])
            VALUES (@id, @actor, @action, @entity, @entityId, @changesJson, @timestamp);
        `);
    }
}

async function seedDatabase() {
    const normalized = normalizeSeedData(seedData);
    const summary = createSummary(normalized);
    const { mssql } = readDatabaseConfig();
    const pool = new sql.ConnectionPool({
        ...mssql,
        pool: { ...mssql.pool },
        options: { ...mssql.options }
    });
    let transaction;
    let transactionOpen = false;

    try {
        await pool.connect();
        transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        transactionOpen = true;
        await ensureDefaultAdmin(transaction);

        const existingCategories = await loadCategoryCandidates(transaction, normalized.categories);
        const existingProducts = await loadProductCandidates(transaction, normalized.products);
        const existingOrderData = await loadOrderCandidates(transaction, normalized.orders);
        const existingAudits = await loadAuditCandidates(transaction, normalized.audits);

        const conflicts = [];
        const categoryInserts = classifyCategories(normalized.categories, existingCategories, conflicts, summary);
        const productInserts = classifyProducts(normalized.products, existingProducts, conflicts, summary);
        const orderInserts = classifyOrders(
            normalized.orders,
            existingOrderData.orders,
            existingOrderData.items,
            conflicts,
            summary
        );
        const auditInserts = classifyAudits(normalized.audits, existingAudits, conflicts, summary);

        if (conflicts.length > 0) {
            summary.conflicts.records = conflicts;
            throw new SeedConflictError(conflicts, finalizeSummary(summary));
        }

        await insertCategories(transaction, categoryInserts);
        await insertProducts(transaction, productInserts);
        await insertOrders(transaction, orderInserts);
        await insertAudits(transaction, auditInserts);

        summary.inserted.categories = categoryInserts.length;
        summary.inserted.products = productInserts.length;
        summary.inserted.orders = orderInserts.length;
        summary.inserted.audits = auditInserts.length;

        await transaction.commit();
        transactionOpen = false;
        return finalizeSummary(summary);
    } catch (error) {
        if (transactionOpen) {
            try {
                await transaction.rollback();
            } catch {
                // The original error remains the actionable failure; closing the pool discards the session.
            }
            transactionOpen = false;
        }
        throw error;
    } finally {
        if (pool.connected || pool.connecting) {
            await pool.close();
        }
    }
}

async function main() {
    try {
        const summary = await seedDatabase();
        console.log("Seed summary (sensitive fields redacted):");
        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        if (error instanceof SeedConflictError) {
            console.error("Seed summary (sensitive fields redacted):");
            console.error(JSON.stringify(error.summary, null, 2));
            console.error(error.message);
        } else if (error instanceof SeedDataError) {
            console.error(error.message);
        } else {
            const code = typeof error.code === "string" ? error.code : "UNKNOWN";
            console.error(`Seed failed [${error.name || "Error"}:${code}]. No committed seed changes.`);
        }
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    SeedConflictError,
    seedDatabase
};
