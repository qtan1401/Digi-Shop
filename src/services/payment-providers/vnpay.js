"use strict";

const crypto = require("node:crypto");
const net = require("node:net");

const PRODUCTION_PAYMENT_URL = "https://pay.vnpay.vn/vpcpay.html";
const SIGNATURE_PATTERN = /^[a-fA-F0-9]{128}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const isRecord = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const requireString = (value, name) => {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Invalid VNPay ${name}`);
    }
    return value.trim();
};

const requireHttpsUrl = (value, name) => {
    let url;
    try {
        url = new URL(requireString(value, name));
    } catch {
        throw new Error(`Invalid VNPay ${name}`);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
        throw new Error(`Invalid VNPay ${name}`);
    }
    return url;
};

const formatVnTime = (date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
};

const formEncode = (value) =>
    encodeURIComponent(String(value))
        .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/%20/g, "+");

const getCanonicalData = (params) =>
    Object.keys(params)
        .filter((key) => key.startsWith("vnp_") && key !== "vnp_SecureHash" && key !== "vnp_SecureHashType")
        .sort()
        .map((key) => `${formEncode(key)}=${formEncode(params[key])}`)
        .join("&");

const sign = (data, secret) =>
    crypto.createHmac("sha512", secret).update(data, "utf8").digest("hex");

const signaturesMatch = (provided, expected) => {
    if (typeof provided !== "string" || !SIGNATURE_PATTERN.test(provided)) return false;
    const providedBytes = Buffer.from(provided, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    return providedBytes.length === expectedBytes.length && crypto.timingSafeEqual(providedBytes, expectedBytes);
};

const getSafeCallbackValue = (params, key, pattern) => {
    const value = params[key];
    return typeof value === "string" && pattern.test(value) ? value : null;
};

const parseCallback = ({ query, config } = {}) => {
    const params = isRecord(query) ? query : {};
    const providerReference = getSafeCallbackValue(params, "vnp_TxnRef", REFERENCE_PATTERN);
    const transactionNumber = getSafeCallbackValue(params, "vnp_TransactionNo", /^\d{1,15}$/);
    const amountRaw = getSafeCallbackValue(params, "vnp_Amount", /^\d{1,12}$/);
    const responseCode = getSafeCallbackValue(params, "vnp_ResponseCode", /^\d{2}$/);
    const transactionStatus = getSafeCallbackValue(params, "vnp_TransactionStatus", /^\d{2}$/);
    const merchantCode = getSafeCallbackValue(params, "vnp_TmnCode", /^[A-Za-z0-9]{8}$/);
    const signature = getSafeCallbackValue(params, "vnp_SecureHash", SIGNATURE_PATTERN);
    let amount = null;

    if (amountRaw && /^\d{1,12}$/.test(amountRaw)) {
        const minorAmount = Number(amountRaw);
        if (Number.isSafeInteger(minorAmount) && minorAmount > 0 && minorAmount % 100 === 0) {
            amount = minorAmount / 100;
        }
    }

    let signatureValid = false;
    if (
        isRecord(config) &&
        typeof config.hashSecret === "string" &&
        config.hashSecret.length > 0 &&
        /^[A-Za-z0-9]{8}$/.test(config.tmnCode) &&
        merchantCode === config.tmnCode &&
        signature &&
        Object.entries(params).every(([key, value]) =>
            !key.startsWith("vnp_") || (typeof value === "string" && value.length > 0)
        )
    ) {
        signatureValid = signaturesMatch(signature, sign(getCanonicalData(params), config.hashSecret));
    }

    return {
        providerReference,
        amount,
        successful:
            signatureValid &&
            REFERENCE_PATTERN.test(providerReference || "") &&
            amount !== null &&
            /^\d{1,15}$/.test(transactionNumber || "") &&
            responseCode === "00" &&
            transactionStatus === "00",
        callbackReference: transactionNumber,
        signatureValid,
    };
};

const createPayment = ({ attempt, order, config } = {}) => {
    if (!isRecord(attempt) || !isRecord(order) || !isRecord(config)) {
        throw new Error("Invalid VNPay payment input");
    }

    const attemptReference = attempt.id;
    if (typeof attemptReference !== "string" || !REFERENCE_PATTERN.test(attemptReference)) {
        throw new Error("Invalid VNPay attempt reference");
    }
    const amount = attempt.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error("Invalid VNPay amount");
    }
    const expiresAt = new Date(attempt.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw new Error("Invalid VNPay expiry");
    }

    const tmnCode = requireString(config.tmnCode, "merchant code");
    if (!/^[A-Za-z0-9]{8}$/.test(tmnCode)) throw new Error("Invalid VNPay merchant code");
    if (typeof config.hashSecret !== "string" || config.hashSecret.length === 0) {
        throw new Error("Invalid VNPay hash secret");
    }
    const hashSecret = config.hashSecret;
    const paymentUrl = requireHttpsUrl(config.payUrl, "payment URL");
    if (
        paymentUrl.origin !== "https://pay.vnpay.vn" ||
        paymentUrl.pathname !== "/vpcpay.html" ||
        paymentUrl.search
    ) {
        throw new Error("VNPay payment URL must use the production endpoint");
    }
    const returnUrl = requireHttpsUrl(config.returnUrl, "return URL");
    const ipAddress = requireString(config.ipAddr, "client IP address");
    if (ipAddress.length > 45 || net.isIP(ipAddress) === 0) {
        throw new Error("Invalid VNPay client IP address");
    }
    const orderReference = order.id;
    if (typeof orderReference !== "string" || !REFERENCE_PATTERN.test(orderReference)) {
        throw new Error("Invalid VNPay order reference");
    }
    const orderInfo = `Payment attempt ${attemptReference} for order ${orderReference}`;
    if (orderInfo.length > 255) throw new Error("Invalid VNPay order information");
    const params = {
        vnp_Version: "2.1.0",
        vnp_Command: "pay",
        vnp_TmnCode: tmnCode,
        vnp_Amount: String(amount * 100),
        vnp_BankCode: "VNPAYQR",
        vnp_CreateDate: formatVnTime(new Date()),
        vnp_CurrCode: "VND",
        vnp_IpAddr: ipAddress,
        vnp_Locale: "vn",
        vnp_OrderInfo: orderInfo,
        vnp_OrderType: "other",
        vnp_ReturnUrl: returnUrl.href,
        vnp_TxnRef: attemptReference,
        vnp_ExpireDate: formatVnTime(expiresAt),
    };
    if (amount > Math.floor(999999999999 / 100) || !Number.isSafeInteger(amount * 100)) {
        throw new Error("Invalid VNPay amount");
    }

    const query = Object.keys(params)
        .sort()
        .map((key) => `${formEncode(key)}=${formEncode(params[key])}`)
        .join("&");
    const secureHash = sign(getCanonicalData(params), hashSecret);
    const url = new URL(paymentUrl.href);
    url.search = `${query}&vnp_SecureHash=${secureHash}`;

    return {
        providerReference: attemptReference,
        qrPayload: null,
        paymentUrl: url.href,
        expiresAt: attempt.expiresAt,
    };
};

module.exports = { createPayment, parseCallback };
