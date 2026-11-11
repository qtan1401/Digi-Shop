const { BRANDS, DEVICE_TYPES } = require("../../public/js/catalog-taxonomy");

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

function requiredText(value, field, identity, changes, maxLength, transform = (text) => text, allowLineBreaks = false) {
    if (typeof value !== "string") {
        throw new SeedDataError(identity, `${field} must be a string`);
    }

    const normalized = transform(value.normalize("NFKC").trim());
    if (!normalized) {
        throw new SeedDataError(identity, `${field} must not be empty`);
    }
    if ((allowLineBreaks ? /(?![\n\t])\p{Cc}/u : /\p{Cc}/u).test(normalized)) {
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
    if (!BRANDS.includes(brand)) throw new SeedDataError(identity, `brand must be one of ${BRANDS.join(", ")}`);
    if (!DEVICE_TYPES.includes(deviceType)) throw new SeedDataError(identity, `deviceType must be one of ${DEVICE_TYPES.join(", ")}`);
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
        description: requiredText(record.description, "description", identity, changes, 2147483647, (text) => text.replace(/\r\n?/g, "\n"), true),
        options,
        variants,
        isDeleted,
        deletedAt,
        createdAt: normalizeDate(record.createdAt, "createdAt", identity, changes),
        updatedAt: normalizeDate(record.updatedAt, "updatedAt", identity, changes)
    };
}

function normalizeOrderVouchers(vouchers, identity, changes) {
    if (!Array.isArray(vouchers) || vouchers.length > 3) {
        throw new SeedDataError(identity, "vouchers must be an array of at most three entries");
    }
    return vouchers.map((voucher, index) => {
        const voucherIdentity = `${identity}/voucher:${index}`;
        if (!voucher || typeof voucher !== "object" || Array.isArray(voucher)) {
            throw new SeedDataError(voucherIdentity, "voucher must be an object");
        }
        return {
            code: normalizeVoucherCode(voucher.code, voucherIdentity, changes),
            type: normalizeVoucherType(voucher.type, voucherIdentity, changes),
            percent: voucher.percent === null || voucher.percent === undefined
                ? null
                : normalizeInteger(voucher.percent, "percent", voucherIdentity, changes, { minimum: 1, maximum: 100 }),
            discountAmount: normalizeMoney(voucher.discountAmount, "discountAmount", voucherIdentity, changes),
            releasedAt: normalizeDate(voucher.releasedAt, "releasedAt", voucherIdentity, changes, true)
        };
    });
}

function normalizeVoucherCode(value, identity, changes) {
    const code = requiredText(value, "code", identity, changes, 20, (text) => text.toUpperCase());
    if (!/^[A-Z0-9]{3,20}$/.test(code)) {
        throw new SeedDataError(identity, "code must be 3-20 letters or digits");
    }
    return code;
}

function normalizeVoucherType(value, identity, changes) {
    const type = requiredText(value, "type", identity, changes, 16);
    if (type !== "PERCENT" && type !== "FREE_SHIPPING") {
        throw new SeedDataError(identity, "type must be PERCENT or FREE_SHIPPING");
    }
    return type;
}

const SEED_PHONE = /^(0|\+84)[0-9]{8,10}$/;

