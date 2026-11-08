// ===== VOUCHER CALCULATOR =====
// Pure Discount rules (docs/specs/vouchers-and-product-reviews.md, "Redemption rules").
// No I/O: shared by the quote endpoint and the checkout transaction.

const MAX_VOUCHERS_PER_ORDER = 3;
const MAX_FREE_SHIPPING_PER_ORDER = 1;
const MAX_DISCOUNT_PER_VOUCHER = 500_000;
const MAX_DISCOUNT_PER_ORDER = 1_000_000;
const MIN_TOTAL_PRICE = 1_000;

// Vouchers do not expire (course spec). The columns stay required, so every voucher gets this end date.
const NO_EXPIRY_DATE = new Date("9999-12-31T00:00:00.000Z");
const CODE_LENGTH = 5;
const MAX_USES_PER_CODE = 10;

const TYPE_PERCENT = "PERCENT";
const TYPE_FREE_SHIPPING = "FREE_SHIPPING";

class VoucherRuleError extends Error {
    constructor(code, message, statusCode = 422) {
        super(message);
        this.name = "VoucherRuleError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const MESSAGES = Object.freeze({
    VOUCHER_DUPLICATE: (code) => `Voucher ${code} đã được áp dụng.`,
    VOUCHER_LIMIT_EXCEEDED: () => `Mỗi đơn hàng chỉ áp dụng tối đa ${MAX_VOUCHERS_PER_ORDER} voucher.`,
    VOUCHER_FREE_SHIPPING_LIMIT: () => "Mỗi đơn hàng chỉ áp dụng một voucher miễn phí vận chuyển."
});

const ruleError = (code, voucherCode) => new VoucherRuleError(code, MESSAGES[code](voucherCode));

const normalizeCode = (value) => typeof value === "string" ? value.trim().toUpperCase() : "";

const CODE_PATTERN = new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`);

/**
 * Course spec: a code is exactly 5 letters or digits. Rows created before that rule (8-9 characters, lower case, symbols)
 * stay in the database and in the administrator's list, but customers can neither see nor redeem them.
 */
const isCompliantCode = (code) => typeof code === "string" && CODE_PATTERN.test(code.toUpperCase());

/**
 * Reason a voucher cannot be redeemed right now, or null when it can.
 * `now` is a Date; the window is inclusive at both ends.
 */
const unusableReason = (voucher, now) => {
    if (!isCompliantCode(voucher.code)) {
        return { reason: "NOT_FOUND", message: `Mã voucher ${voucher.code} không tồn tại.` };
    }
    if (!voucher.isEnabled) {
        return { reason: "DISABLED", message: `Voucher ${voucher.code} đã bị vô hiệu hóa.` };
    }
    const time = now.getTime();
    if (time < new Date(voucher.startsAt).getTime()) {
        return { reason: "NOT_STARTED", message: `Voucher ${voucher.code} chưa đến thời gian áp dụng.` };
    }
    if (time > new Date(voucher.endsAt).getTime()) {
        return { reason: "EXPIRED", message: `Voucher ${voucher.code} đã hết hạn.` };
    }
    if (voucher.redeemedCount >= voucher.quantity) {
        return { reason: "EXHAUSTED", message: `Voucher ${voucher.code} đã hết lượt sử dụng.` };
    }
    return null;
};

/**
 * Per-order combination rules 1-2. Throws VoucherRuleError.
 */
const assertCombination = (vouchers) => {
    const seen = new Set();
    for (const voucher of vouchers) {
        const key = voucher.id ?? voucher.code;
        if (seen.has(key)) throw ruleError("VOUCHER_DUPLICATE", voucher.code);
        seen.add(key);
    }
    if (vouchers.length > MAX_VOUCHERS_PER_ORDER) throw ruleError("VOUCHER_LIMIT_EXCEEDED");
    if (vouchers.filter((voucher) => voucher.type === TYPE_FREE_SHIPPING).length > MAX_FREE_SHIPPING_PER_ORDER) {
        throw ruleError("VOUCHER_FREE_SHIPPING_LIMIT");
    }
};

const requireMoney = (value, name) => {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${name} must be a non-negative integer`);
    }
    return value;
};

const rawAmount = (voucher, subtotal, shippingFee) => {
    if (voucher.type === TYPE_FREE_SHIPPING) return shippingFee;
    if (voucher.type !== TYPE_PERCENT) throw new TypeError(`Unknown voucher type: ${voucher.type}`);
    const percent = Math.min(100, Math.max(0, Math.trunc(Number(voucher.percent) || 0)));
    const product = subtotal * percent;
    const share = (product - (product % 100)) / 100; // whole VND, rounded down
    const cap = Math.min(MAX_DISCOUNT_PER_VOUCHER, Math.max(0, Math.trunc(Number(voucher.maxDiscount) || 0)));
    return Math.min(share, cap);
};

// Take `excess` VND away starting from the last voucher backwards.
const reduceFromEnd = (amounts, excess, eligible = () => true) => {
    let remaining = excess;
    for (let index = amounts.length - 1; index >= 0 && remaining > 0; index -= 1) {
        if (!eligible(index)) continue;
        const taken = Math.min(amounts[index], remaining);
        amounts[index] -= taken;
        remaining -= taken;
    }
};

/**
 * @param {{subtotal:number, shippingFee:number, vouchers:Array<{id?:number, code?:string, type:string, percent?:number|null, maxDiscount?:number|null}>}} input
 *        vouchers are in application order.
 * @returns {{lines:Array<{voucherId:any, amount:number}>, discount:number, totalPrice:number}}
 */
const calculateDiscount = ({ subtotal, shippingFee, vouchers = [] }) => {
    requireMoney(subtotal, "subtotal");
    requireMoney(shippingFee, "shippingFee");
    assertCombination(vouchers);

    const amounts = vouchers.map((voucher) => rawAmount(voucher, subtotal, shippingFee));

    // Rule 4: Discount on goods never exceeds the subtotal.
    const goodsTotal = amounts.reduce(
        (sum, amount, index) => vouchers[index].type === TYPE_PERCENT ? sum + amount : sum,
        0
    );
    if (goodsTotal > subtotal) {
        reduceFromEnd(amounts, goodsTotal - subtotal, (index) => vouchers[index].type === TYPE_PERCENT);
    }

    // Rules 5 and 6: per-Order cap, and the payable floor (never rejects, only reduces).
    const orderCap = Math.min(MAX_DISCOUNT_PER_ORDER, Math.max(0, subtotal + shippingFee - MIN_TOTAL_PRICE));
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    if (total > orderCap) reduceFromEnd(amounts, total - orderCap);

    const discount = amounts.reduce((sum, amount) => sum + amount, 0);
    return {
        lines: vouchers.map((voucher, index) => ({ voucherId: voucher.id, amount: amounts[index] })),
        discount,
        totalPrice: subtotal + shippingFee - discount
    };
};

module.exports = {
    MAX_VOUCHERS_PER_ORDER,
    MAX_DISCOUNT_PER_VOUCHER,
    MAX_DISCOUNT_PER_ORDER,
    MIN_TOTAL_PRICE,
    NO_EXPIRY_DATE,
    CODE_LENGTH,
    MAX_USES_PER_CODE,
    TYPE_PERCENT,
    TYPE_FREE_SHIPPING,
    VoucherRuleError,
    isCompliantCode,
    assertCombination,
    calculateDiscount,
    normalizeCode,
    unusableReason
};
