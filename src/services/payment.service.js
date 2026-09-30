const crypto = require("node:crypto");
const QRCode = require("qrcode");
const paymentRepository = require("../repositories/payment.repository");
const orderService = require("./order.service");
const momo = require("./payment-providers/momo");
const vnpay = require("./payment-providers/vnpay");

const EXPIRY_MS = 5 * 60 * 1000;
const providers = Object.freeze({ MOMO: momo, VNPAY: vnpay });

const paymentError = (code, message, statusCode = 400) => {
    const error = new Error(message);
    error.name = "PaymentError";
    error.code = code;
    error.statusCode = statusCode;
    return error;
};

const normalizeOrigin = () => {
    let url;
    try {
        url = new URL(process.env.APP_ORIGIN || "");
    } catch {
        throw paymentError("PAYMENT_NOT_CONFIGURED", "Cổng thanh toán chưa được cấu hình", 503);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw paymentError("PAYMENT_NOT_CONFIGURED", "Cổng thanh toán chưa được cấu hình", 503);
    }
    return url.origin;
};

const providerConfig = (provider, attempt, request) => {
    const origin = normalizeOrigin();
    const returnUrl = new URL(`/checkouts.html?paymentAttemptId=${encodeURIComponent(attempt.id)}`, origin).href;
    if (provider === "MOMO") {
        const config = {
            partnerCode: process.env.MOMO_PARTNER_CODE,
            accessKey: process.env.MOMO_ACCESS_KEY,
            secretKey: process.env.MOMO_SECRET_KEY,
            redirectUrl: returnUrl,
            ipnUrl: new URL("/api/payments/momo/callback", origin).href
        };
        if (Object.values(config).some((value) => typeof value !== "string" || value.length === 0)) {
            throw paymentError("PAYMENT_NOT_CONFIGURED", "MoMo chưa được cấu hình", 503);
        }
        return config;
    }

    const config = {
        tmnCode: process.env.VNPAY_TMN_CODE,
        hashSecret: process.env.VNPAY_HASH_SECRET,
        payUrl: process.env.VNPAY_PAY_URL || "https://pay.vnpay.vn/vpcpay.html",
        returnUrl,
        ipAddr: String(request?.ip || "").replace(/^::ffff:/, "")
    };
    if (!config.tmnCode || !config.hashSecret || !process.env.VNPAY_IPN_URL) {
        throw paymentError("PAYMENT_NOT_CONFIGURED", "VNPay chưa được cấu hình", 503);
    }
    let ipnUrl;
    try {
        ipnUrl = new URL(process.env.VNPAY_IPN_URL);
    } catch {
        throw paymentError("PAYMENT_NOT_CONFIGURED", "VNPay chưa được cấu hình", 503);
    }
    if (ipnUrl.protocol !== "https:" || ipnUrl.pathname !== "/api/payments/vnpay/ipn" || ipnUrl.origin !== origin) {
        throw paymentError("PAYMENT_NOT_CONFIGURED", "VNPay IPN URL không hợp lệ", 503);
    }
    return config;
};

const publicAttempt = async (attempt) => {
    let qrDataUrl = null;
    if (attempt.qrPayload && attempt.status === "PENDING") {
        qrDataUrl = await QRCode.toDataURL(attempt.qrPayload, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 256
        });
    }
    return {
        id: attempt.id,
        orderId: attempt.orderId,
        provider: attempt.provider,
        amount: attempt.amount,
        status: attempt.status,
        expiresAt: attempt.expiresAt,
        qrDataUrl,
        paymentUrl: attempt.status === "PENDING" ? attempt.paymentUrl : null
    };
};

