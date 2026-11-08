// ===== LOYALTY CALCULATOR =====
// Pure maths for Loyalty points (no I/O). 1 point = 1.000 VND; an Order earns 10% of its total as points.

const POINT_VALUE = 1_000;
const EARN_PERCENT = 10;

class PointsError extends Error {
    constructor(code, message, statusCode = 422) {
        super(message);
        this.name = "PointsError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

/**
 * The optional `pointsToUse` of a request: absent/null/"" means none; otherwise a non-negative integer
 * (a number, or a string of digits as sent by form fields). Anything else is rejected before any lock is taken.
 */
const parsePointsToUse = (value) => {
    if (value === undefined || value === null || value === "") return 0;
    const isDigits = typeof value === "string" && /^\d{1,9}$/.test(value.trim());
    const parsed = isDigits ? Number(value.trim()) : value;
    if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
        throw new PointsError("POINTS_INVALID", "Số điểm sử dụng phải là số nguyên không âm.");
    }
    return parsed;
};

/** Points earned for an Order total: floor(total * 10% / 1000), in whole-number arithmetic. */
const earnedPoints = (totalPrice) => {
    if (!Number.isSafeInteger(totalPrice) || totalPrice < 0) throw new TypeError("totalPrice must be a non-negative integer");
    return Math.floor((totalPrice * EARN_PERCENT) / (100 * POINT_VALUE));
};

/** The most points that can usefully be spent on `payable` VND: the last point may overshoot, so the total can reach 0. */
const maxUsablePoints = (payable, balance) => Math.min(Math.max(0, balance), Math.ceil(Math.max(0, payable) / POINT_VALUE));

/**
 * Price a redemption. `payable` is subtotal + shipping - voucher discount. Requesting more than the balance is
 * rejected; requesting more than the payable amount needs is capped, so only the needed points are spent.
 * @returns {{used:number, discount:number, totalPrice:number}}
 */
const redeemPoints = ({ payable, balance, requested }) => {
    if (requested > balance) {
        throw new PointsError("POINTS_INSUFFICIENT", `Bạn chỉ có ${balance.toLocaleString("vi-VN")} điểm, không thể dùng ${requested.toLocaleString("vi-VN")} điểm.`);
    }
    const used = Math.min(requested, maxUsablePoints(payable, balance));
    const discount = Math.min(used * POINT_VALUE, payable);
    return { used, discount, totalPrice: payable - discount };
};

module.exports = { POINT_VALUE, EARN_PERCENT, PointsError, parsePointsToUse, earnedPoints, maxUsablePoints, redeemPoints };
