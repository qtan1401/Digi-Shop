class SeedDataError extends Error {
    constructor(identity, message) {
        super(`Invalid seed record ${identity}: ${message}`);
        this.name = "SeedDataError";
        this.identity = identity;
    }
}

const MAX_DECIMAL_CENTS = 999999999999999999n;
const MAX_SAFE_DRIVER_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const REDACTED_FIELDS = /(password|secret|token|credential|phone|address|note|changes|customer)/i;

function identityFor(entity, record, index) {
    const id = record && record.id !== undefined ? String(record.id) : `index ${index}`;
    return `${entity}:${id}`;
}

function requireRecord(entity, record, index) {
    const identity = identityFor(entity, record, index);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new SeedDataError(identity, "record must be an object");
    }
    return identity;
}

function recordChange(changes, identity, field, before, after) {
    if (Object.is(before, after)) {
        return;
    }

    changes.push({ identity, field, before, after });
}

function requiredText(value, field, identity, changes, maxLength, transform = (text) => text) {
    if (typeof value !== "string") {
        throw new SeedDataError(identity, `${field} must be a string`);
    }

    const normalized = transform(value.normalize("NFKC").trim());
    if (!normalized) {
        throw new SeedDataError(identity, `${field} must not be empty`);
    }
    if (/\p{Cc}/u.test(normalized)) {
        throw new SeedDataError(identity, `${field} must not contain control characters`);
    }
    if (normalized.length > maxLength) {
        throw new SeedDataError(identity, `${field} exceeds ${maxLength} characters`);
    }

    recordChange(changes, identity, field, value, normalized);
    return normalized;
}

function optionalText(value, field, identity, changes, maxLength) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new SeedDataError(identity, `${field} must be a string or null`);
    }

    const normalized = value.normalize("NFKC").trim();
    const result = normalized || null;
    if (result && /\p{Cc}/u.test(result)) {
        throw new SeedDataError(identity, `${field} must not contain control characters`);
    }
    if (result && result.length > maxLength) {
        throw new SeedDataError(identity, `${field} exceeds ${maxLength} characters`);
    }

    recordChange(changes, identity, field, value, result);
    return result;
}

function normalizeSlug(value, field, identity, changes, maxLength) {
    const normalized = requiredText(
        value,
        field,
        identity,
        changes,
        maxLength,
        (text) => text.toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    );

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
        throw new SeedDataError(identity, `${field} cannot be safely normalized to an ASCII slug`);
    }

    return normalized;
}

function normalizeCode(value, field, identity, changes, maxLength) {
    const normalized = requiredText(value, field, identity, changes, maxLength, (text) => text.toUpperCase());
    if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(normalized)) {
        throw new SeedDataError(identity, `${field} contains unsupported characters`);
    }
    return normalized;
}

function normalizeInteger(value, field, identity, changes, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    let normalized;
    if (typeof value === "number") {
        normalized = value;
    } else if (typeof value === "string" && /^[-+]?\d+$/.test(value.trim())) {
        normalized = Number(value.trim());
    } else {
        throw new SeedDataError(identity, `${field} must be an integer`);
    }

    if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
        throw new SeedDataError(identity, `${field} must be a safe integer from ${minimum} to ${maximum}`);
    }

    recordChange(changes, identity, field, value, normalized);
    return normalized;
}

function decimalToCents(value, field, identity) {
    if (typeof value !== "number" && typeof value !== "string") {
        throw new SeedDataError(identity, `${field} must be a number or decimal string`);
    }

    const text = typeof value === "number" ? String(value) : value.trim();
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) {
        throw new SeedDataError(identity, `${field} must be a plain decimal value`);
    }

    const fraction = match[3] || "";
    if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) {
        throw new SeedDataError(identity, `${field} has more than two decimal places`);
    }

    const cents = BigInt(match[2]) * 100n + BigInt((fraction + "00").slice(0, 2));
    const signed = match[1] === "-" ? -cents : cents;
    if (signed > MAX_DECIMAL_CENTS || signed < -MAX_DECIMAL_CENTS) {
        throw new SeedDataError(identity, `${field} exceeds SQL Server DECIMAL(18,2)`);
    }
    if (signed > MAX_SAFE_DRIVER_CENTS || signed < -MAX_SAFE_DRIVER_CENTS) {
        throw new SeedDataError(identity, `${field} exceeds the exact numeric range supported by the SQL driver`);
    }
    return signed;
}

