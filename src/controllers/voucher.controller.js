// ===== VOUCHER CONTROLLER (customer) =====
// POST /api/vouchers/quote: price a cart with the typed/selected voucher codes. No reservation.

const voucherService = require("../services/voucher.service");
const guestAccount = require("../services/guest-account.service");

const sendError = (res, error) => {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const known = Number.isInteger(error?.statusCode) && error.code;
    // Unexpected failures keep their detail out of the response.
    return res.status(status).json({
        success: false,
        error: known
            ? { code: error.code, message: error.message }
            : { code: "VOUCHER_REQUEST_FAILED", message: "Không thể áp dụng voucher, vui lòng thử lại." }
    });
};

const respondWithQuote = async (res, input) => {
    try {
        const { quote: data, rejected } = await voucherService.quote(input);
        if (rejected.length > 0) {
            return res.status(422).json({
                success: false,
                error: {
                    code: "VOUCHER_REJECTED",
                    message: rejected.map((entry) => entry.reason).join(" "),
                    details: rejected
                },
                data
            });
        }
        return res.json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

const quote = (req, res) => {
    const { items, codes, pointsToUse } = req.body || {};
    return respondWithQuote(res, { items, codes, pointsToUse, userId: req.user.id });
};

// Guest quote: no account, so no balance and no points. Same pricing path as the signed-in quote.
const guestQuote = (req, res) => {
    try {
        guestAccount.parseGuestRequest(req.body || {});
    } catch (error) {
        return sendError(res, error);
    }
    const { items, codes } = req.body;
    return respondWithQuote(res, { items, codes });
};

module.exports = { quote, guestQuote };
