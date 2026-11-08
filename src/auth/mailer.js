const nodemailer = require("nodemailer");
const { readMailerConfig } = require("./config");
const { VAT_PERCENT, includedVat } = require("../services/vat");

// 75299000 -> "75.299.000đ"
const formatMoney = (value) => `${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;

const formatPoints = (value) => Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const PAYMENT_METHOD_LABELS = Object.freeze({ MOMO: "MoMo", VNPAY: "VNPay" });
const paymentMethodLabel = (method) => PAYMENT_METHOD_LABELS[method] || String(method || "");

const formatOrderDate = (value) =>
    new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

// Product/option names and the customer's details are user-supplied; a CR/LF must never reach a header or split a text line.
const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const optionsLabel = (options) => {
    const entries = options && typeof options === "object" ? Object.entries(options) : [];
    return entries.map(([name, value]) => `${oneLine(name)}: ${oneLine(value)}`).join(", ");
};

/**
 * Renders the confirmation of an Order as { subject, text, html }.
 * Pure, so it is the single place to change the email's content; the recipient is chosen by the caller.
 */
const renderOrderConfirmation = (order) => {
    const customer = order.customer || {};
    const items = (order.items || []).map((item) => ({
        name: oneLine(item.name),
        options: optionsLabel(item.options),
        quantity: item.quantity,
        unitPrice: formatMoney(item.unitPrice),
        lineTotal: formatMoney(item.lineTotal)
    }));
    const rows = [
        ["Tạm tính", formatMoney(order.subtotal)],
        [`Đã bao gồm VAT ${VAT_PERCENT}%`, formatMoney(includedVat(order.subtotal))],
        ["Phí vận chuyển", formatMoney(order.shippingFee)],
        ["Giảm giá", Number(order.discount) > 0 ? `-${formatMoney(order.discount)}` : formatMoney(0)],
        ...(Number(order.pointsRedeemed) > 0
            ? [[`Điểm đã dùng (${formatPoints(order.pointsRedeemed)} điểm)`, `-${formatMoney(order.pointsDiscount)}`]]
            : []),
        ["Tổng cộng", formatMoney(order.totalPrice)]
    ];
    // 1 point = 1.000đ. Points are only spendable once credited: after delivery (COD / bank transfer) or after payment (online).
    const earnedNote = Number(order.pointsEarned) > 0
        ? `Bạn sẽ nhận được ${formatPoints(order.pointsEarned)} điểm thưởng từ đơn hàng này (tương đương ${formatMoney(Number(order.pointsEarned) * 1000)}), ${
            order.pointsCredited
                ? "đã được cộng vào tài khoản."
                : ["MOMO", "VNPAY"].includes(order.paymentMethod)
                    ? "được cộng vào tài khoản sau khi thanh toán thành công."
                    : "được cộng vào tài khoản sau khi đơn hàng được giao thành công."
        }`
        : "";
    const details = [
        ["Mã đơn hàng", oneLine(order.id)],
        ["Ngày đặt", formatOrderDate(order.createdAt)],
        ["Người nhận", oneLine(customer.name)],
        ["Số điện thoại", oneLine(customer.phone)],
        ["Địa chỉ giao hàng", oneLine(customer.address)],
        ["Phương thức thanh toán", oneLine(paymentMethodLabel(order.paymentMethod))]
    ];

    const text = [
        "Cảm ơn bạn đã đặt hàng tại Digi-Shop!",
        "",
        ...details.map(([label, value]) => `${label}: ${value}`),
        "",
        "Sản phẩm:",
        ...items.map((item) =>
            `- ${item.name}${item.options ? ` (${item.options})` : ""} x ${item.quantity}: ${item.unitPrice} / sản phẩm = ${item.lineTotal}`),
        "",
        ...rows.map(([label, value]) => `${label}: ${value}`),
        ...(earnedNote ? ["", earnedNote] : [])
    ].join("\n");

    const cell = "padding:6px 8px;border-bottom:1px solid #e5e5e5;";
    const html = `<div style="font-family:Arial,sans-serif;color:#222;max-width:640px">
