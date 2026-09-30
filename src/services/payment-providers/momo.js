const crypto = require("node:crypto");

const CREATE_URL = "https://payment.momo.vn/v2/gateway/api/create";
const MIN_AMOUNT = 1_000;
const MAX_AMOUNT = 50_000_000;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const requiredString = (value, name, maxLength = Infinity) => {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value) {
        throw new Error(`Invalid MoMo ${name}.`);
    }
    return value;
};

const normalizeAmount = (value) => {
    const amount = typeof value === "number" ? value :
        (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN);
    if (!Number.isSafeInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
        throw new Error("Invalid MoMo payment amount.");
    }
    return amount;
};

const isValidAmount = (value) => {
    if (!(typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))) return false;
    const amount = Number(value);
    return Number.isSafeInteger(amount) && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT;
};

const hmac = (secretKey, data) =>
    crypto.createHmac("sha256", secretKey).update(data, "utf8").digest("hex");

const signatureMatches = (provided, expected) => {
    if (typeof provided !== "string" || !/^[a-f\d]{64}$/i.test(provided)) return false;
    const actualBuffer = Buffer.from(provided, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const validHttpsUrl = (value, name) => {
    requiredString(value, name, 2048);
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`Invalid MoMo ${name}.`);
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
        throw new Error(`Invalid MoMo ${name}.`);
    }
    return value;
};

const configValues = (config) => {
    if (!isRecord(config)) throw new Error("Invalid MoMo configuration.");
    const partnerCode = requiredString(config.partnerCode, "partner code", 50);
    const accessKey = requiredString(config.accessKey, "access key");
    const secretKey = requiredString(config.secretKey, "secret key");
    const redirectUrl = validHttpsUrl(config.redirectUrl, "redirect URL");
    const ipnUrl = validHttpsUrl(config.ipnUrl, "IPN URL");
    const apiUrl = config.apiUrl === undefined ? CREATE_URL : requiredString(config.apiUrl, "API URL", 2048);
    let parsedApiUrl;
    try {
        parsedApiUrl = new URL(apiUrl);
    } catch {
        throw new Error("Invalid MoMo API URL.");
    }
    if (parsedApiUrl.href !== CREATE_URL || parsedApiUrl.username || parsedApiUrl.password) {
        throw new Error("Invalid MoMo API URL.");
    }
    return { partnerCode, accessKey, secretKey, redirectUrl, ipnUrl, apiUrl };
};