/** Saved delivery addresses of a seeded customer: at most 10, exactly one default when there are any. */
function normalizeAddresses(addresses, identity, changes) {
    if (addresses === undefined) return [];
    if (!Array.isArray(addresses) || addresses.length > 10) {
        throw new SeedDataError(identity, "addresses must be an array of at most ten entries");
    }
    const normalized = addresses.map((address, index) => {
        const addressIdentity = `${identity}/address:${index}`;
        if (!address || typeof address !== "object" || Array.isArray(address)) {
            throw new SeedDataError(addressIdentity, "address must be an object");
        }
        const phone = requiredText(address.phone, "phone", addressIdentity, changes, 20);
        if (!SEED_PHONE.test(phone)) throw new SeedDataError(addressIdentity, "phone is not a valid Vietnamese phone number");
        if (typeof address.isDefault !== "boolean") throw new SeedDataError(addressIdentity, "isDefault must be a boolean");
        return {
            id: requiredText(address.id, "id", addressIdentity, changes, 36),
            recipientName: requiredText(address.recipientName, "recipientName", addressIdentity, changes, 200),
            phone,
            addressLine: requiredText(address.addressLine, "addressLine", addressIdentity, changes, 500),
            isDefault: address.isDefault,
            createdAt: normalizeDate(address.createdAt, "createdAt", addressIdentity, changes)
        };
    });
    if (normalized.length > 0 && normalized.filter((address) => address.isDefault).length !== 1) {
        throw new SeedDataError(identity, "a customer with saved addresses must have exactly one default address");
    }
    return normalized;
}

function normalizeStatusHistory(history, order, identity, changes) {
    if (history === undefined) {
        // Without an explicit timeline: placed as PENDING, then the current status at the last update.
        return order.orderStatus === "PENDING"
            ? [{ status: "PENDING", at: order.createdAt }]
            : [{ status: "PENDING", at: order.createdAt }, { status: order.orderStatus, at: order.updatedAt }];
    }
    if (!Array.isArray(history) || history.length === 0) throw new SeedDataError(identity, "statusHistory must be a non-empty array");
    return history.map((entry, index) => {
        const entryIdentity = `${identity}/history:${index}`;
        if (!entry || typeof entry !== "object") throw new SeedDataError(entryIdentity, "history entry must be an object");
        return {
            status: normalizeCode(entry.status, "status", entryIdentity, changes, 32),
            at: normalizeDate(entry.at, "at", entryIdentity, changes)
        };
    });
}

function normalizeUser(record, index, changes) {
    const identity = requireRecord("user", record, index);
    const user = {
        id: requiredText(record.id, "id", identity, changes, 36),
        email: requiredText(record.email, "email", identity, changes, 320, (text) => text.toLowerCase()),
        username: requiredText(record.username, "username", identity, changes, 64),
        role: requiredText(record.role, "role", identity, changes, 16),
        status: requiredText(record.status, "status", identity, changes, 20),
        emailVerifiedAt: normalizeDate(record.emailVerifiedAt, "emailVerifiedAt", identity, changes),
        createdAt: normalizeDate(record.createdAt, "createdAt", identity, changes),
        updatedAt: normalizeDate(record.updatedAt, "updatedAt", identity, changes),
        fullName: optionalText(record.fullName, "fullName", identity, changes, 200),
        loyaltyPoints: record.loyaltyPoints === undefined
            ? 0
            : normalizeInteger(record.loyaltyPoints, "loyaltyPoints", identity, changes, { minimum: 0, maximum: 2147483647 }),
        addresses: normalizeAddresses(record.addresses, identity, changes)
    };
    if (user.role !== "user") throw new SeedDataError(identity, "seeded customers must have role user");
    if (user.status !== "ACTIVE") throw new SeedDataError(identity, "seeded customers must be ACTIVE");
    if ("passwordHash" in record) throw new SeedDataError(identity, "seeded customers must not have a password");
    return user;
}