function centsToDecimal(cents) {
    const sign = cents < 0n ? "-" : "";
    const absolute = cents < 0n ? -cents : cents;
    return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function normalizeMoney(value, field, identity, changes, { positive = false } = {}) {
    const cents = decimalToCents(value, field, identity);
    if (positive ? cents <= 0n : cents < 0n) {
        throw new SeedDataError(identity, `${field} must be ${positive ? "greater than" : "at least"} zero`);
    }

    const normalized = centsToDecimal(cents);
    recordChange(changes, identity, field, value, normalized);
    return normalized;
}

function normalizeBoolean(value, field, identity) {
    if (typeof value !== "boolean") {
        throw new SeedDataError(identity, `${field} must be a boolean`);
    }
    return value;
}

function normalizeDate(value, field, identity, changes, optional = false) {
    if (optional && (value === undefined || value === null)) {
        return null;
    }
    if (optional && value === "") {
        recordChange(changes, identity, field, value, null);
        return null;
    }
    if (!(value instanceof Date) && typeof value !== "string") {
        throw new SeedDataError(identity, `${field} must be an ISO date string or Date`);
    }

    if (typeof value === "string") {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
        if (!match) {
            throw new SeedDataError(identity, `${field} must include an ISO date, time, and timezone`);
        }
        const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        const hour = Number(hourText);
        const minute = Number(minuteText);
        const second = Number(secondText);
        const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
        if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
            throw new SeedDataError(identity, `${field} is not a valid calendar date`);
        }
    }

    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new SeedDataError(identity, `${field} is not a valid date`);
    }

    const normalized = date.toISOString();
    recordChange(changes, identity, field, value instanceof Date ? value.toISOString() : value, normalized);
    return normalized;
}