const createPayment = async ({ attempt, order, config, fetchImpl = fetch }) => {
    const settings = configValues(config);
    if (!isRecord(attempt) || !isRecord(order) || typeof fetchImpl !== "function") {
        throw new Error("Invalid MoMo payment request.");
    }

    const attemptId = requiredString(String(attempt.id ?? attempt.attemptId ?? ""), "payment attempt reference", 180);
    if (!/^[0-9a-zA-Z]([-_.]*[0-9a-zA-Z]+)*$/.test(attemptId)) {
        throw new Error("Invalid MoMo payment attempt reference.");
    }
    const providerReference = attemptId;
    const amount = normalizeAmount(attempt.amount ?? order.totalPrice ?? order.amount);
    const orderInfo = requiredString(
        typeof order.orderInfo === "string" && order.orderInfo.length > 0 ? order.orderInfo : `Payment ${providerReference}`,
        "order information",
        255
    );

    const request = {
        partnerCode: settings.partnerCode,
        requestId: providerReference,
        orderId: providerReference,
        amount,
        orderInfo,
        redirectUrl: settings.redirectUrl,
        ipnUrl: settings.ipnUrl,
        requestType: "captureWallet",
        extraData: "",
        lang: "en"
    };
    const signatureData = [
        `accessKey=${settings.accessKey}`,
        `amount=${request.amount}`,
        `extraData=${request.extraData}`,
        `ipnUrl=${request.ipnUrl}`,
        `orderId=${request.orderId}`,
        `orderInfo=${request.orderInfo}`,
        `partnerCode=${request.partnerCode}`,
        `redirectUrl=${request.redirectUrl}`,
        `requestId=${request.requestId}`,
        `requestType=${request.requestType}`
    ].join("&");
    request.signature = hmac(settings.secretKey, signatureData);

    let response;
    try {
        response = await fetchImpl(settings.apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            redirect: "error",
            signal: AbortSignal.timeout(30_000)
        });
    } catch {
        throw new Error("MoMo payment request failed.");
    }
    if (!response || !response.ok || typeof response.json !== "function") {
        throw new Error("MoMo payment request failed.");
    }

    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error("Invalid MoMo payment response.");
    }
    if (!isRecord(result) || String(result.resultCode) !== "0" ||
        result.partnerCode !== settings.partnerCode || result.orderId !== providerReference ||
        result.requestId !== providerReference || !isValidAmount(result.amount) ||
        Number(result.amount) !== amount) {
        throw new Error("MoMo rejected the payment request.");
    }

    const responseSignatureData = [
        `accessKey=${settings.accessKey}`,
        `amount=${result.amount}`,
        `message=${requiredString(result.message, "response message", 2048)}`,
        `orderId=${result.orderId}`,
        `partnerCode=${result.partnerCode}`,
        `payUrl=${typeof result.payUrl === "string" ? result.payUrl : ""}`,
        `requestId=${result.requestId}`,
        `responseTime=${requiredString(String(result.responseTime ?? ""), "response time")}`,
        `resultCode=${result.resultCode}`
    ].join("&");
    if (!signatureMatches(result.signature, hmac(settings.secretKey, responseSignatureData))) {
        throw new Error("Invalid MoMo payment response signature.");
    }
    const paymentUrl = typeof result.payUrl === "string" && result.payUrl.length > 0
        ? validHttpsUrl(result.payUrl, "payment URL")
        : null;
    const qrPayload = typeof result.qrCodeUrl === "string" && result.qrCodeUrl.length > 0
        ? result.qrCodeUrl
        : null;
    if (!paymentUrl && !qrPayload) throw new Error("MoMo returned no payment method.");

    return { providerReference, qrPayload, paymentUrl, expiresAt: null };
};

const parseCallback = ({ body, query, config } = {}) => {
    const invalid = {
        providerReference: null,
        amount: null,
        successful: false,
        callbackReference: null,
        signatureValid: false
    };
    try {
        if (!isRecord(config) || !isRecord(body)) return invalid;
        // MoMo's server-to-server IPN body is authoritative. Redirect query parameters
        // are intentionally not used as payment confirmation.
        const callback = body;
        const accessKey = requiredString(config.accessKey, "access key");
        const secretKey = requiredString(config.secretKey, "secret key");
        const partnerCode = requiredString(config.partnerCode, "partner code", 50);
        const providerReference = requiredString(callback.orderId, "callback order reference", 200);
        const amount = callback.amount;
        if (!/^[0-9a-zA-Z]([-_.]*[0-9a-zA-Z]+)*$/.test(providerReference) ||
            !isValidAmount(amount) || callback.partnerCode !== partnerCode) return invalid;
        const fields = [
            ["amount", amount],
            ["extraData", callback.extraData],
            ["message", callback.message],
            ["orderId", callback.orderId],
            ["orderInfo", callback.orderInfo],
            ["orderType", callback.orderType],
            ["partnerCode", callback.partnerCode],
            ["payType", callback.payType],
            ["requestId", callback.requestId],
            ["responseTime", callback.responseTime],
            ["resultCode", callback.resultCode],
            ["transId", callback.transId]
        ];
        if (fields.some(([, value]) => value === undefined || value === null ||
            !(typeof value === "string" || (typeof value === "number" && Number.isFinite(value))))) return invalid;
        const transactionId = typeof callback.transId === "number"
            ? Number.isSafeInteger(callback.transId) && callback.transId > 0
            : typeof callback.transId === "string" && /^[1-9]\d*$/.test(callback.transId);
        if (!transactionId) return invalid;
        if (callback.requestId !== providerReference) return invalid;
        const signatureData = `accessKey=${accessKey}&${fields.map(([key, value]) => `${key}=${value}`).join("&")}`;
        const signatureValid = signatureMatches(callback.signature, hmac(secretKey, signatureData));
        return {
            providerReference,
            amount: Number(amount),
            successful: signatureValid && String(callback.resultCode) === "0",
            callbackReference: String(callback.transId),
            signatureValid
        };
    } catch {
        return invalid;
    }
};

module.exports = { createPayment, parseCallback };