function normalizeVoucher(record, index, changes) {
    const identity = requireRecord("voucher", record, index);
    const type = normalizeVoucherType(record.type, identity, changes);
    const percent = record.percent === null || record.percent === undefined
        ? null
        : normalizeInteger(record.percent, "percent", identity, changes, { minimum: 1, maximum: 100 });
    const maxDiscount = record.maxDiscount === null || record.maxDiscount === undefined
        ? null
        : normalizeMoney(record.maxDiscount, "maxDiscount", identity, changes);
    if (type === "PERCENT") {
        const cents = maxDiscount === null ? 0n : decimalToCents(maxDiscount, "maxDiscount", identity);
        if (percent === null || cents < 100000n || cents > 50000000n) {
            throw new SeedDataError(identity, "a PERCENT voucher needs a percent and a maxDiscount from 1000 to 500000");
        }
    } else if (percent !== null || maxDiscount !== null) {
        throw new SeedDataError(identity, "a FREE_SHIPPING voucher must not have a percent or maxDiscount");
    }
    const voucher = {
        code: normalizeVoucherCode(record.code, identity, changes),
        description: requiredText(record.description, "description", identity, changes, 200),
        type,
        percent,
        maxDiscount,
        startsAt: normalizeDate(record.startsAt, "startsAt", identity, changes),
        endsAt: normalizeDate(record.endsAt, "endsAt", identity, changes),
        quantity: normalizeInteger(record.quantity, "quantity", identity, changes, { minimum: 0, maximum: 2147483647 }),
        redeemedCount: normalizeInteger(record.redeemedCount, "redeemedCount", identity, changes, { minimum: 0, maximum: 2147483647 }),
        isEnabled: normalizeBoolean(record.isEnabled, "isEnabled", identity),
        isListed: normalizeBoolean(record.isListed, "isListed", identity),
        createdAt: normalizeDate(record.createdAt, "createdAt", identity, changes),
        updatedAt: normalizeDate(record.updatedAt, "updatedAt", identity, changes)
    };
    if (Date.parse(voucher.endsAt) <= Date.parse(voucher.startsAt)) throw new SeedDataError(identity, "endsAt must be after startsAt");
    if (voucher.redeemedCount > voucher.quantity) throw new SeedDataError(identity, "redeemedCount must not exceed quantity");
    return voucher;
}