const createProviderPayment = async (order, attempt, request) => {
    const adapter = providers[attempt.provider];
    if (!adapter) throw paymentError("PAYMENT_METHOD_INVALID", "Phương thức thanh toán không hợp lệ");
    try {
        const result = await adapter.createPayment({
            attempt: { ...attempt, amount: Number(attempt.amount) },
            order: { ...order, amount: Number(attempt.amount) },
            config: providerConfig(attempt.provider, attempt, request)
        });
        if (attempt.provider === "MOMO" && !result.qrPayload) {
            throw new Error("MoMo QR capability is not enabled for this merchant");
        }
        const stored = await paymentRepository.updateProviderData(attempt.id, {
            qrPayload: result.qrPayload,
            paymentUrl: result.paymentUrl
        });
        return await publicAttempt(stored);
    } catch (error) {
        await paymentRepository.failAttempt(attempt.id).catch(() => undefined);
        if (error?.code === "PAYMENT_NOT_CONFIGURED" || error?.code === "PAYMENT_METHOD_INVALID") throw error;
        throw paymentError("PAYMENT_INITIATION_FAILED", "Không thể khởi tạo thanh toán. Tồn kho đã được giải phóng; hãy thử lại.", 502);
    }
};

const initializeAttempt = (order, attempt, request) => createProviderPayment(order, attempt, request);

const createRetry = async (orderId, provider, actor, request) => {
    const normalizedProvider = String(provider || "").toUpperCase();
    if (!providers[normalizedProvider]) throw paymentError("PAYMENT_METHOD_INVALID", "Phương thức thanh toán không hợp lệ");
    const order = await orderService.getOrderById(orderId, actor);
    const now = new Date();
    const amount = Number(order.totalPrice);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw paymentError("ORDER_AMOUNT_INVALID", "Số tiền đơn hàng không hợp lệ", 409);
    }
    const attempt = await paymentRepository.createRetryAttempt({
        id: crypto.randomBytes(16).toString("hex"),
        orderId: order.id,
        provider: normalizedProvider,
        amount,
        expiresAt: new Date(now.getTime() + EXPIRY_MS),
        now
    });
    return createProviderPayment(order, attempt, request);
};

const getAttempt = async (id, actor) => {
    let attempt = await paymentRepository.getAttempt(id);
    if (!attempt || String(attempt.userId || "") !== String(actor?.id || "")) {
        throw paymentError("PAYMENT_ATTEMPT_NOT_FOUND", "Không tìm thấy giao dịch thanh toán", 404);
    }
    if (attempt.status === "PENDING" && new Date(attempt.expiresAt) <= new Date()) {
        await paymentRepository.expireAttempt(attempt.id);
        attempt = await paymentRepository.getAttempt(id);
    }
    return publicAttempt(attempt);
};

const handleCallback = async (provider, { body, query }) => {
    const adapter = providers[provider];
    if (!adapter) throw paymentError("PAYMENT_PROVIDER_INVALID", "Cổng thanh toán không hợp lệ", 400);
    let config;
    if (provider === "MOMO") {
        config = {
            partnerCode: process.env.MOMO_PARTNER_CODE,
            accessKey: process.env.MOMO_ACCESS_KEY,
            secretKey: process.env.MOMO_SECRET_KEY
        };
    } else {
        config = { tmnCode: process.env.VNPAY_TMN_CODE, hashSecret: process.env.VNPAY_HASH_SECRET };
    }
    const parsed = adapter.parseCallback({ body, query, config });
    if (!parsed.signatureValid) return { accepted: false, code: "INVALID_SIGNATURE" };
    if (typeof parsed.providerReference !== "string" || !Number.isSafeInteger(parsed.amount) || parsed.amount <= 0) {
        return { accepted: false, code: "INVALID_CALLBACK" };
    }
    const result = await paymentRepository.processCallback({
        provider,
        providerReference: parsed.providerReference,
        amount: parsed.amount,
        successful: parsed.successful,
        providerTransactionId: parsed.callbackReference
    });
    return {
        accepted: result.outcome !== "NOT_FOUND" && result.outcome !== "AMOUNT_MISMATCH",
        code: result.outcome,
        ...result
    };
};

const listReconciliation = () => paymentRepository.listReconciliation();

module.exports = { createRetry, getAttempt, handleCallback, initializeAttempt, listReconciliation };