function stableJson(value, identity, path = "changes") {
    if (value === null || typeof value === "boolean" || typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new SeedDataError(identity, `${path} contains a non-finite number`);
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item, index) => stableJson(item, identity, `${path}[${index}]`)).join(",")}]`;
    }
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        return `{${Object.keys(value).sort().map((key) => {
            const item = value[key];
            if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
                throw new SeedDataError(identity, `${path}.${key} is not JSON-safe`);
            }
            return `${JSON.stringify(key)}:${stableJson(item, identity, `${path}.${key}`)}`;
        }).join(",")}}`;
    }

    throw new SeedDataError(identity, `${path} must contain only JSON-safe values`);
}


function normalizeProduct(record, index, changes) {
    const identity = requireRecord("product", record, index);
    const isDeleted = normalizeBoolean(record.isDeleted, "isDeleted", identity);
    const deletedAt = normalizeDate(record.deletedAt, "deletedAt", identity, changes, true);
    if (isDeleted !== Boolean(deletedAt)) {
        throw new SeedDataError(identity, "isDeleted and deletedAt must either both indicate deletion or both indicate an active product");
    }
    const brand = requiredText(record.brand, "brand", identity, changes, 16);
    const deviceType = requiredText(record.deviceType, "deviceType", identity, changes, 16);
    if (!["Apple", "Samsung", "MSI"].includes(brand)) throw new SeedDataError(identity, "brand must be Apple, Samsung, or MSI");
    if (!["phone", "tablet", "laptop"].includes(deviceType)) throw new SeedDataError(identity, "deviceType must be phone, tablet, or laptop");
    if (!Array.isArray(record.options) || !Array.isArray(record.variants) || record.variants.length === 0) {
        throw new SeedDataError(identity, "options and non-empty variants arrays are required");
    }

    const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
    const options = record.options.map((option, optionIndex) => {
        const optionIdentity = `${identity}/option:${optionIndex}`;
        if (!option || typeof option !== "object" || Array.isArray(option) || !Array.isArray(option.values) || option.values.length === 0) {
            throw new SeedDataError(optionIdentity, "option must contain a non-empty values array");
        }
        const name = requiredText(option.name, "name", optionIdentity, changes, 100);
        const values = option.values.map((rawEntry, valueIndex) => {
            const valueIdentity = `${optionIdentity}/value:${valueIndex}`;
            const entry = (rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)) ? rawEntry : { value: rawEntry };
            const value = requiredText(entry.value, "value", valueIdentity, changes, 100);
            const colorHex = optionalText(entry.colorHex, "colorHex", valueIdentity, changes, 7);
            if (colorHex !== null && !HEX_COLOR_PATTERN.test(colorHex)) {
                throw new SeedDataError(valueIdentity, "colorHex must match #RRGGBB");
            }
            return { value, colorHex: colorHex ? colorHex.toUpperCase() : null };
        });
        assertUnique(values.map((entry, id) => ({ id, value: entry.value })), "value", `product:${identity}/option:${name}`);
        return { name, values };
    });
    assertUnique(options.map((option, id) => ({ id, name: option.name })), "name", `product:${identity}/option`);
    const optionKeys = new Map(options.map(({ name, values }) => [name.normalize("NFKC").toLowerCase(),
        new Set(values.map(({ value }) => value.normalize("NFKC").toLowerCase()))]));
    const variants = record.variants.map((variant, variantIndex) => {
        const variantIdentity = `${identity}/variant:${variantIndex}`;
        if (!variant || typeof variant !== "object" || Array.isArray(variant) ||
            !variant.optionValues || typeof variant.optionValues !== "object" || Array.isArray(variant.optionValues)) {
            throw new SeedDataError(variantIdentity, "variant optionValues must be an object");
        }
        const optionValues = {};
        for (const [name, value] of Object.entries(variant.optionValues)) {
            const normalizedName = name.normalize("NFKC").toLowerCase();
            const normalizedValue = typeof value === "string" ? value.normalize("NFKC").toLowerCase() : "";
            if (!optionKeys.has(normalizedName) || !optionKeys.get(normalizedName).has(normalizedValue)) {
                throw new SeedDataError(variantIdentity, `optionValues contains unknown option or value ${name}`);
            }
            const canonicalName = options.find((option) => option.name.normalize("NFKC").toLowerCase() === normalizedName).name;
            optionValues[canonicalName] = options.find((option) => option.name === canonicalName).values.find((candidate) =>
                candidate.value.normalize("NFKC").toLowerCase() === normalizedValue).value;
        }
        if (Object.keys(optionValues).length !== options.length) {
            throw new SeedDataError(variantIdentity, "optionValues must specify exactly one value for each product option");
        }
        return {
            sku: normalizeCode(variant.sku, "sku", variantIdentity, changes, 100),
            price: normalizeMoney(variant.price, "price", variantIdentity, changes, { positive: true }),
            stock: normalizeInteger(variant.stock, "stock", variantIdentity, changes, { minimum: 0, maximum: 2147483647 }),
            image: optionalText(variant.image, "image", variantIdentity, changes, 500),
            optionValues
        };
    });
    assertUnique(variants, "sku", `product:${identity}/variant`);
    const combinations = variants.map(({ optionValues }) => stableJson(optionValues, identity));
    if (new Set(combinations).size !== combinations.length) throw new SeedDataError(identity, "variant option combinations must be unique");
    return {
        id: normalizeInteger(record.id, "id", identity, changes, { minimum: 1, maximum: 2147483647 }),
        brand,
        deviceType,
        name: requiredText(record.name, "name", identity, changes, 200),
        slug: normalizeSlug(record.slug, "slug", identity, changes, 240),
        image: requiredText(record.image, "image", identity, changes, 500),
        description: requiredText(record.description, "description", identity, changes, 2147483647),
        options,
        variants,
        isDeleted,
        deletedAt,
        createdAt: normalizeDate(record.createdAt, "createdAt", identity, changes),
        updatedAt: normalizeDate(record.updatedAt, "updatedAt", identity, changes)
    };
}

function normalizeOrder(record, index, changes) {
    const identity = requireRecord("order", record, index);
    if (!record.customer || typeof record.customer !== "object" || Array.isArray(record.customer)) {
        throw new SeedDataError(identity, "customer must be an object");
    }
    if (!Array.isArray(record.items) || record.items.length === 0) throw new SeedDataError(identity, "items must be a non-empty array");
    const order = {
        id: requiredText(record.id, "id", identity, changes, 64),
        subtotal: normalizeMoney(record.subtotal, "subtotal", identity, changes),
        shippingFee: normalizeMoney(record.shippingFee, "shippingFee", identity, changes),
        discount: normalizeMoney(record.discount, "discount", identity, changes),
        totalPrice: normalizeMoney(record.totalPrice, "totalPrice", identity, changes),
        customerName: requiredText(record.customer.name, "customer.name", identity, changes, 200),
        customerPhone: requiredText(record.customer.phone, "customer.phone", identity, changes, 32),
        customerAddress: requiredText(record.customer.address, "customer.address", identity, changes, 500),
        customerNote: optionalText(record.customer.note, "customer.note", identity, changes, 1000),
        paymentMethod: normalizeCode(record.paymentMethod, "paymentMethod", identity, changes, 64),
        orderStatus: normalizeCode(record.orderStatus, "orderStatus", identity, changes, 32),
        paymentStatus: normalizeCode(record.paymentStatus, "paymentStatus", identity, changes, 32),
        createdAt: normalizeDate(record.createdAt, "createdAt", identity, changes),
        updatedAt: normalizeDate(record.updatedAt, "updatedAt", identity, changes),
        items: record.items.map((item, itemIndex) => {
            const itemIdentity = `${identity}/item:${itemIndex}`;
            const unitPrice = normalizeMoney(item.unitPrice, "unitPrice", itemIdentity, changes, { positive: true });
            const quantity = normalizeInteger(item.quantity, "quantity", itemIdentity, changes, { minimum: 1, maximum: 2147483647 });
            const lineTotal = normalizeMoney(item.lineTotal, "lineTotal", itemIdentity, changes, { positive: true });
            if (decimalToCents(unitPrice, "unitPrice", itemIdentity) * BigInt(quantity) !== decimalToCents(lineTotal, "lineTotal", itemIdentity)) {
                throw new SeedDataError(itemIdentity, "lineTotal must equal unitPrice multiplied by quantity");
            }
            return { variantSku: normalizeCode(item.variantSku, "variantSku", itemIdentity, changes, 100), unitPrice, quantity, lineTotal };
        })
    };
    const itemSubtotal = order.items.reduce((sum, item) => sum + decimalToCents(item.lineTotal, "lineTotal", identity), 0n);
    const expectedTotal = decimalToCents(order.subtotal, "subtotal", identity) + decimalToCents(order.shippingFee, "shippingFee", identity) - decimalToCents(order.discount, "discount", identity);
    if (itemSubtotal !== decimalToCents(order.subtotal, "subtotal", identity)) throw new SeedDataError(identity, "subtotal must equal the sum of item line totals");
    if (expectedTotal !== decimalToCents(order.totalPrice, "totalPrice", identity)) throw new SeedDataError(identity, "totalPrice must equal subtotal plus shippingFee minus discount");
    return order;
}


function normalizeAudit(record, index, changes) {
    const identity = requireRecord("audit", record, index);
    if (!("changes" in record)) {
        throw new SeedDataError(identity, "changes is required");
    }

    const changesJson = stableJson(record.changes, identity);
    recordChange(changes, identity, "changes", record.changes, changesJson);
    return {
        id: requiredText(record.id, "id", identity, changes, 80),
        actor: requiredText(record.actor, "actor", identity, changes, 120),
        action: normalizeCode(record.action, "action", identity, changes, 40),
        entity: normalizeCode(record.entity, "entity", identity, changes, 40),
        entityId: requiredText(record.entityId, "entityId", identity, changes, 80),
        changesJson,
        timestamp: normalizeDate(record.timestamp, "timestamp", identity, changes)
    };
}

function assertUnique(records, field, entity) {
    const seen = new Map();
    for (const record of records) {
        const value = record[field];
        const comparisonKey = typeof value === "string" ? value.normalize("NFKC").toLowerCase() : value;
        if (seen.has(comparisonKey)) {
            throw new SeedDataError(`${entity}:${record.id}`, `${field} duplicates ${entity}:${seen.get(comparisonKey)}`);
        }
        seen.set(comparisonKey, record.id);
    }
}

function normalizeSeedData(source) {
    if (!source || typeof source !== "object") {
        throw new SeedDataError("seed:root", "seed source must be an object");
    }
    for (const entity of ["products", "orders", "audits"]) {
        if (!Array.isArray(source[entity])) {
            throw new SeedDataError(`seed:${entity}`, "source must export an array");
        }
    }
    const changes = [];
    const products = source.products.map((record, index) => normalizeProduct(record, index, changes));
    const orders = source.orders.map((record, index) => normalizeOrder(record, index, changes));
    const audits = source.audits.map((record, index) => normalizeAudit(record, index, changes));

    assertUnique(products, "id", "product");
    assertUnique(products, "slug", "product");
    assertUnique(orders, "id", "order");
    assertUnique(audits, "id", "audit");
    const variantsBySku = new Map();
    for (const product of products) {
        for (const variant of product.variants) {
            const sku = variant.sku.normalize("NFKC").toLowerCase();
            if (variantsBySku.has(sku)) throw new SeedDataError(`product:${product.id}`, `sku duplicates variant ${variantsBySku.get(sku)}`);
            variantsBySku.set(sku, product.id);
        }
    }
    for (const order of orders) {
        for (const [index, item] of order.items.entries()) {
            if (!variantsBySku.has(item.variantSku.normalize("NFKC").toLowerCase())) {
                throw new SeedDataError(`order:${order.id}/item:${index}`, `variantSku ${item.variantSku} is not present in the product seed`);
            }
        }
    }

    const normalizedRecords = new Set(changes.map(({ identity }) => identity.split("/item:")[0])).size;
    return { products, orders, audits, changes, normalizedRecords };
}

function redactValue(field, value) {
    if (REDACTED_FIELDS.test(field)) {
        return "[REDACTED]";
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function redactedChanges(changes) {
    return changes.map(({ identity, field, before, after }) => ({
        identity,
        field,
        before: redactValue(field, before),
        after: redactValue(field, after)
    }));
}

module.exports = {
    SeedDataError,
    centsToDecimal,
    decimalToCents,
    normalizeSeedData,
    redactValue,
    redactedChanges,
    stableJson
};