function normalizeReview(record, index, changes) {
    const identity = `review:${record && typeof record === "object" ? `${record.productId}/${record.userId}` : index}`;
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new SeedDataError(identity, "review must be an object");
    const rating = record.rating === null || record.rating === undefined
        ? null
        : normalizeInteger(record.rating, "rating", identity, changes, { minimum: 1, maximum: 5 });
    const comment = optionalText(record.comment, "comment", identity, changes, 1000);
    if (rating === null && comment === null) throw new SeedDataError(identity, "a review needs a rating or a comment");
    return {
        productId: normalizeInteger(record.productId, "productId", identity, changes, { minimum: 1, maximum: 2147483647 }),
        userId: requiredText(record.userId, "userId", identity, changes, 36),
        rating,
        comment,
        isHidden: normalizeBoolean(record.isHidden, "isHidden", identity),
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
        userId: record.userId === undefined || record.userId === null ? null : requiredText(record.userId, "userId", identity, changes, 36),
        subtotal: normalizeMoney(record.subtotal, "subtotal", identity, changes),
        shippingFee: normalizeMoney(record.shippingFee, "shippingFee", identity, changes),
        discount: normalizeMoney(record.discount, "discount", identity, changes),
        totalPrice: normalizeMoney(record.totalPrice, "totalPrice", identity, changes),
        customerName: requiredText(record.customer.name, "customer.name", identity, changes, 200),
        customerPhone: requiredText(record.customer.phone, "customer.phone", identity, changes, 32),
        customerAddress: requiredText(record.customer.address, "customer.address", identity, changes, 500),
        customerNote: optionalText(record.customer.note, "customer.note", identity, changes, 1000),
        paymentMethod: requiredText(record.paymentMethod, "paymentMethod", identity, changes, 64),
        orderStatus: normalizeCode(record.orderStatus, "orderStatus", identity, changes, 32),
        paymentStatus: normalizeCode(record.paymentStatus, "paymentStatus", identity, changes, 32),
        createdAt: normalizeDate(record.createdAt, "createdAt", identity, changes),
        updatedAt: normalizeDate(record.updatedAt, "updatedAt", identity, changes),
        pointsEarned: record.pointsEarned === undefined
            ? 0
            : normalizeInteger(record.pointsEarned, "pointsEarned", identity, changes, { minimum: 0, maximum: 2147483647 }),
        pointsCreditedAt: normalizeDate(record.pointsCreditedAt, "pointsCreditedAt", identity, changes, true),
        items: record.items.map((item, itemIndex) => {
            const itemIdentity = `${identity}/item:${itemIndex}`;
            const unitPrice = normalizeMoney(item.unitPrice, "unitPrice", itemIdentity, changes, { positive: true });
            const quantity = normalizeInteger(item.quantity, "quantity", itemIdentity, changes, { minimum: 1, maximum: 2147483647 });
            const lineTotal = normalizeMoney(item.lineTotal, "lineTotal", itemIdentity, changes, { positive: true });
            if (decimalToCents(unitPrice, "unitPrice", itemIdentity) * BigInt(quantity) !== decimalToCents(lineTotal, "lineTotal", itemIdentity)) {
                throw new SeedDataError(itemIdentity, "lineTotal must equal unitPrice multiplied by quantity");
            }
            return { variantSku: normalizeCode(item.variantSku, "variantSku", itemIdentity, changes, 100), unitPrice, quantity, lineTotal };
        }),
        vouchers: (record.vouchers === undefined ? [] : normalizeOrderVouchers(record.vouchers, identity, changes))
    };
    order.statusHistory = normalizeStatusHistory(record.statusHistory, order, identity, changes);
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

/** Cross-entity invariants for customers, vouchers, orders and reviews (all checked without a database). */
function assertCustomerData({ products, users, vouchers, orders, reviews }, variantsBySku) {
    const userIds = new Set(users.map((user) => user.id));
    const voucherByCode = new Map(vouchers.map((voucher) => [voucher.code, voucher]));
    const redeemed = new Map(vouchers.map((voucher) => [voucher.code, 0]));
    const deliveredProducts = new Set();
    for (const order of orders) {
        const identity = `order:${order.id}`;
        if (order.userId !== null && !userIds.has(order.userId)) {
            throw new SeedDataError(identity, `userId ${order.userId} is not present in the user seed`);
        }
        const seen = new Set();
        let discountCents = 0n;
        let freeShipping = 0;
        for (const used of order.vouchers) {
            const voucher = voucherByCode.get(used.code);
            if (!voucher) throw new SeedDataError(identity, `voucher ${used.code} is not present in the voucher seed`);
            if (seen.has(used.code)) throw new SeedDataError(identity, `voucher ${used.code} is used twice`);
            seen.add(used.code);
            if (used.type !== voucher.type || used.percent !== voucher.percent) {
                throw new SeedDataError(identity, `voucher ${used.code} snapshot does not match the voucher`);
            }
            const amount = decimalToCents(used.discountAmount, "discountAmount", identity);
            if (amount > 50000000n) throw new SeedDataError(identity, `voucher ${used.code} discount exceeds 500000`);
            if (used.type === "FREE_SHIPPING") {
                freeShipping += 1;
                if (amount > decimalToCents(order.shippingFee, "shippingFee", identity)) {
                    throw new SeedDataError(identity, "a free-shipping discount must not exceed the shipping fee");
                }
            }
            discountCents += amount;
            if (used.releasedAt === null) redeemed.set(used.code, redeemed.get(used.code) + 1);
        }
        if (freeShipping > 1) throw new SeedDataError(identity, "at most one free-shipping voucher is allowed per order");
        if (discountCents !== decimalToCents(order.discount, "discount", identity)) {
            throw new SeedDataError(identity, "discount must equal the sum of the order voucher discounts");
        }
        if (discountCents > 100000000n) throw new SeedDataError(identity, "discount exceeds 1000000");
        if (order.orderStatus === "DELIVERED" && order.userId !== null) {
            for (const item of order.items) {
                deliveredProducts.add(`${variantsBySku.get(item.variantSku.normalize("NFKC").toLowerCase())}|${order.userId}`);
            }
        }
    }
    // Loyalty and timeline invariants: a balance is exactly the points its credited orders earned, and every order's
    // history starts as PENDING, never goes back in time, and ends on the order's current status.
    const credited = new Map(users.map((user) => [user.id, 0]));
    for (const order of orders) {
        const identity = `order:${order.id}`;
        const total = Number(order.totalPrice);
        if (order.pointsEarned !== 0 && order.pointsEarned !== Math.floor((total * 10) / 100000)) {
            throw new SeedDataError(identity, "pointsEarned must be floor(10% of totalPrice / 1000)");
        }
        if (order.pointsCreditedAt !== null) {
            if (order.userId === null) throw new SeedDataError(identity, "an order without a customer cannot have credited points");
            credited.set(order.userId, credited.get(order.userId) + order.pointsEarned);
        }
        const history = order.statusHistory;
        if (history[0].status !== "PENDING") throw new SeedDataError(identity, "statusHistory must start with PENDING");
        if (history[history.length - 1].status !== order.orderStatus) throw new SeedDataError(identity, "statusHistory must end with the order status");
        for (let position = 1; position < history.length; position += 1) {
            if (Date.parse(history[position].at) < Date.parse(history[position - 1].at)) {
                throw new SeedDataError(identity, "statusHistory must not go back in time");
            }
        }
    }
    for (const user of users) {
        if (user.loyaltyPoints !== credited.get(user.id)) {
            throw new SeedDataError(`user:${user.id}`, "loyaltyPoints must equal the points of the customer's credited orders");
        }
    }
    for (const voucher of vouchers) {
        if (voucher.redeemedCount !== redeemed.get(voucher.code)) {
            throw new SeedDataError(`voucher:${voucher.code}`, "redeemedCount must equal the unreleased order vouchers");
        }
    }
    const productIds = new Set(products.map((product) => product.id));
    const reviewKeys = new Set();
    for (const review of reviews) {
        const identity = `review:${review.productId}/${review.userId}`;
        if (!productIds.has(review.productId)) throw new SeedDataError(identity, "productId is not present in the product seed");
        if (!userIds.has(review.userId)) throw new SeedDataError(identity, "userId is not present in the user seed");
        const key = `${review.productId}|${review.userId}`;
        if (reviewKeys.has(key)) throw new SeedDataError(identity, "duplicates another review of the same product by the same user");
        reviewKeys.add(key);
        if (!deliveredProducts.has(key)) throw new SeedDataError(identity, "the reviewer has no DELIVERED order containing the product");
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
    for (const entity of ["users", "vouchers", "reviews"]) {
        if (source[entity] !== undefined && !Array.isArray(source[entity])) {
            throw new SeedDataError(`seed:${entity}`, "source must export an array");
        }
    }
    const changes = [];
    const products = source.products.map((record, index) => normalizeProduct(record, index, changes));
    const users = (source.users || []).map((record, index) => normalizeUser(record, index, changes));
    const vouchers = (source.vouchers || []).map((record, index) => normalizeVoucher(record, index, changes));
    const orders = source.orders.map((record, index) => normalizeOrder(record, index, changes));
    const reviews = (source.reviews || []).map((record, index) => normalizeReview(record, index, changes));
    const audits = source.audits.map((record, index) => normalizeAudit(record, index, changes));

    assertUnique(users, "id", "user");
    assertUnique(users, "email", "user");
    assertUnique(users, "username", "user");
    assertUnique(vouchers.map((voucher) => ({ ...voucher, id: voucher.code })), "code", "voucher");

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
    assertCustomerData({ products, users, vouchers, orders, reviews }, variantsBySku);

    const normalizedRecords = new Set(changes.map(({ identity }) => identity.split(/\/(?:item|voucher):/)[0])).size;
    return { products, users, vouchers, orders, reviews, audits, changes, normalizedRecords };
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
