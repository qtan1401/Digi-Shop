// ===== VOUCHER SERVICE =====
// Administrator Voucher management (with audit log) and the customer quote.
// Discount maths lives in voucher-calculator.js; checkout redeems through checkout.repository.

const voucherRepository = require("../repositories/voucher.repository");
const auditRepository = require("../repositories/audit.repository");
const loyaltyRepository = require("../repositories/loyalty.repository");
const cartService = require("./cart.service");
const { parsePointsToUse, maxUsablePoints, redeemPoints, earnedPoints } = require("./loyalty-calculator");
const {
    MAX_VOUCHERS_PER_ORDER,
    MAX_DISCOUNT_PER_VOUCHER,
    NO_EXPIRY_DATE,
    CODE_LENGTH,
    MAX_USES_PER_CODE,
    TYPE_PERCENT,
    TYPE_FREE_SHIPPING,
    calculateDiscount,
    normalizeCode,
    unusableReason
} = require("./voucher-calculator");

const MIN_MAX_DISCOUNT = 1_000;
const CODE_PATTERN = new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`);
const MAX_QUOTE_CODES = 20;
const ADMIN_STATUSES = ["all", "active", "disabled", "exhausted"];

class VoucherError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.name = "VoucherError";
        this.code = code;
        this.statusCode = statusCode;
        if (details) this.details = details;
    }
}

const hasValue = (value) => value !== undefined && value !== null && value !== "";
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const toInteger = (value) => {
    if (typeof value === "number") return Number.isInteger(value) ? value : NaN;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
    return NaN;
};

// ── Administrator ───────────────────────────────────────────────────────────

const FIELDS = ["code", "description", "type", "percent", "maxDiscount", "quantity", "isEnabled", "isListed"];

/**
 * Merge `input` over `base` and validate the result against every Voucher rule.
 * Returns the persisted field set. Throws VoucherError(VALIDATION_FAILED) with field details.
 */
const resolveFields = (base, input, { existing = false } = {}) => {
    const merged = { ...base };
    for (const field of FIELDS) {
        if (hasOwn(input, field) && input[field] !== undefined) merged[field] = input[field];
    }
    const errors = [];
    const fail = (field, message) => errors.push({ field, message });

    const code = typeof merged.code === "string" ? normalizeCode(merged.code) : "";
    // An existing voucher keeps a legacy code/quantity it already has; anything new must meet the rules.
    const codeUnchanged = existing && code === base.code;
    if (!codeUnchanged && !CODE_PATTERN.test(code)) fail("code", `Mã voucher phải gồm đúng ${CODE_LENGTH} ký tự chữ hoặc số (không dấu, không khoảng trắng).`);

    const description = typeof merged.description === "string" ? merged.description.trim() : "";
    if (description.length < 1 || description.length > 200) fail("description", "Mô tả voucher phải có 1-200 ký tự.");

    const type = merged.type;
    if (type !== TYPE_PERCENT && type !== TYPE_FREE_SHIPPING) fail("type", "Loại voucher không hợp lệ.");

    let percent = null;
    let maxDiscount = null;
    if (type === TYPE_PERCENT) {
        percent = toInteger(merged.percent);
        if (!(percent >= 1 && percent <= 100)) fail("percent", "Phần trăm giảm phải là số nguyên từ 1 đến 100.");
        maxDiscount = toInteger(merged.maxDiscount);
        if (!(maxDiscount >= MIN_MAX_DISCOUNT && maxDiscount <= MAX_DISCOUNT_PER_VOUCHER)) {
            fail("maxDiscount", `Mức giảm tối đa phải từ ${MIN_MAX_DISCOUNT.toLocaleString("vi-VN")} đến ${MAX_DISCOUNT_PER_VOUCHER.toLocaleString("vi-VN")} VND.`);
        }
    } else if (type === TYPE_FREE_SHIPPING) {
        // Free-shipping carries neither. Fields inherited from a previous PERCENT type are dropped,
        // but values the caller sent explicitly are refused rather than silently ignored.
        if (hasValue(input.percent)) fail("percent", "Voucher miễn phí vận chuyển không có phần trăm giảm.");
        if (hasValue(input.maxDiscount)) fail("maxDiscount", "Voucher miễn phí vận chuyển không có mức giảm tối đa.");
    }

    const quantity = toInteger(merged.quantity);
    const quantityUnchanged = existing && quantity === base.quantity;
    if (!(quantity >= 1) || (!quantityUnchanged && quantity > MAX_USES_PER_CODE)) {
        fail("quantity", `Số lượt dùng tối đa phải là số nguyên từ 1 đến ${MAX_USES_PER_CODE}.`);
    }

    for (const flag of ["isEnabled", "isListed"]) {
        if (typeof merged[flag] !== "boolean") fail(flag, "Giá trị phải là true hoặc false.");
    }

    if (errors.length > 0) {
        throw new VoucherError("VALIDATION_FAILED", errors[0].message, 400, errors);
    }
    return {
        code, description, type, percent, maxDiscount, quantity,
        // Never expires: a new voucher starts now, an existing one keeps its start.
        startsAt: existing ? base.startsAt : new Date(),
        endsAt: NO_EXPIRY_DATE,
        isEnabled: merged.isEnabled, isListed: merged.isListed
    };
};

const AUDIT_EXCLUDED = new Set(["status", "remaining", "createdAt", "updatedAt"]);
const auditView = (voucher) => Object.fromEntries(Object.entries(voucher).filter(([key]) => !AUDIT_EXCLUDED.has(key)));

const diff = (before, after) => {
    const changes = {};
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
        const oldValue = before ? before[key] : undefined;
        const newValue = after ? after[key] : undefined;
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes[key] = { old: oldValue, new: newValue };
    }
    return changes;
};

const writeAudit = (actor, action, voucher, changes) =>
    auditRepository.createLog({ actor: actor || "admin", action, entity: "voucher", entityId: voucher.id, changes });

const parseId = (value) => {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value === "string" && /^[1-9]\d{0,9}$/.test(value)) return Number(value);
    throw new VoucherError("VOUCHER_NOT_FOUND", "Không tìm thấy voucher.", 404);
};

const notFound = () => new VoucherError("VOUCHER_NOT_FOUND", "Không tìm thấy voucher.", 404);

const listVouchers = async ({ q, status = "all", page, pageSize } = {}) => {
    if (!ADMIN_STATUSES.includes(status)) {
        throw new VoucherError("VALIDATION_FAILED", "Trạng thái lọc không hợp lệ.", 400);
    }
    const pageNumber = Math.max(1, toInteger(page) || 1);
    const size = Math.min(100, Math.max(1, toInteger(pageSize) || 20));
    return voucherRepository.listAdmin({ q, status, page: pageNumber, pageSize: size });
};

const getVoucher = async (id) => {
    const voucher = await voucherRepository.getAdmin(parseId(id));
    if (!voucher) throw notFound();
    return voucher;
};

const createVoucher = async (input = {}, actor) => {
    const base = { isEnabled: true, isListed: true };
    const fields = resolveFields(base, input || {});
    let voucher;
    try {
        voucher = await voucherRepository.create(fields);
    } catch (error) {
        if (error && error.code === "P2002") {
            throw new VoucherError("VOUCHER_CODE_TAKEN", `Mã voucher ${fields.code} đã tồn tại.`, 409);
        }
        throw error;
    }
    await writeAudit(actor, "CREATE", voucher, diff(undefined, auditView(voucher)));
    return voucher;
};

const updateVoucher = async (id, input = {}, actor) => {
    const voucherId = parseId(id);
    let result;
    try {
        result = await voucherRepository.update(voucherId, (current, referenced) => {
            const fields = resolveFields(current, input || {}, { existing: true });
            if (referenced && (
                fields.type !== current.type
                || fields.percent !== current.percent
                || fields.maxDiscount !== current.maxDiscount
            )) {
                throw new VoucherError(
                    "VOUCHER_LOCKED",
                    "Voucher đã được sử dụng nên không thể đổi loại, phần trăm hoặc mức giảm tối đa. Hãy vô hiệu hóa và tạo voucher mới.",
                    409
                );
            }
            if (fields.quantity < current.redeemedCount) {
                throw new VoucherError(
                    "VOUCHER_QUANTITY_TOO_LOW",
                    `Số lượng không được nhỏ hơn số lượt đã sử dụng (${current.redeemedCount}).`,
                    409
                );
            }
            return fields;
        });
    } catch (error) {
        if (error && error.code === "P2002") {
            throw new VoucherError("VOUCHER_CODE_TAKEN", "Mã voucher đã tồn tại.", 409);
        }
        throw error;
    }
    if (!result) throw notFound();

    const changes = diff(auditView(result.before), auditView(result.after));
    if (Object.keys(changes).length > 0) {
        let action = "UPDATE";
        if (Object.keys(changes).length === 1 && changes.isEnabled) {
            action = result.after.isEnabled ? "ENABLE" : "DISABLE";
        }
        await writeAudit(actor, action, result.after, changes);
    }
    return result.after;
};

const deleteVoucher = async (id, actor) => {
    const voucher = await voucherRepository.remove(parseId(id), () => new VoucherError(
        "VOUCHER_IN_USE",
        "Voucher đã được sử dụng trong đơn hàng nên không thể xóa, chỉ có thể vô hiệu hóa.",
        409
    ));
    if (!voucher) throw notFound();
    await writeAudit(actor, "DELETE", voucher, diff(auditView(voucher), undefined));
    return voucher;
};

// ── Customer quote ──────────────────────────────────────────────────────────

const REJECTION = Object.freeze({
    NOT_FOUND: (code) => `Mã voucher ${code} không tồn tại.`,
    DUPLICATE: (code) => `Voucher ${code} đã được áp dụng.`,
    LIMIT: () => `Mỗi đơn hàng chỉ áp dụng tối đa ${MAX_VOUCHERS_PER_ORDER} voucher.`,
    FREE_SHIPPING_LIMIT: () => "Mỗi đơn hàng chỉ áp dụng một voucher miễn phí vận chuyển."
});

const describeApplied = (voucher, amount) => ({
    code: voucher.code,
    type: voucher.type,
    percent: voucher.percent,
    amount,
    description: voucher.description
});

/** Why `voucher` cannot be added to `applied`, or null. Shared by typed codes and the listed vouchers. */
const combinationReason = (applied, voucher) => {
    if (applied.length >= MAX_VOUCHERS_PER_ORDER) return { reason: "LIMIT", message: REJECTION.LIMIT() };
    if (voucher.type === TYPE_FREE_SHIPPING && applied.some((entry) => entry.type === TYPE_FREE_SHIPPING)) {
        return { reason: "FREE_SHIPPING_LIMIT", message: REJECTION.FREE_SHIPPING_LIMIT() };
    }
    return null;
};

const parseQuoteCodes = (codes) => {
    if (codes === undefined || codes === null) return [];
    if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string") || codes.length > MAX_QUOTE_CODES) {
        throw new VoucherError("VALIDATION_FAILED", "Danh sách voucher không hợp lệ.", 400);
    }
    return codes.map(normalizeCode).filter(Boolean);
};

/**
 * Price a cart without reserving anything. Uses the cart service lookups (same price, stock and
 * shipping rules checkout applies) and the database clock for voucher validity.
 * Returns { quote, rejected }; rejected codes never block the quote for the valid ones.
 */
const quote = async ({ items, codes, userId, pointsToUse } = {}) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new VoucherError("VALIDATION_FAILED", "Giỏ hàng trống, vui lòng thêm sản phẩm trước khi áp dụng voucher.", 400);
    }
    const itemsValid = items.every((item) => item
        && toInteger(item.variantId) > 0
        && toInteger(item.quantity) >= 1);
    if (!itemsValid) {
        throw new VoucherError("VALIDATION_FAILED", "Sản phẩm hoặc số lượng không hợp lệ.", 400);
    }
    const typedCodes = parseQuoteCodes(codes);
    const requestedPoints = parsePointsToUse(pointsToUse);
    const cart = await cartService.validateCartItems(items);
    if (!cart.validatedItems.some((item) => item.available)) {
        throw new VoucherError("CART_UNAVAILABLE", "Không có sản phẩm nào còn hàng để áp dụng voucher.", 409);
    }
    const { subtotal, shippingFee } = cart;

    const now = await voucherRepository.databaseNow();
    const found = new Map((await voucherRepository.findByCodes([...new Set(typedCodes)])).map((voucher) => [voucher.code, voucher]));

    const applied = [];
    const rejected = [];
    const seen = new Set();
    for (const code of typedCodes) {
        const reject = (reason, message) => rejected.push({ code, reason: message, reasonCode: reason });
        if (seen.has(code)) { reject("DUPLICATE", REJECTION.DUPLICATE(code)); continue; }
        seen.add(code);
        const voucher = found.get(code);
        if (!voucher) { reject("NOT_FOUND", REJECTION.NOT_FOUND(code)); continue; }
        const unusable = unusableReason(voucher, now);
        if (unusable) { reject(unusable.reason, unusable.message); continue; }
        const blocked = combinationReason(applied, voucher);
        if (blocked) { reject(blocked.reason, blocked.message); continue; }
        applied.push(voucher);
    }

    const pricing = calculateDiscount({ subtotal, shippingFee, vouchers: applied });
    const amountById = new Map(pricing.lines.map((line) => [line.voucherId, line.amount]));

    const listedVouchers = await voucherRepository.findListedInWindow(now);
    const appliedCodes = new Set(applied.map((voucher) => voucher.code));
    const listed = listedVouchers
        .filter((voucher) => !appliedCodes.has(voucher.code))
        .map((voucher) => {
            const blocked = combinationReason(applied, voucher);
            const estimatedDiscount = blocked
                ? 0
                : calculateDiscount({ subtotal, shippingFee, vouchers: [...applied, voucher] }).discount - pricing.discount;
            return {
                code: voucher.code,
                description: voucher.description,
                type: voucher.type,
                percent: voucher.percent,
                maxDiscount: voucher.maxDiscount,
                estimatedDiscount,
                selectable: !blocked,
                reason: blocked ? blocked.message : null
            };
        });

    // Loyalty points are priced on what is still payable after vouchers. Advisory only: a request above the balance is
    // capped here (checkout itself rejects it), so the customer sees what they can actually spend.
    const balance = userId ? await loyaltyRepository.getBalance(userId) : 0;
    const redemption = redeemPoints({ payable: pricing.totalPrice, balance, requested: Math.min(requestedPoints, balance) });

    return {
        quote: {
            subtotal,
            shippingFee,
            discount: pricing.discount,
            points: {
                balance,
                requested: requestedPoints,
                used: redemption.used,
                discount: redemption.discount,
                maxUsable: maxUsablePoints(pricing.totalPrice, balance),
                earned: earnedPoints(redemption.totalPrice)
            },
            totalPrice: redemption.totalPrice,
            applied: applied.map((voucher) => describeApplied(voucher, amountById.get(voucher.id))),
            listed
        },
        rejected
    };
};

module.exports = {
    VoucherError,
    createVoucher,
    deleteVoucher,
    getVoucher,
    listVouchers,
    quote,
    updateVoucher
};
