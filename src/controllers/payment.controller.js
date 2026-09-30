const paymentService = require("../services/payment.service");

const sendError = (res, error) => {
    return res.status(error?.statusCode || 500).json({
        success: false,
        error: {
            code: error?.code || "PAYMENT_REQUEST_FAILED",
            message: error?.statusCode && error.statusCode < 500 ? error.message : "Không thể xử lý yêu cầu thanh toán"
        }
    });
};

const createRetry = async (req, res) => {
    try {
        const attempt = await paymentService.createRetry(req.params.orderId, req.body?.provider, req.user, req);
        return res.status(201).json({ success: true, data: attempt });
    } catch (error) {
        return sendError(res, error);
    }
};

const getAttempt = async (req, res) => {
    try {
        const attempt = await paymentService.getAttempt(req.params.id, req.user);
        return res.status(200).json({ success: true, data: attempt });
    } catch (error) {
        return sendError(res, error);
    }
};

const listReconciliation = async (_req, res) => {
    try {
        return res.status(200).json({ success: true, data: await paymentService.listReconciliation() });
    } catch (error) {
        return sendError(res, error);
    }
};

const momoCallback = async (req, res) => {
    try {
        const result = await paymentService.handleCallback("MOMO", { body: req.body, query: req.query });
        if (!result.accepted) return res.status(result.code === "INVALID_SIGNATURE" ? 400 : 404).end();
        return res.status(204).end();
    } catch {
        return res.status(500).end();
    }
};

const vnpayIpn = async (req, res) => {
    try {
        const result = await paymentService.handleCallback("VNPAY", { query: req.query, body: req.body });
        if (result.accepted) return res.status(200).json({ RspCode: "00", Message: "Confirm Success" });
        const responses = {
            INVALID_SIGNATURE: ["97", "Invalid signature"],
            NOT_FOUND: ["01", "Order not found"],
            AMOUNT_MISMATCH: ["04", "Invalid amount"]
        };
        const [RspCode, Message] = responses[result.code] || ["99", "Unable to process notification"];
        return res.status(200).json({ RspCode, Message });
    } catch {
        return res.status(200).json({ RspCode: "99", Message: "Unable to process notification" });
    }
};

module.exports = { createRetry, getAttempt, listReconciliation, momoCallback, vnpayIpn };
