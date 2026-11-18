require("dotenv").config();

const crypto = require("crypto");
const argon2 = require("argon2");
const pg = require("pg");
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
    const result = await transaction.query(`
        SELECT id, role, password_hash AS "passwordHash"
        FROM users WHERE username = $1 FOR UPDATE;
    `, [DEFAULT_ADMIN_USERNAME]);
    const existing = result.rows[0];

    if (!existing) {
        const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
        await transaction.query(`
            INSERT INTO users (id, username, password_hash, role, status, force_password_change)
            VALUES ($1, $2, $3, 'admin', 'ACTIVE', true);
        `, [crypto.randomUUID(), DEFAULT_ADMIN_USERNAME, passwordHash]);
        return;
    }

    if (existing.role !== "admin") {
        throw new Error("Default admin username is already used by another account");
    }

    if (existing.passwordHash === null) {
        const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
        await transaction.query(`
            UPDATE users SET password_hash = $2
            WHERE id = $1 AND password_hash IS NULL;
        `, [existing.id, passwordHash]);
    }
}

function createPool(config) {
    return new pg.Pool({
        connectionString: config.connectionString,
        max: config.poolMax,
        ssl: config.ssl,
        options: "-c timezone=UTC",
        ...(config.connectionTimeout === undefined ? {} : { connectionTimeoutMillis: config.connectionTimeout })
    });
}

