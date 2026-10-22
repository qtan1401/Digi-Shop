require("dotenv").config();

const crypto = require("crypto");
const argon2 = require("argon2");
const sql = require("mssql");
const seedData = require("./seed-data");
const { readDatabaseConfig } = require("../src/db/config");

const DEFAULT_ADMIN_USERNAME = seedData.administrator.username;
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD;

const requiredDefaultAdminPassword = () => {
    if (typeof DEFAULT_ADMIN_PASSWORD !== "string" || !DEFAULT_ADMIN_PASSWORD) {
        throw new Error("ADMIN_DEFAULT_PASSWORD must be configured to create the default administrator");
    }
    return DEFAULT_ADMIN_PASSWORD;
};

async function ensureDefaultAdmin(transaction, password = requiredDefaultAdminPassword()) {
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
        const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
        const insert = transaction.request();
        insert.input("id", sql.NVarChar(36), crypto.randomUUID());
        insert.input("username", sql.NVarChar(64), DEFAULT_ADMIN_USERNAME);
        insert.input("passwordHash", sql.NVarChar(255), passwordHash);
        await insert.query(`
            INSERT INTO [dbo].[users]
                ([id], [username], [password_hash], [role], [status], [force_password_change])
            VALUES
                (@id, @username, @passwordHash, N'admin', N'ACTIVE', 1);
        `);
        return;
    }

    if (existing.role !== "admin") {
        throw new Error("Default admin username is already used by another account");
    }

    if (existing.passwordHash === null) {
        const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
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

const CLEAR_TABLES = [
    ["payment_attempts", "PaymentAttempt"],
    ["order_items", "OrderItem"],
    ["orders", "Order"],
    ["cart_items", "CartItem"],
    ["carts", "Cart"],
    ["cart_merge_operations", "CartMergeOperation"],
    ["oauth_identities", "OAuthIdentity"],
    ["refresh_sessions", "RefreshSession"],
    ["email_verification_tokens", "EmailVerificationToken"],
    ["product_variant_option_values", "ProductVariantOptionValue"],
    ["product_variants", "ProductVariant"],
    ["product_option_values", "ProductOptionValue"],
    ["product_options", "ProductOption"],
    ["products", "Product"],
    ["users", "User"],
    ["categories", "Category"],
    ["audit_logs", "AuditLog"]
];
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

const ENTITY_NAMES = ["products", "orders", "audits"];

function createSummary(normalized) {
    return {
        inserted: { products: 0, orders: 0, audits: 0, total: 0 },
        unchanged: { products: 0, orders: 0, audits: 0, total: 0 },
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


async function loadProductCandidates(transaction, products) {
    if (products.length === 0) return [];
    const request = transaction.request();
    const ids = bindList(request, "productId", sql.Int, products.map(({ id }) => id));
    const slugs = bindList(request, "productSlug", sql.NVarChar(240), products.map(({ slug }) => slug));
    const result = await request.query(`
        SELECT [id], [brand], [device_type] AS [deviceType], [name], [slug], [image],
               [description], [is_deleted] AS [isDeleted], [deleted_at] AS [deletedAt],
               [created_at] AS [createdAt], [updated_at] AS [updatedAt]
        FROM [dbo].[products] WITH (UPDLOCK, HOLDLOCK)
        WHERE [id] IN (${ids}) OR [slug] IN (${slugs});
    `);
    return result.recordset;
}
async function loadVariantSkuCandidates(transaction, products) {
    const skus = products.flatMap(({ variants }) => variants.map(({ sku }) => sku));
    if (skus.length === 0) return [];
    const request = transaction.request();
    const parameters = bindList(request, "variantSku", sql.NVarChar(100), skus);
    const result = await request.query(`
        SELECT [id], [product_id] AS [productId], [sku]
        FROM [dbo].[product_variants] WITH (UPDLOCK, HOLDLOCK)
        WHERE [sku] IN (${parameters});
    `);
    return result.recordset;
}
async function loadProductConfigurations(transaction, products, candidates) {
    const ids = candidates.map(({ id }) => id);
    if (ids.length === 0) return new Map();
    const request = transaction.request();
    const parameters = bindList(request, "configurationProduct", sql.Int, ids);
    const optionRows = (await request.query(`
        SELECT o.[product_id] AS [productId], o.[id] AS [optionId], o.[name], o.[position],
               v.[value], v.[color_hex] AS [colorHex], v.[position] AS [valuePosition]
        FROM [dbo].[product_options] o
        LEFT JOIN [dbo].[product_option_values] v
            ON v.[option_id] = o.[id] AND v.[is_active] = 1
        WHERE o.[product_id] IN (${parameters}) AND o.[is_active] = 1
        ORDER BY o.[position], v.[position];
    `)).recordset;
    const variantRequest = transaction.request();
    const variantIds = bindList(variantRequest, "variantProduct", sql.Int, ids);
    const variantRows = (await variantRequest.query(`
        SELECT v.[product_id] AS [productId], v.[sku], v.[price], v.[stock], v.[image], v.[is_active] AS [isActive],
               o.[name] AS [optionName], ov.[value] AS [optionValue]
        FROM [dbo].[product_variants] v
        LEFT JOIN [dbo].[product_variant_option_values] l ON l.[variant_id] = v.[id]
        LEFT JOIN [dbo].[product_option_values] ov
            ON ov.[id] = l.[option_value_id] AND ov.[is_active] = 1
        LEFT JOIN [dbo].[product_options] o
            ON o.[id] = ov.[option_id] AND o.[is_active] = 1
        WHERE v.[product_id] IN (${variantIds}) AND v.[is_active] = 1
        ORDER BY v.[id], o.[position];
    `)).recordset;
    const configurations = new Map(ids.map((id) => [id, { options: [], variants: new Map() }]));
    for (const row of optionRows) {
        const config = configurations.get(row.productId);
        let option = config.options.find(({ name }) => name === row.name);
        if (!option) {
            option = { name: row.name, position: row.position, values: [] };
            config.options.push(option);
        }
        if (row.value !== null && !option.values.some(({ value }) => value === row.value)) {
            option.values.push({ value: row.value, colorHex: row.colorHex || null, position: row.valuePosition });
        }
    }
    for (const row of variantRows) {
        const config = configurations.get(row.productId);
        let variant = config.variants.get(row.sku);
        if (!variant) {
            variant = {
                sku: row.sku,
                price: canonicalMoney(row.price, "price", `product:${row.productId}`),
                stock: row.stock,
                image: row.image || null,
                isActive: Boolean(row.isActive),
                optionValues: {}
            };
            config.variants.set(row.sku, variant);
        }
        if (row.optionName !== null) variant.optionValues[row.optionName] = row.optionValue;
    }
    for (const config of configurations.values()) {
        config.options = config.options.map(({ name, values }) => ({ name, values: values.map(({ value, colorHex }) => ({ value, colorHex: colorHex || null })) }));
        config.variants = [...config.variants.values()].map(({ isActive, ...variant }) => variant);
    }
    return configurations;
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
        SELECT [id], [order_id] AS [orderId], [variant_id] AS [variantId],
               [name_snapshot] AS [name], [image_snapshot] AS [image], [sku_snapshot] AS [skuSnapshot],
               [options_snapshot] AS [optionsSnapshot], [unit_price] AS [unitPrice],
               [quantity], [line_total] AS [lineTotal]
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

function classifyProducts(seedRecords, existingRecords, existingVariants, existingConfigurations, conflicts, summary) {
    const byId = new Map(existingRecords.map((record) => [record.id, record]));
    const bySlug = new Map(existingRecords.map((record) => [comparisonKey(record.slug), record]));
    const bySku = new Map(existingVariants.map((record) => [comparisonKey(record.sku), record]));
    const inserts = [];
    for (const seed of seedRecords) {
        const owner = bySlug.get(comparisonKey(seed.slug));
        if (owner && owner.id !== seed.id) addConflict(conflicts, "product", seed.id, "slug", seed.slug, `owned by product:${owner.id}`);
        for (const variant of seed.variants) {
            const skuOwner = bySku.get(comparisonKey(variant.sku));
            if (skuOwner && skuOwner.productId !== seed.id) addConflict(conflicts, "product", seed.id, "sku", variant.sku, `owned by product:${skuOwner.productId}`);
        }
        const existing = byId.get(seed.id);
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        const canonical = { ...existing, deletedAt: canonicalDate(existing.deletedAt), isDeleted: Boolean(existing.isDeleted) };
        compareFields(conflicts, "product", seed.id, seed, canonical, [
            "brand", "deviceType", "name", "slug", "image", "description", "isDeleted", "deletedAt"
        ]);
        const actualConfiguration = existingConfigurations.get(seed.id);
        const expectedConfiguration = {
            options: seed.options,
            variants: seed.variants.map((variant) => ({
                ...variant,
                price: canonicalMoney(variant.price, "price", `product:${seed.id}`)
            })).sort((left, right) => left.sku.localeCompare(right.sku))
        };
        const normalizedActual = {
            options: actualConfiguration.options,
            variants: actualConfiguration.variants.sort((left, right) => left.sku.localeCompare(right.sku))
        };
        if (stableJson(expectedConfiguration, `product:${seed.id}`) !== stableJson(normalizedActual, `product:${seed.id}`)) {
            addConflict(conflicts, "product", seed.id, "configuration", expectedConfiguration, normalizedActual);
        }
        if (!conflicts.some(({ identity }) => identity === `product:${seed.id}`)) summary.unchanged.products += 1;
    }
    return inserts;
}
function resolveSeedOrderItems(products, orders) {
    const bySku = new Map();
    for (const product of products) {
        for (const variant of product.variants) {
            bySku.set(comparisonKey(variant.sku), { product, variant });
        }
    }
    return orders.map((order) => ({
        ...order,
        items: order.items.map((item, index) => {
            const resolved = bySku.get(comparisonKey(item.variantSku));
            if (!resolved) throw new SeedDataError(`order:${order.id}/item:${index}`, `variantSku ${item.variantSku} is not present in the product seed`);
            const { product, variant } = resolved;
            if (canonicalMoney(item.unitPrice, "unitPrice", `order:${order.id}`) !== canonicalMoney(variant.price, "price", `product:${product.id}`)) {
                throw new SeedDataError(`order:${order.id}/item:${index}`, "unitPrice must equal the referenced variant price");
            }
            return {
                ...item,
                name: product.name,
                image: product.image,
                optionsSnapshot: stableJson(variant.optionValues, `order:${order.id}/item:${index}`)
            };
        })
    }));
}

function canonicalOrderItems(items) {
    return items.map((item) => ({
        skuSnapshot: item.skuSnapshot || item.variantSku,
        optionsSnapshot: stableJson(JSON.parse(item.optionsSnapshot || "{}"), `order:${item.orderId}`),
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


async function insertProducts(transaction, records) {
    for (const record of records) {
        const request = transaction.request();
        request.input("id", sql.Int, record.id);
        request.input("brand", sql.NVarChar(16), record.brand);
        request.input("deviceType", sql.NVarChar(16), record.deviceType);
        request.input("name", sql.NVarChar(200), record.name);
        request.input("slug", sql.NVarChar(240), record.slug);
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
                    ([id], [brand], [device_type], [name], [slug], [image], [description], [is_deleted], [deleted_at], [created_at], [updated_at])
                VALUES
                    (@id, @brand, @deviceType, @name, @slug, @image, @description, @isDeleted, @deletedAt, @createdAt, @updatedAt);
                SET IDENTITY_INSERT [dbo].[products] OFF;
            END TRY
            BEGIN CATCH
                SET IDENTITY_INSERT [dbo].[products] OFF;
                THROW;
            END CATCH;
        `);
        const valueIdsByOption = new Map();
        for (const [optionPosition, option] of record.options.entries()) {
            const optionRequest = transaction.request();
            optionRequest.input("productId", sql.Int, record.id);
            optionRequest.input("name", sql.NVarChar(100), option.name);
            optionRequest.input("position", sql.Int, optionPosition);
            const optionResult = await optionRequest.query(`
                INSERT INTO [dbo].[product_options] ([product_id], [name], [position], [is_active])
                OUTPUT INSERTED.[id] AS [id] VALUES (@productId, @name, @position, 1);
            `);
            const optionId = optionResult.recordset[0].id;
            const valueIds = new Map();
            for (const [position, entry] of option.values.entries()) {
                const valueRequest = transaction.request();
                valueRequest.input("optionId", sql.Int, optionId);
                valueRequest.input("value", sql.NVarChar(100), entry.value);
                valueRequest.input("colorHex", sql.NVarChar(7), entry.colorHex || null);
                valueRequest.input("position", sql.Int, position);
                const valueResult = await valueRequest.query(`
                    INSERT INTO [dbo].[product_option_values] ([option_id], [value], [color_hex], [position], [is_active])
                    OUTPUT INSERTED.[id] AS [id] VALUES (@optionId, @value, @colorHex, @position, 1);
                `);
                valueIds.set(comparisonKey(entry.value), valueResult.recordset[0].id);
            }
            valueIdsByOption.set(comparisonKey(option.name), valueIds);
        }
        for (const variant of record.variants) {
            const valueIds = Object.entries(variant.optionValues).map(([name, value]) =>
                valueIdsByOption.get(comparisonKey(name)).get(comparisonKey(value)));
            const combinationKey = crypto.createHash("sha256")
                .update(JSON.stringify([...valueIds].sort((left, right) => left - right))).digest("hex").toUpperCase();
            const variantRequest = transaction.request();
            variantRequest.input("productId", sql.Int, record.id);
            variantRequest.input("sku", sql.NVarChar(100), variant.sku);
            variantRequest.input("combinationKey", sql.Char(64), combinationKey);
            variantRequest.input("price", sql.Decimal(18, 2), variant.price);
            variantRequest.input("stock", sql.Int, variant.stock);
            variantRequest.input("image", sql.NVarChar(500), variant.image || null);
            const result = await variantRequest.query(`
                INSERT INTO [dbo].[product_variants] ([product_id], [sku], [combination_key], [price], [stock], [image], [is_active])
                OUTPUT INSERTED.[id] AS [id] VALUES (@productId, @sku, @combinationKey, @price, @stock, @image, 1);
            `);
            for (const optionValueId of valueIds) {
                const linkRequest = transaction.request();
                linkRequest.input("variantId", sql.Int, result.recordset[0].id);
                linkRequest.input("optionValueId", sql.Int, optionValueId);
                await linkRequest.query(`
                    INSERT INTO [dbo].[product_variant_option_values] ([variant_id], [option_value_id])
                    VALUES (@variantId, @optionValueId);
                `);
            }
        }
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
            const variantLookup = transaction.request();
            variantLookup.input("sku", sql.NVarChar(100), item.variantSku);
            const variant = await variantLookup.query(`
                SELECT [id] FROM [dbo].[product_variants] WITH (UPDLOCK, HOLDLOCK) WHERE [sku] = @sku;
            `);
            if (variant.recordset.length !== 1) throw new Error(`Seed order variant ${item.variantSku} could not be resolved`);
            const itemRequest = transaction.request();
            itemRequest.input("orderId", sql.NVarChar(64), record.id);
            itemRequest.input("variantId", sql.Int, variant.recordset[0].id);
            itemRequest.input("name", sql.NVarChar(200), item.name);
            itemRequest.input("image", sql.NVarChar(500), item.image);
            itemRequest.input("skuSnapshot", sql.NVarChar(100), item.variantSku);
            itemRequest.input("optionsSnapshot", sql.NVarChar(sql.MAX), item.optionsSnapshot);
            itemRequest.input("unitPrice", sql.Decimal(18, 2), item.unitPrice);
            itemRequest.input("quantity", sql.Int, item.quantity);
            itemRequest.input("lineTotal", sql.Decimal(18, 2), item.lineTotal);
            await itemRequest.query(`
                INSERT INTO [dbo].[order_items]
                    ([order_id], [variant_id], [name_snapshot], [image_snapshot], [sku_snapshot], [options_snapshot],
                     [unit_price], [quantity], [line_total])
                VALUES (@orderId, @variantId, @name, @image, @skuSnapshot, @optionsSnapshot, @unitPrice, @quantity, @lineTotal);
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
    if (!Array.isArray(seedData.commerce.products) || !Array.isArray(seedData.commerce.orders) || !Array.isArray(seedData.commerce.audits)) {
        throw new Error("Normal seed data must export commerce entity arrays");
    }
    const normalized = normalizeSeedData({
        products: seedData.commerce.products,
        orders: seedData.commerce.orders,
        audits: seedData.commerce.audits
    });
    normalized.orders = resolveSeedOrderItems(normalized.products, normalized.orders);
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

        const existingProducts = await loadProductCandidates(transaction, normalized.products);
        const existingVariants = await loadVariantSkuCandidates(transaction, normalized.products);
        const existingConfigurations = await loadProductConfigurations(transaction, normalized.products, existingProducts);
        const existingOrderData = await loadOrderCandidates(transaction, normalized.orders);
        const existingAudits = await loadAuditCandidates(transaction, normalized.audits);

        const conflicts = [];
        const productInserts = classifyProducts(
            normalized.products, existingProducts, existingVariants, existingConfigurations, conflicts, summary
        );
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

        await insertProducts(transaction, productInserts);
        await insertOrders(transaction, orderInserts);
        await insertAudits(transaction, auditInserts);

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

const countRecords = async (transaction, table) => {
    const result = await transaction.request().query(`SELECT COUNT_BIG(*) AS [count] FROM [dbo].[${table}];`);
    return Number(result.recordset[0].count);
};

async function clearStore(transaction, password) {
    for (const [table] of CLEAR_TABLES) {
        if (table === "refresh_sessions") {
            await transaction.request().query("UPDATE [dbo].[refresh_sessions] SET [replaced_by_id] = NULL;");
        }
        await transaction.request().query(`DELETE FROM [dbo].[${table}];`);
    }
    await ensureDefaultAdmin(transaction, password);
    const after = {};
    for (const [table] of CLEAR_TABLES) after[table] = await countRecords(transaction, table);
    const adminResult = await transaction.request().query(`
        SELECT [username], [role], [force_password_change]
        FROM [dbo].[users];
    `);
    if (
        adminResult.recordset.length !== 1
        || adminResult.recordset[0].username !== DEFAULT_ADMIN_USERNAME
        || adminResult.recordset[0].role !== "admin"
        || !adminResult.recordset[0].force_password_change
    ) {
        throw new Error("Reset did not produce exactly one first-login administrator");
    }
    return after;
}

const requireLocalTarget = (environment) => {
    const config = readDatabaseConfig(environment);
    if (!/^localhost$/i.test(config.mssql.server) || config.mssql.port !== 1433 || config.databaseName !== "DigiShop") {
        throw new Error("Store reset is restricted to localhost:1433 database DigiShop");
    }
    return config;
};

const requireResetPassword = (environment) => {
    const password = environment.ADMIN_DEFAULT_PASSWORD;
    if (typeof password !== "string" || password.length < 16) {
        throw new Error("ADMIN_DEFAULT_PASSWORD must be freshly configured and at least 16 characters");
    }
    return password;
};

async function resetDatabase({ environment = process.env, confirmation = environment.STORE_RESET_CONFIRMATION } = {}) {
    const config = requireLocalTarget(environment);
    if (confirmation !== "RESET LOCAL DIGISHOP") {
        throw new Error("Set STORE_RESET_CONFIRMATION=RESET LOCAL DIGISHOP to confirm the destructive reset");
    }
    const password = requireResetPassword(environment);

    const pool = new sql.ConnectionPool({
        ...config.mssql,
        pool: { ...config.mssql.pool },
        options: { ...config.mssql.options }
    });
    let transaction;
    let transactionOpen = false;
    try {
        await pool.connect();
        transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        transactionOpen = true;
        const before = {};
        for (const [table] of CLEAR_TABLES) before[table] = await countRecords(transaction, table);
        const after = await clearStore(transaction, password);
        await transaction.commit();
        transactionOpen = false;
        return { database: config.databaseName, server: `${config.mssql.server}:${config.mssql.port}`, before, after };
    } catch (error) {
        if (transactionOpen) {
            try {
                await transaction.rollback();
            } catch {
                // Preserve the triggering error.
            }
        }
        throw error;
    } finally {
        if (pool.connected || pool.connecting) await pool.close();
    }
}

async function verifyResetRollback({
    environment = process.env,
    confirmation = environment.STORE_RESET_ROLLBACK_CONFIRMATION
} = {}) {
    const config = requireLocalTarget(environment);
    if (confirmation !== "ROLLBACK CHECK LOCAL DIGISHOP") {
        throw new Error("Set STORE_RESET_ROLLBACK_CONFIRMATION=ROLLBACK CHECK LOCAL DIGISHOP to confirm rollback check");
    }
    const password = requireResetPassword(environment);
    const pool = new sql.ConnectionPool({
        ...config.mssql,
        pool: { ...config.mssql.pool },
        options: { ...config.mssql.options }
    });
    let transaction;
    let transactionOpen = false;
    try {
        await pool.connect();
        transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        transactionOpen = true;
        const before = {};
        for (const [table] of CLEAR_TABLES) before[table] = await countRecords(transaction, table);
        await clearStore(transaction, password);
        await transaction.rollback();
        transactionOpen = false;
        const after = {};
        for (const [table] of CLEAR_TABLES) after[table] = await countRecords(pool, table);
        if (CLEAR_TABLES.some(([table]) => before[table] !== after[table])) {
            throw new Error("Rollback verification failed: one or more table counts changed");
        }
        return {
            database: config.databaseName,
            server: `${config.mssql.server}:${config.mssql.port}`,
            outcome: "rolled back; no changes committed",
            before,
            after
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await transaction.rollback();
            } catch {
                // Preserve the triggering error.
            }
        }
        throw error;
    } finally {
        if (pool.connected || pool.connecting) await pool.close();
    }
}

async function resetMain() {
    try {
        const summary = await resetDatabase();
        console.log("Store reset committed:");
        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        console.error(`Store reset failed: ${error.message}`);
        process.exitCode = 1;
    }
}

async function rollbackCheckMain() {
    try {
        const summary = await verifyResetRollback();
        console.log("Store reset rollback verified; no changes committed:");
        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        console.error(`Store reset rollback check failed: ${error.message}`);
        process.exitCode = 1;
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
    const command = process.argv[2];
    if (command === "reset") resetMain();
    else if (command === "rollback-check") rollbackCheckMain();
    else if (!command) main();
    else {
        console.error("Usage: node prisma/seed.js [reset|rollback-check]");
        process.exitCode = 2;
    }
}

module.exports = {
    SeedConflictError,
    seedDatabase,
    resetDatabase,
    verifyResetRollback
};