<h2 style="margin:0 0 12px">Cảm ơn bạn đã đặt hàng tại Digi-Shop!</h2>
<table style="border-collapse:collapse;margin-bottom:16px">${details.map(([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join("")}</table>
<table style="border-collapse:collapse;width:100%;margin-bottom:16px">
<tr><th align="left" style="${cell}">Sản phẩm</th><th align="right" style="${cell}">SL</th><th align="right" style="${cell}">Đơn giá</th><th align="right" style="${cell}">Thành tiền</th></tr>
${items.map((item) => `<tr><td style="${cell}">${escapeHtml(item.name)}${item.options ? `<br><small style="color:#666">${escapeHtml(item.options)}</small>` : ""}</td><td align="right" style="${cell}">${escapeHtml(item.quantity)}</td><td align="right" style="${cell}">${escapeHtml(item.unitPrice)}</td><td align="right" style="${cell}">${escapeHtml(item.lineTotal)}</td></tr>`).join("\n")}
</table>
<table style="border-collapse:collapse;margin-left:auto">${rows.map(([label, value], index) =>
        `<tr><td style="padding:2px 12px;${index === rows.length - 1 ? "font-weight:bold;" : ""}">${escapeHtml(label)}</td><td align="right" style="${index === rows.length - 1 ? "font-weight:bold;" : ""}">${escapeHtml(value)}</td></tr>`).join("")}</table>
${earnedNote ? `<p style="margin:16px 0 0">${escapeHtml(earnedNote)}</p>` : ""}
</div>`;

    return { subject: `Digi-Shop - Xác nhận đơn hàng ${oneLine(order.id)}`, text, html };
};

/** The email a guest receives when checkout created an account for their address: what it is and how to set a password. */
const renderGuestAccountEmail = ({ recoverUrl }) => {
    const lines = [
        "Digi-Shop đã tạo tài khoản cho địa chỉ email này khi bạn đặt hàng mà không đăng nhập.",
        "Các đơn hàng của bạn được lưu trong tài khoản để bạn xem lại sau.",
        `Để đặt mật khẩu, hãy mở ${recoverUrl} và nhập email này; chúng tôi sẽ gửi link đặt mật khẩu.`,
        "Nếu bạn không đặt hàng tại Digi-Shop, bạn có thể bỏ qua email này."
    ];
    const html = `<div style="font-family:Arial,sans-serif;color:#222;max-width:640px">
<h2 style="margin:0 0 12px">Tài khoản Digi-Shop của bạn</h2>
<p>${escapeHtml(lines[0])}</p>
<p>${escapeHtml(lines[1])}</p>
<p>Để đặt mật khẩu, hãy mở <a href="${escapeHtml(recoverUrl)}">trang quên mật khẩu</a> và nhập email này; chúng tôi sẽ gửi link đặt mật khẩu.</p>
<p style="color:#666">${escapeHtml(lines[3])}</p>
</div>`;
    return { subject: "Digi-Shop - Tài khoản của bạn đã được tạo", text: lines.join("\n\n"), html };
};

class NodemailerSmtpMailer {
    constructor({ config = readMailerConfig(), transport } = {}) {
        this.config = config;
        this.transport = transport || nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: { user: config.smtp.user, pass: config.smtp.password }
        });
    }

    async sendVerificationEmail({ to, token, expiresAt }) {
        const url = new URL("/verify-email.html", this.config.appOrigins[0]);
        url.searchParams.set("token", token);
        await this.transport.sendMail({
            from: this.config.mailFrom,
            to,
            subject: "Digi-Shop - Xác minh email",
            text: `Mở liên kết sau để xác minh email trước ${formatOrderDate(expiresAt)}: ${url.toString()}`
        });
    }

    // kind "set": first password of a new account; "reset": forgotten password. The link works once, for 30 minutes.
    async sendPasswordResetEmail({ to, token, expiresAt, kind = "reset" }) {
        const url = new URL("/reset-password.html", this.config.appOrigins[0]);
        url.searchParams.set("token", token);
        const isSet = kind === "set";
        await this.transport.sendMail({
            from: this.config.mailFrom,
            to,
            subject: isSet ? "Digi-Shop - Đặt mật khẩu cho tài khoản mới" : "Digi-Shop - Đặt lại mật khẩu",
            text: [
                isSet ? "Mở liên kết sau để đặt mật khẩu cho tài khoản Digi-Shop của bạn:" : "Mở liên kết sau để đặt lại mật khẩu Digi-Shop của bạn:",
                url.toString(),
                `Liên kết dùng được một lần và hết hạn lúc ${formatOrderDate(expiresAt)}.`,
                "Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại không thay đổi."
            ].join("\n\n")
        });
    }

    // Sent once to the owner of an account that guest checkout just created for this address.
    async sendGuestAccountEmail({ to }) {
        const { subject, text, html } = renderGuestAccountEmail({ recoverUrl: new URL("/recover.html", this.config.appOrigins[0]).toString() });
        await this.transport.sendMail({ from: this.config.mailFrom, to, subject, text, html });
    }

    async sendOrderConfirmationEmail({ to, order }) {
        const { subject, text, html } = renderOrderConfirmation(order);
        await this.transport.sendMail({ from: this.config.mailFrom, to, subject, text, html });
    }
}

module.exports = { NodemailerSmtpMailer, renderOrderConfirmation, renderGuestAccountEmail, formatMoney };