// Deletion order matters. order_status_history and user_addresses are listed explicitly (before their parents) so the
// reset reports their counts; password-reset / verification tokens that cascade from users need no entry of their own.
const CLEAR_TABLES = [
    ["order_vouchers", "OrderVoucher"],
    ["order_status_history", "OrderStatusHistory"],
    ["vouchers", "Voucher"],
    ["product_reviews", "ProductReview"],
    ["payment_attempts", "PaymentAttempt"],
    ["order_items", "OrderItem"],
    ["orders", "Order"],
    ["cart_items", "CartItem"],
    ["carts", "Cart"],
    ["cart_merge_operations", "CartMergeOperation"],
    ["oauth_identities", "OAuthIdentity"],
    ["refresh_sessions", "RefreshSession"],
    ["email_verification_tokens", "EmailVerificationToken"],
    ["user_addresses", "UserAddress"],
    ["product_images", "ProductImage"],
    ["product_variant_option_values", "ProductVariantOptionValue"],
    ["product_variants", "ProductVariant"],
    ["product_option_values", "ProductOptionValue"],
    ["product_options", "ProductOption"],
    ["products", "Product"],
    ["users", "User"],
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

const ENTITY_NAMES = ["products", "users", "vouchers", "orders", "orderVouchers", "reviews", "audits"];

function createSummary(normalized) {
    const counters = () => Object.fromEntries([...ENTITY_NAMES.map((entity) => [entity, 0]), ["total", 0]]);
    return {
        inserted: counters(),
        unchanged: counters(),
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

function bindList(values, parameters) {
    return values.map((value) => {
        parameters.push(value);
        return `$${parameters.length}`;
    }).join(", ");
}

async function loadProductCandidates(transaction, products) {
    if (products.length === 0) return [];
    const parameters = [];
    const ids = bindList(products.map(({ id }) => id), parameters);
    const slugs = bindList(products.map(({ slug }) => slug), parameters);
    const result = await transaction.query(`
        SELECT id, brand, device_type AS "deviceType", name, slug, image,
               description, is_deleted AS "isDeleted", deleted_at AS "deletedAt",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM products
        WHERE id IN (${ids}) OR slug IN (${slugs}) FOR UPDATE;
    `, parameters);
    return result.rows;
}
async function loadVariantSkuCandidates(transaction, products) {
    const skus = products.flatMap(({ variants }) => variants.map(({ sku }) => sku));
    if (skus.length === 0) return [];
    const parameters = [];
    const placeholders = bindList(skus, parameters);
    const result = await transaction.query(`
        SELECT id, product_id AS "productId", sku
        FROM product_variants WHERE sku IN (${placeholders}) FOR UPDATE;
    `, parameters);
    return result.rows;
}
async function loadProductConfigurations(transaction, products, candidates) {
    const ids = candidates.map(({ id }) => id);
    if (ids.length === 0) return new Map();
    const parameters = [];
    const placeholders = bindList(ids, parameters);
    const optionRows = (await transaction.query(`
        SELECT o.product_id AS "productId", o.id AS "optionId", o.name, o.position,
               v.value, v.color_hex AS "colorHex", v.position AS "valuePosition"
        FROM product_options o
        LEFT JOIN product_option_values v ON v.option_id = o.id AND v.is_active = true
        WHERE o.product_id IN (${placeholders}) AND o.is_active = true
        ORDER BY o.position, v.position;
    `, parameters)).rows;
    const variantRows = (await transaction.query(`
        SELECT v.product_id AS "productId", v.sku, v.price, v.cost_price AS "costPrice", v.stock, v.image, v.is_active AS "isActive",
               o.name AS "optionName", ov.value AS "optionValue"
        FROM product_variants v
        LEFT JOIN product_variant_option_values l ON l.variant_id = v.id
        LEFT JOIN product_option_values ov ON ov.id = l.option_value_id AND ov.is_active = true
        LEFT JOIN product_options o ON o.id = ov.option_id AND o.is_active = true
        WHERE v.product_id IN (${placeholders}) AND v.is_active = true
        ORDER BY v.id, o.position;
    `, parameters)).rows;
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
                costPrice: canonicalMoney(row.costPrice, "costPrice", `product:${row.productId}`),
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
    if (orders.length === 0) return { orders: [], items: [], vouchers: [] };
    const parameters = [];
    const ids = bindList(orders.map(({ id }) => id), parameters);
    const orderResult = await transaction.query(`
        SELECT id, user_id AS "userId", subtotal, shipping_fee AS "shippingFee", discount, total_price AS "totalPrice",
               customer_name AS "customerName", customer_phone AS "customerPhone",
               customer_address AS "customerAddress", customer_note AS "customerNote",
               payment_method AS "paymentMethod", order_status AS "orderStatus",
               payment_status AS "paymentStatus", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM orders WHERE id IN (${ids}) FOR UPDATE;
    `, parameters);
    const itemResult = await transaction.query(`
        SELECT id, order_id AS "orderId", variant_id AS "variantId",
               name_snapshot AS name, image_snapshot AS image, sku_snapshot AS "skuSnapshot",
               options_snapshot AS "optionsSnapshot", unit_price AS "unitPrice",
               quantity, line_total AS "lineTotal"
        FROM order_items WHERE order_id IN (${ids}) FOR UPDATE;
    `, parameters);
    const voucherResult = await transaction.query(`
        SELECT order_id AS "orderId", code_snapshot AS "codeSnapshot", type_snapshot AS "typeSnapshot",
               percent_snapshot AS "percentSnapshot", discount_amount AS "discountAmount"
        FROM order_vouchers WHERE order_id IN (${ids}) FOR UPDATE;
    `, parameters);
    return { orders: orderResult.rows, items: itemResult.rows, vouchers: voucherResult.rows };
}

async function loadUserCandidates(transaction, users) {
    if (users.length === 0) return [];
    const parameters = [];
    const ids = bindList(users.map(({ id }) => id), parameters);
    const emails = bindList(users.map(({ email }) => email), parameters);
    const usernames = bindList(users.map(({ username }) => username), parameters);
    const result = await transaction.query(`
        SELECT id, email, username, role, status
        FROM users WHERE id IN (${ids}) OR email IN (${emails}) OR username IN (${usernames}) FOR UPDATE;
    `, parameters);
    return result.rows;
}

async function loadVoucherCandidates(transaction, vouchers) {
    if (vouchers.length === 0) return [];
    const parameters = [];
    const codes = bindList(vouchers.map(({ code }) => code), parameters);
    const result = await transaction.query(`
        SELECT id, code, description, type, percent, max_discount AS "maxDiscount"
        FROM vouchers WHERE code IN (${codes}) FOR UPDATE;
    `, parameters);
    return result.rows;
}

async function loadReviewCandidates(transaction, reviews) {
    if (reviews.length === 0) return [];
    const parameters = [];
    const productIds = bindList([...new Set(reviews.map(({ productId }) => productId))], parameters);
    const userIds = bindList([...new Set(reviews.map(({ userId }) => userId))], parameters);
    const result = await transaction.query(`
        SELECT product_id AS "productId", user_id AS "userId", rating, comment
        FROM product_reviews WHERE product_id IN (${productIds}) AND user_id IN (${userIds}) FOR UPDATE;
    `, parameters);
    return result.rows;
}

async function loadAuditCandidates(transaction, audits) {
    if (audits.length === 0) return [];
    const parameters = [];
    const ids = bindList(audits.map(({ id }) => id), parameters);
    const result = await transaction.query(`
        SELECT id, actor, action, entity, entity_id AS "entityId",
               changes_json AS "changesJson", timestamp
        FROM audit_logs WHERE id IN (${ids}) FOR UPDATE;
    `, parameters);
    return result.rows;
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
                price: canonicalMoney(variant.price, "price", `product:${seed.id}`),
                costPrice: canonicalMoney(variant.costPrice, "costPrice", `product:${seed.id}`)
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
                unitCost: variant.costPrice,
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


function canonicalOrderVouchers(vouchers, orderId) {
    return stableJson(vouchers.map((voucher) => ({
        code: (voucher.code || voucher.codeSnapshot).toUpperCase(),
        type: voucher.type || voucher.typeSnapshot,
        percent: voucher.percent === undefined ? voucher.percentSnapshot : voucher.percent,
        discountAmount: canonicalMoney(voucher.discountAmount, "discountAmount", `order:${orderId}`)
    })).sort((left, right) => left.code.localeCompare(right.code)), `order:${orderId}`);
}

function classifyOrders(seedRecords, existingRecords, existingItems, existingVouchers, conflicts, summary) {
    const byId = new Map(existingRecords.map((record) => [comparisonKey(record.id), record]));
    const itemsByOrder = new Map();
    for (const item of existingItems) {
        const key = comparisonKey(item.orderId);
        const items = itemsByOrder.get(key) || [];
        items.push(item);
        itemsByOrder.set(key, items);
    }
    const vouchersByOrder = new Map();
    for (const voucher of existingVouchers) {
        const key = comparisonKey(voucher.orderId);
        const vouchers = vouchersByOrder.get(key) || [];
        vouchers.push(voucher);
        vouchersByOrder.set(key, vouchers);
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
            "id", "userId", "subtotal", "shippingFee", "discount", "totalPrice", "customerName", "customerPhone",
            "customerAddress", "customerNote", "paymentMethod", "orderStatus", "paymentStatus"
        ]);
        const expectedItems = canonicalOrderItems(seed.items.map((item) => ({ ...item, orderId: seed.id })));
        const actualItems = canonicalOrderItems(itemsByOrder.get(comparisonKey(seed.id)) || []);
        if (JSON.stringify(expectedItems) !== JSON.stringify(actualItems)) {
            addConflict(conflicts, "order", seed.id, "items", expectedItems, actualItems);
        }
        const expectedVouchers = canonicalOrderVouchers(seed.vouchers, seed.id);
        const actualVouchers = canonicalOrderVouchers(vouchersByOrder.get(comparisonKey(seed.id)) || [], seed.id);
        if (expectedVouchers !== actualVouchers) {
            addConflict(conflicts, "order", seed.id, "vouchers", expectedVouchers, actualVouchers);
        }
        if (!conflicts.some(({ identity }) => identity === `order:${seed.id}`)) {
            summary.unchanged.orders += 1;
            summary.unchanged.orderVouchers += seed.vouchers.length;
        }
    }
    return inserts;
}

function classifyUsers(seedRecords, existingRecords, conflicts, summary) {
    const byId = new Map(existingRecords.map((record) => [record.id, record]));
    const byEmail = new Map(existingRecords.filter((record) => record.email).map((record) => [comparisonKey(record.email), record]));
    const byUsername = new Map(existingRecords.filter((record) => record.username).map((record) => [comparisonKey(record.username), record]));
    const inserts = [];
    for (const seed of seedRecords) {
        const emailOwner = byEmail.get(comparisonKey(seed.email));
        if (emailOwner && emailOwner.id !== seed.id) addConflict(conflicts, "user", seed.id, "email", seed.email, `owned by user:${emailOwner.id}`);
        const usernameOwner = byUsername.get(comparisonKey(seed.username));
        if (usernameOwner && usernameOwner.id !== seed.id) addConflict(conflicts, "user", seed.id, "username", seed.username, `owned by user:${usernameOwner.id}`);
        const existing = byId.get(seed.id);
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        compareFields(conflicts, "user", seed.id, seed, { ...existing, email: existing.email && existing.email.toLowerCase() }, ["email", "username", "role", "status"]);
        if (!conflicts.some(({ identity }) => identity === `user:${seed.id}`)) summary.unchanged.users += 1;
    }
    return inserts;
}

// Only the identity of a voucher is compared: quantity, redeemed_count, enabled/listed flags and dates change at runtime.
function classifyVouchers(seedRecords, existingRecords, conflicts, summary) {
    const byCode = new Map(existingRecords.map((record) => [comparisonKey(record.code), record]));
    const inserts = [];
    for (const seed of seedRecords) {
        const existing = byCode.get(comparisonKey(seed.code));
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        const canonical = {
            ...existing,
            maxDiscount: existing.maxDiscount === null ? null : canonicalMoney(existing.maxDiscount, "maxDiscount", `voucher:${seed.code}`)
        };
        compareFields(conflicts, "voucher", seed.code, seed, canonical, ["description", "type", "percent", "maxDiscount"]);
        if (!conflicts.some(({ identity }) => identity === `voucher:${seed.code}`)) summary.unchanged.vouchers += 1;
    }
    return inserts;
}

// Only the author-written content is compared: administrators can hide a review at runtime.
function classifyReviews(seedRecords, existingRecords, conflicts, summary) {
    const byKey = new Map(existingRecords.map((record) => [`${record.productId}|${record.userId}`, record]));
    const inserts = [];
    for (const seed of seedRecords) {
        const identity = `${seed.productId}/${seed.userId}`;
        const existing = byKey.get(`${seed.productId}|${seed.userId}`);
        if (!existing) {
            inserts.push(seed);
            continue;
        }
        compareFields(conflicts, "review", identity, seed, existing, ["rating", "comment"]);
        if (!conflicts.some((conflict) => conflict.identity === `review:${identity}`)) summary.unchanged.reviews += 1;
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
        await transaction.query(`
            INSERT INTO products
                (id, brand, device_type, name, slug, image, description, is_deleted, deleted_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
        `, [
            record.id, record.brand, record.deviceType, record.name, record.slug, record.image,
            record.description, record.isDeleted, record.deletedAt && new Date(record.deletedAt),
            new Date(record.createdAt), new Date(record.updatedAt)
        ]);
        const valueIdsByOption = new Map();
        for (const [optionPosition, option] of record.options.entries()) {
            const optionResult = await transaction.query(`
                INSERT INTO product_options (product_id, name, position, is_active)
                VALUES ($1, $2, $3, true) RETURNING id;
            `, [record.id, option.name, optionPosition]);
            const optionId = optionResult.rows[0].id;
            const valueIds = new Map();
            for (const [position, entry] of option.values.entries()) {
                const valueResult = await transaction.query(`
                    INSERT INTO product_option_values (option_id, value, color_hex, position, is_active)
                    VALUES ($1, $2, $3, $4, true) RETURNING id;
                `, [optionId, entry.value, entry.colorHex || null, position]);
                valueIds.set(comparisonKey(entry.value), valueResult.rows[0].id);
            }
            valueIdsByOption.set(comparisonKey(option.name), valueIds);
        }
        for (const variant of record.variants) {
            const valueIds = Object.entries(variant.optionValues).map(([name, value]) =>
                valueIdsByOption.get(comparisonKey(name)).get(comparisonKey(value)));
            const combinationKey = crypto.createHash("sha256")
                .update(JSON.stringify([...valueIds].sort((left, right) => left - right))).digest("hex").toUpperCase();
            const result = await transaction.query(`
                INSERT INTO product_variants (product_id, sku, combination_key, price, cost_price, stock, image, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id;
            `, [record.id, variant.sku, combinationKey, variant.price, variant.costPrice, variant.stock, variant.image || null]);
            for (const optionValueId of valueIds) {
                await transaction.query(`
                    INSERT INTO product_variant_option_values (variant_id, option_value_id)
                    VALUES ($1, $2);
                `, [result.rows[0].id, optionValueId]);
            }
        }
        await insertProductImages(transaction, record.id, record.images);
    }
}

async function insertProductImages(transaction, productId, images) {
    for (const image of images) {
        await transaction.query(`
            INSERT INTO product_images (product_id, url, position) VALUES ($1, $2, $3);
        `, [productId, image.url, image.position]);
    }
}

/**
 * Products seeded before the photo gallery existed keep their rows; the missing gallery is filled in once,
 * only while the product has no product_images at all, so admin edits are never overwritten.
 */
async function backfillProductImages(transaction, products) {
    let filled = 0;
    for (const product of products) {
        if (product.images.length === 0) continue;
        const existing = await transaction.query("SELECT COUNT(*) AS count FROM product_images WHERE product_id = $1", [product.id]);
        if (Number(existing.rows[0].count) > 0) continue;
        await insertProductImages(transaction, product.id, product.images);
        filled += product.images.length;
    }
    return filled;
}

async function insertOrders(transaction, records) {
    for (const record of records) {
        await transaction.query(`
            INSERT INTO orders
                (id, subtotal, shipping_fee, discount, total_price, customer_name, customer_phone,
                 customer_address, customer_note, payment_method, order_status, payment_status, created_at, updated_at, user_id, cancelled_at,
                 points_earned, points_credited_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 CASE WHEN $11::varchar = 'CANCELLED' THEN $14::timestamptz ELSE NULL END, $16, $17);
        `, [
            record.id, record.subtotal, record.shippingFee, record.discount, record.totalPrice, record.customerName,
            record.customerPhone, record.customerAddress, record.customerNote, record.paymentMethod, record.orderStatus,
            record.paymentStatus, new Date(record.createdAt), new Date(record.updatedAt), record.userId,
            record.pointsEarned, record.pointsCreditedAt === null ? null : new Date(record.pointsCreditedAt)
        ]);
        await insertStatusHistory(transaction, record.id, record.statusHistory);

        for (const item of record.items) {
            const variant = await transaction.query(`
                SELECT id FROM product_variants WHERE sku = $1 FOR UPDATE;
            `, [item.variantSku]);
            if (variant.rows.length !== 1) throw new Error(`Seed order variant ${item.variantSku} could not be resolved`);
            await transaction.query(`
                INSERT INTO order_items
                    (order_id, variant_id, name_snapshot, image_snapshot, sku_snapshot, options_snapshot,
                     unit_price, unit_cost, quantity, line_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
            `, [
                record.id, variant.rows[0].id, item.name, item.image, item.variantSku, item.optionsSnapshot,
                item.unitPrice, item.unitCost, item.quantity, item.lineTotal
            ]);
        }
        await insertOrderVouchers(transaction, record.id, record.vouchers);
    }
}

async function insertAddresses(transaction, userId, addresses) {
    for (const address of addresses) {
        const createdAt = new Date(address.createdAt);
        await transaction.query(`
            INSERT INTO user_addresses
                (id, user_id, recipient_name, phone, address_line, is_default, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7);
        `, [address.id, userId, address.recipientName, address.phone, address.addressLine, address.isDefault, createdAt]);
    }
}

async function insertStatusHistory(transaction, orderId, history) {
    for (const entry of history) {
        await transaction.query(`
            INSERT INTO order_status_history (order_id, status, created_at) VALUES ($1, $2, $3);
        `, [orderId, entry.status, new Date(entry.at)]);
    }
}

async function insertUsers(transaction, records) {
    for (const record of records) {
        // No password hash: seeded customers cannot log in.
        await transaction.query(`
            INSERT INTO users
                (id, email, username, full_name, role, status, loyalty_points, email_verified_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
        `, [
            record.id, record.email, record.username, record.fullName, record.role, record.status, record.loyaltyPoints,
            new Date(record.emailVerifiedAt), new Date(record.createdAt), new Date(record.updatedAt)
        ]);
        await insertAddresses(transaction, record.id, record.addresses);
    }
}

/**
 * Seed rows that already exist (an earlier seed, before full names, address books, loyalty points and status history
 * existed) are never overwritten, but their missing pieces are filled in, each guarded so a re-run changes nothing:
 * a missing full name, an empty address book, an order with no history, and the points of an order that still has
 * none recorded (credited to the balance only by the run that records them).
 */
async function backfillSeedExtras(transaction, users, orders) {
    let filled = 0;
    for (const user of users) {
        const result = await transaction.query(`
            UPDATE users SET full_name = $2 WHERE id = $1 AND full_name IS NULL;
        `, [user.id, user.fullName]);
        filled += result.rowCount;
        if (user.addresses.length === 0) continue;
        const existing = await transaction.query("SELECT COUNT(*) AS count FROM user_addresses WHERE user_id = $1", [user.id]);
        if (Number(existing.rows[0].count) === 0) {
            await insertAddresses(transaction, user.id, user.addresses);
            filled += user.addresses.length;
        }
    }
    for (const order of orders) {
        const stored = await transaction.query("SELECT COUNT(*) AS count FROM order_status_history WHERE order_id = $1", [order.id]);
        if (Number(stored.rows[0].count) === 0) {
            await insertStatusHistory(transaction, order.id, order.statusHistory);
            filled += order.statusHistory.length;
        }
        if (order.pointsEarned === 0) continue;
        const recorded = await transaction.query(`
            UPDATE orders SET points_earned = $4, points_credited_at = $5
            WHERE id = $1 AND points_earned = 0 AND points_credited_at IS NULL
              AND order_status = $2 AND payment_status = $3;
        `, [
            order.id, order.orderStatus, order.paymentStatus, order.pointsEarned,
            order.pointsCreditedAt === null ? null : new Date(order.pointsCreditedAt)
        ]);
        if (recorded.rowCount === 1) {
            filled += 1;
            if (order.pointsCreditedAt !== null && order.userId !== null) {
                await transaction.query("UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1", [
                    order.userId, order.pointsEarned
                ]);
            }
        }
    }
    return filled;
}

// redeemed_count starts at 0 and is incremented by insertOrders for each unreleased order voucher,
// so it stays equal to the order_vouchers rows even when the voucher already existed.
async function insertVouchers(transaction, records) {
    for (const record of records) {
        await transaction.query(`
            INSERT INTO vouchers
                (code, description, type, percent, max_discount, starts_at, ends_at, quantity,
                 redeemed_count, is_enabled, is_listed, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12);
        `, [
            record.code, record.description, record.type, record.percent, record.maxDiscount,
            new Date(record.startsAt), new Date(record.endsAt), record.quantity, record.isEnabled, record.isListed,
            new Date(record.createdAt), new Date(record.updatedAt)
        ]);
    }
}

async function insertOrderVouchers(transaction, orderId, vouchers) {
    for (const voucher of vouchers) {
        const found = await transaction.query("SELECT id FROM vouchers WHERE code = $1 FOR UPDATE", [voucher.code]);
        if (found.rows.length !== 1) throw new Error(`Seed order voucher ${voucher.code} could not be resolved`);
        await transaction.query(`
            INSERT INTO order_vouchers
                (order_id, voucher_id, code_snapshot, type_snapshot, percent_snapshot, discount_amount, released_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7);
        `, [
            orderId, found.rows[0].id, voucher.code, voucher.type, voucher.percent, voucher.discountAmount,
            voucher.releasedAt === null ? null : new Date(voucher.releasedAt)
        ]);
        if (voucher.releasedAt === null) {
            await transaction.query("UPDATE vouchers SET redeemed_count = redeemed_count + 1 WHERE id = $1", [found.rows[0].id]);
        }
    }
}

async function insertReviews(transaction, records) {
    for (const record of records) {
        await transaction.query(`
            INSERT INTO product_reviews
                (product_id, user_id, rating, comment, is_hidden, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7);
        `, [
            record.productId, record.userId, record.rating, record.comment, record.isHidden,
            new Date(record.createdAt), new Date(record.updatedAt)
        ]);
    }
}

async function insertAudits(transaction, records) {
    for (const record of records) {
        await transaction.query(`
            INSERT INTO audit_logs
                (id, actor, action, entity, entity_id, changes_json, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7);
        `, [
            record.id, record.actor, record.action, record.entity, record.entityId, record.changesJson,
            new Date(record.timestamp)
        ]);
    }
}

async function seedDatabase() {
    const commerce = seedData.commerce;
    const requiredArrays = ["products", "users", "vouchers", "orders", "reviews", "audits"];
    if (!requiredArrays.every((entity) => Array.isArray(commerce[entity]))) {
        throw new Error("Normal seed data must export commerce entity arrays");
    }
    const normalized = normalizeSeedData({
        products: commerce.products,
        users: commerce.users,
        vouchers: commerce.vouchers,
        orders: commerce.orders,
        reviews: commerce.reviews,
        audits: commerce.audits
    });
    normalized.orders = resolveSeedOrderItems(normalized.products, normalized.orders);
    const summary = createSummary(normalized);
    const pool = createPool(readDatabaseConfig());
    let transaction;
    let transactionOpen = false;

    try {
        transaction = await pool.connect();
        await transaction.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionOpen = true;
        await transaction.query(`
            LOCK TABLE users, products, product_variants, vouchers, orders, order_items,
                       order_vouchers, product_reviews, audit_logs IN SHARE ROW EXCLUSIVE MODE;
        `);
        await ensureDefaultAdmin(transaction);

        const existingProducts = await loadProductCandidates(transaction, normalized.products);
        const existingVariants = await loadVariantSkuCandidates(transaction, normalized.products);
        const existingConfigurations = await loadProductConfigurations(transaction, normalized.products, existingProducts);
        const existingOrderData = await loadOrderCandidates(transaction, normalized.orders);
        const existingUsers = await loadUserCandidates(transaction, normalized.users);
        const existingVouchers = await loadVoucherCandidates(transaction, normalized.vouchers);
        const existingReviews = await loadReviewCandidates(transaction, normalized.reviews);
        const existingAudits = await loadAuditCandidates(transaction, normalized.audits);

        const conflicts = [];
        const productInserts = classifyProducts(
            normalized.products, existingProducts, existingVariants, existingConfigurations, conflicts, summary
        );
        const userInserts = classifyUsers(normalized.users, existingUsers, conflicts, summary);
        const voucherInserts = classifyVouchers(normalized.vouchers, existingVouchers, conflicts, summary);
        const orderInserts = classifyOrders(
            normalized.orders,
            existingOrderData.orders,
            existingOrderData.items,
            existingOrderData.vouchers,
            conflicts,
            summary
        );
        const reviewInserts = classifyReviews(normalized.reviews, existingReviews, conflicts, summary);
        const auditInserts = classifyAudits(normalized.audits, existingAudits, conflicts, summary);

        if (conflicts.length > 0) {
            summary.conflicts.records = conflicts;
            throw new SeedConflictError(conflicts, finalizeSummary(summary));
        }

        await insertProducts(transaction, productInserts);
        await insertUsers(transaction, userInserts);
        await insertVouchers(transaction, voucherInserts);
        await insertOrders(transaction, orderInserts);
        await insertReviews(transaction, reviewInserts);
        await insertAudits(transaction, auditInserts);
        const insertedUserIds = new Set(userInserts.map(({ id }) => id));
        const insertedOrderIds = new Set(orderInserts.map(({ id }) => id));
        const insertedProductIds = new Set(productInserts.map(({ id }) => id));
        summary.backfilled = await backfillSeedExtras(
            transaction,
            normalized.users.filter(({ id }) => !insertedUserIds.has(id)),
            normalized.orders.filter(({ id }) => !insertedOrderIds.has(id))
        ) + await backfillProductImages(
            transaction,
            normalized.products.filter(({ id }) => !insertedProductIds.has(id))
        );

        summary.inserted.products = productInserts.length;
        summary.inserted.users = userInserts.length;
        summary.inserted.vouchers = voucherInserts.length;
        summary.inserted.orders = orderInserts.length;
        summary.inserted.orderVouchers = orderInserts.reduce((total, order) => total + order.vouchers.length, 0);
        summary.inserted.reviews = reviewInserts.length;
        summary.inserted.audits = auditInserts.length;

        await transaction.query("SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT MAX(id) FROM products))");
        await transaction.query("COMMIT");
        transactionOpen = false;
        return finalizeSummary(summary);
    } catch (error) {
        if (transactionOpen) {
            try {
                await transaction.query("ROLLBACK");
            } catch {
                // The original error remains the actionable failure; closing the pool discards the session.
            }
            transactionOpen = false;
        }
        throw error;
    } finally {
        transaction?.release();
        await pool.end();
    }
}

const countRecords = async (transaction, table) => {
    const result = await transaction.query(`SELECT COUNT(*) AS count FROM "${table}"`);
    return Number(result.rows[0].count);
};

async function clearStore(transaction, password) {
    for (const [table] of CLEAR_TABLES) {
        if (table === "refresh_sessions") {
            await transaction.query("UPDATE refresh_sessions SET replaced_by_id = NULL");
        }
        await transaction.query(`DELETE FROM "${table}"`);
    }
    await ensureDefaultAdmin(transaction, password);
    const after = {};
    for (const [table] of CLEAR_TABLES) after[table] = await countRecords(transaction, table);
    const adminResult = await transaction.query(`
        SELECT username, role, force_password_change FROM users;
    `);
    if (
        adminResult.rows.length !== 1
        || adminResult.rows[0].username !== DEFAULT_ADMIN_USERNAME
        || adminResult.rows[0].role !== "admin"
        || !adminResult.rows[0].force_password_change
    ) {
        throw new Error("Reset did not produce exactly one first-login administrator");
    }
    return after;
}

const requireLocalTarget = (environment) => {
    const config = readDatabaseConfig(environment);
    let target;
    try {
        target = new URL(config.connectionString);
    } catch {
        throw new Error("Store reset is restricted to localhost:5432 database digishop");
    }
    if (
        !/^localhost$/i.test(target.hostname)
        || (target.port && target.port !== "5432")
        || target.searchParams.has("host")
        || target.searchParams.has("port")
        || decodeURIComponent(target.pathname.slice(1)) !== "digishop"
    ) {
        throw new Error("Store reset is restricted to localhost:5432 database digishop");
    }
    return { ...config, databaseName: "digishop", server: "localhost:5432" };
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

    const pool = createPool(config);
    let transaction;
    let transactionOpen = false;
    try {
        transaction = await pool.connect();
        await transaction.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionOpen = true;
        const before = {};
        for (const [table] of CLEAR_TABLES) before[table] = await countRecords(transaction, table);
        const after = await clearStore(transaction, password);
        await transaction.query("COMMIT");
        transactionOpen = false;
        return { database: config.databaseName, server: config.server, before, after };
    } catch (error) {
        if (transactionOpen) {
            try {
                await transaction.query("ROLLBACK");
            } catch {
                // Preserve the triggering error.
            }
        }
        throw error;
    } finally {
        transaction?.release();
        await pool.end();
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
    const pool = createPool(config);
    let transaction;
    let transactionOpen = false;
    try {
        transaction = await pool.connect();
        await transaction.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        transactionOpen = true;
        const before = {};
        for (const [table] of CLEAR_TABLES) before[table] = await countRecords(transaction, table);
        await clearStore(transaction, password);
        await transaction.query("ROLLBACK");
        transactionOpen = false;
        const after = {};
        for (const [table] of CLEAR_TABLES) after[table] = await countRecords(transaction, table);
        if (CLEAR_TABLES.some(([table]) => before[table] !== after[table])) {
            throw new Error("Rollback verification failed: one or more table counts changed");
        }
        return {
            database: config.databaseName,
            server: config.server,
            outcome: "rolled back; no changes committed",
            before,
            after
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await transaction.query("ROLLBACK");
            } catch {
                // Preserve the triggering error.
            }
        }
        throw error;
    } finally {
        transaction?.release();
        await pool.end();
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
    CLEAR_TABLES,
    SeedConflictError,
    backfillSeedExtras,
    backfillProductImages,
    classifyOrders,
    classifyReviews,
    classifyUsers,
    classifyVouchers,
    createSummary,
    resolveSeedOrderItems,
    seedDatabase,
    resetDatabase,
    verifyResetRollback
};
