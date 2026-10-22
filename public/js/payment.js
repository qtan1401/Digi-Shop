// ===== PAYMENT.JS =====
// Checkout view for cart and buy-now modes. Guest submits are auth-guarded;
// authenticated checkout is the only path that can call the Order API.

const getUrlParam = (param) => new URLSearchParams(window.location.search).get(param);
const formatPrice = (price) => Number(price || 0).toLocaleString("vi-VN") + "₫";
const SHIPPING_FEE = 100000;
const MOMO_MAX_AMOUNT = 50_000_000; // Keep in sync with the server-side MoMo adapter.

let currentProduct = null;
let currentVariant = null;
let currentQuantity = 1;
let cartItems = null;
let checkoutDraft = null;
let checkoutBlocked = false;
let checkoutLoading = false;
let activePaymentOrder = null;
let activePaymentAttempt = null;
let paymentPollTimer = null;
let paymentCountdownTimer = null;
let paymentRetryLoading = false;

const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const unwrap = (value) => value && Object.prototype.hasOwnProperty.call(value, "data") ? value.data : value;
const currentSession = () => CartService.getSession();
const isAdminSession = () => currentSession().user?.role === "admin";
const isUserSession = () => currentSession().user?.role === "user";

const authApi = async (path, options = {}) => {
    if (!window.DigiAuth?.api) throw new Error("Vui lòng đăng nhập để tiếp tục.");
    return window.DigiAuth.api(path, { credentials: "same-origin", ...options });
};

const computeSubtotal = () => {
    if (Array.isArray(cartItems)) {
        return cartItems.reduce((sum, item) => {
            if (item.available === false) return sum;
            return sum + Number(item.price || 0) * Number(item.quantity || 0);
        }, 0);
    }
    if (currentVariant && currentVariant.stock > 0) return Number(currentVariant.price || 0) * currentQuantity;
    return 0;
};
const computeShipping = () => SHIPPING_FEE;

const refreshSummary = () => {
    const subtotal = computeSubtotal();
    const shipping = computeShipping(subtotal);
    const setEl = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setEl("summary-subtotal", formatPrice(subtotal));
    setEl("summary-shipping", formatPrice(shipping));
    setEl("summary-total", formatPrice(subtotal + shipping));
    if (currentVariant) setEl("checkout-total-price", formatPrice(Number(currentVariant.price || 0) * currentQuantity));
};

const updateQtyDisplay = () => {
    const input = document.getElementById("qty-input");
    if (input) input.value = String(currentQuantity);
};

const increaseQty = () => {
    if (currentVariant && currentQuantity < Number(currentVariant.stock || 0)) {
        currentQuantity += 1;
        refreshSummary();
        updateQtyDisplay();
    }
};
const decreaseQty = () => {
    if (currentQuantity > 1) {
        currentQuantity -= 1;
        refreshSummary();
        updateQtyDisplay();
    }
};
const updateTotal = refreshSummary;

const formValues = () => ({
    customerName: document.getElementById("customer-name")?.value?.trim() || "",
    customerPhone: document.getElementById("customer-phone")?.value?.trim() || "",
    customerAddress: document.getElementById("customer-address")?.value?.trim() || "",
    paymentMethod: document.getElementById("payment-method")?.value || "COD",
    note: document.getElementById("customer-note")?.value?.trim() || ""
});

const validateForm = () => {
    let valid = true;
    const rules = [
        ["customer-name", "error-name", (value) => value.trim().length >= 2, "Họ và tên không được để trống (tối thiểu 2 ký tự)."],
        ["customer-phone", "error-phone", (value) => /^(0|\+84)[0-9]{8,10}$/.test(value.trim()), "Số điện thoại không hợp lệ (VD: 0912345678)."],
        ["customer-address", "error-address", (value) => value.trim().length >= 5, "Địa chỉ nhận hàng không được để trống (tối thiểu 5 ký tự)."]
    ];
    let firstInvalid = null;
    rules.forEach(([inputId, errorId, test, message]) => {
        const input = document.getElementById(inputId);
        const error = document.getElementById(errorId);
        if (!input || !error) return;
        const ok = test(input.value);
        input.classList.toggle("checkout-input--error", !ok);
        error.textContent = ok ? "" : message;
        error.style.display = ok ? "none" : "block";
        if (!ok && !firstInvalid) firstInvalid = input;
        valid = valid && ok;
    });
    firstInvalid?.focus();
    return valid;
};

const attachLiveValidation = () => {
    ["customer-name", "customer-phone", "customer-address"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", () => {
            const error = document.getElementById("error-" + id.replace("customer-", ""));
            if (error) { error.textContent = ""; error.style.display = "none"; }
            document.getElementById(id)?.classList.remove("checkout-input--error");
        });
    });
};

const draftMode = () => Array.isArray(cartItems) ? "cart" : "buy-now";
const draftProductId = () => currentProduct?.id ?? Number(getUrlParam("id"));
const draftVariantId = () => currentVariant?.id ?? Number(getUrlParam("variantId"));
const currentSnapshot = () => Array.isArray(cartItems)
    ? cartItems.map((item) => ({ ...item }))
    : currentProduct && currentVariant ? [{
        variantId: Number(currentVariant.id),
        productId: Number(currentProduct.id),
        name: currentProduct.name,
        variantLabel: Object.entries(currentVariant.optionValues || {}).map(([name, value]) => `${name}: ${value}`).join(" · "),
        optionValues: currentVariant.optionValues || {},
        sku: currentVariant.sku,
        image: currentProduct.image,
        description: currentProduct.description,
        price: currentVariant.price,
        stock: currentVariant.stock,
        quantity: currentQuantity
    }] : [];

const saveCheckoutDraft = () => {
    if (!window.DigiCheckoutState?.saveDraft) return null;
    return window.DigiCheckoutState.saveDraft({
        mode: draftMode(),
        productId: draftProductId(),
        variantId: draftVariantId(),
        cartSnapshot: currentSnapshot(),
        form: formValues(),
        returnPath: window.DigiCheckoutState.currentReturnPath(draftMode(), draftProductId(), draftVariantId())
    });
};

const showCheckoutError = (message) => {
    const alert = document.getElementById("checkout-error-alert");
    if (alert) {
        alert.textContent = "⚠ " + String(message || "Đã xảy ra lỗi.");
        alert.style.display = "block";
        alert.focus?.();
    }
};

const renderForbidden = () => {
    const container = document.getElementById("payment-info");
    if (!container) return;
    container.innerHTML = `
        <div class="checkout-auth-forbidden" role="alert" tabindex="-1">
            <div class="checkout-auth-forbidden__code">403</div>
            <h2>Admin không thể thanh toán</h2>
            <p>Checkout chỉ dành cho tài khoản User. Dữ liệu mua hàng không được hiển thị cho Admin.</p>
            <div class="checkout-auth-forbidden__actions">
                <a class="btn btn--primary" href="/admin.html">Về quản trị</a>
                <a class="btn btn--secondary" href="/">Mở storefront</a>
            </div>
        </div>`;
    container.querySelector("[tabindex]")?.focus();
};

const adjustmentReason = (reason) => ({
    stock_capped: "do tồn kho",
    out_of_stock: "phiên bản đã hết hàng",
    soft_deleted: "sản phẩm đã ngừng kinh doanh",
    not_found: "phiên bản không còn tồn tại",
    variant_unavailable: "phiên bản không còn khả dụng"
}[reason] || "theo tình trạng phiên bản");

const renderMergeBanner = () => {
    const adjustments = window.DigiCheckoutState?.readMergeReport?.() || [];
    if (!adjustments.length || !checkoutDraft || !isUserSession()) return "";
    const rows = adjustments.map((adjustment) => {
        const item = (cartItems || []).find((candidate) => Number(candidate.variantId) === Number(adjustment.variantId));
        const name = item?.name || `Phiên bản #${adjustment.variantId}`;
        return `<li><strong>${escapeHtml(name)}</strong>: ${adjustment.requestedQuantity} → ${adjustment.finalQuantity} ${escapeHtml(adjustmentReason(adjustment.reason))}.</li>`;
    }).join("");
    return `
        <section class="checkout-merge-banner" id="checkout-merge-banner" role="status" aria-live="polite" tabindex="-1">
            <h2>Giỏ hàng đã được cập nhật</h2>
            <p>Một số sản phẩm thay đổi sau khi đăng nhập. Hãy kiểm tra lại trước khi xác nhận thanh toán.</p>
            <ul>${rows}</ul>
            <a href="/cart.html" class="checkout-merge-banner__link">Sửa giỏ hàng</a>
        </section>`;
};

const renderUnavailableNotice = (items) => {
    const unavailable = (items || []).filter((item) => item.available === false);
    if (!unavailable.length) return "";
    const names = unavailable.map((item) => `<li>${escapeHtml(item.name || `Phiên bản #${item.variantId}`)}: ${escapeHtml(adjustmentReason(item.unavailableReason))}</li>`).join("");
    return `<div class="checkout-unavailable" role="alert" aria-live="assertive"><strong>Không thể thanh toán lúc này.</strong><ul>${names}</ul><a href="/cart.html">Mở giỏ hàng để xử lý</a></div>`;
};

const renderMergeError = () => {
    const error = window.DigiCart?.getMergeError?.();
    if (!error) return "";
    return `<section class="checkout-merge-error" role="alert" aria-live="assertive"><strong>Chưa hợp nhất được giỏ hàng.</strong><p>${escapeHtml(error.message || "Kết nối gặp lỗi, giỏ Guest vẫn được giữ nguyên.")}</p><button type="button" class="btn btn--secondary" onclick="retryCartMerge()">Thử hợp nhất lại</button></section>`;
};

const retryCartMerge = async () => {
    const button = document.querySelector(".checkout-merge-error button");
    if (button) { button.disabled = true; button.textContent = "Đang thử lại..."; }
    try {
        await window.DigiCart?.retryMerge?.();
        window.location.reload();
    } catch (error) {
        showCheckoutError(error.message || "Không thể hợp nhất giỏ hàng.");
        if (button) { button.disabled = false; button.textContent = "Thử hợp nhất lại"; }
    }
};

const renderCheckoutForm = (summaryHtml, qtyControls, blocked, items = []) => {
    checkoutBlocked = Boolean(blocked);
    const container = document.getElementById("payment-info");
    container.innerHTML = `
        ${renderMergeError()}
        ${renderMergeBanner()}
        ${renderUnavailableNotice(items)}
        <div class="checkout-layout">
            <div class="checkout-summary">
                <div class="checkout-summary__title">Đơn hàng của bạn</div>

                ${summaryHtml}
                <div class="checkout-summary__row checkout-summary__row--subtotal"><span>Tạm tính</span><span id="summary-subtotal">—</span></div>
                <div class="checkout-summary__row"><span>Phí vận chuyển</span><span id="summary-shipping">—</span></div>
                <div class="checkout-summary__row checkout-summary__row--total"><span>Tổng cộng</span><span id="summary-total">—</span></div>
            </div>
            <div class="checkout-card__form">
                <div id="checkout-error-alert" class="checkout-alert-error" role="alert" tabindex="-1" style="display:none;"></div>
                ${qtyControls}
                ${qtyControls ? '<div class="checkout-divider"></div>' : ''}
                <div class="checkout-section-title">Thông tin giao hàng</div>
                <div class="checkout-grid-2">
                    <div class="checkout-input-group">
                        <label for="customer-name">Họ và tên người nhận <span class="required-star">*</span></label>
                        <input type="text" id="customer-name" class="checkout-input" autocomplete="name" aria-describedby="error-name">
                        <span class="checkout-field-error" id="error-name" role="alert" style="display:none;"></span>
                    </div>
                    <div class="checkout-input-group">
                        <label for="customer-phone">Số điện thoại <span class="required-star">*</span></label>
                        <input type="tel" id="customer-phone" class="checkout-input" autocomplete="tel" aria-describedby="error-phone">
                        <span class="checkout-field-error" id="error-phone" role="alert" style="display:none;"></span>
                    </div>
                </div>
                <div class="checkout-input-group">
                    <label for="customer-address">Địa chỉ nhận hàng <span class="required-star">*</span></label>
                    <input type="text" id="customer-address" class="checkout-input" autocomplete="street-address" aria-describedby="error-address">
                    <span class="checkout-field-error" id="error-address" role="alert" style="display:none;"></span>
                </div>
                <div class="checkout-grid-2">
                    <div class="checkout-input-group">
                        <label for="payment-method">Phương thức thanh toán</label>
                        <select id="payment-method" class="checkout-select"><option value="COD">Thanh toán khi nhận hàng (COD)</option><option value="BANKING">Chuyển khoản ngân hàng</option><option value="MOMO">MoMo QR</option><option value="VNPAY">VNPay QR</option></select>
                    </div>
                    <div class="checkout-input-group">
                        <label for="customer-note">Ghi chú (Tùy chọn)</label>
                        <input type="text" id="customer-note" class="checkout-input" autocomplete="off">
                    </div>
                </div>
                <div class="checkout-divider"></div>
                <button class="btn btn--primary btn--checkout" id="btn-checkout" type="button" onclick="handleCheckout()" ${checkoutBlocked ? "disabled aria-disabled=\"true\"" : ""}>${checkoutBlocked ? "Xử lý sản phẩm trước khi thanh toán" : "Xác nhận thanh toán"}</button>
            </div>
        </div>`;
    attachLiveValidation();
    refreshSummary();
    applyDraftForm();
};

const applyDraftForm = () => {
    const form = checkoutDraft?.form;
    if (!form) return;
    const values = {
        "customer-name": form.customerName,
        "customer-phone": form.customerPhone,
        "customer-address": form.customerAddress,
        "payment-method": form.paymentMethod,
        "customer-note": form.note
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.value = value || "";
    });
    const banner = document.getElementById("checkout-merge-banner");
    const heading = document.querySelector(".payment-container h1");
    (banner || heading)?.focus?.();
};

const stopPaymentTimers = () => {
    clearInterval(paymentPollTimer);
    clearInterval(paymentCountdownTimer);
    paymentPollTimer = null;
    paymentCountdownTimer = null;
};

const paymentProviderName = (provider) => provider === "MOMO" ? "MoMo" : "VNPay";

const updatePaymentCountdown = () => {
    const countdown = document.getElementById("payment-countdown");
    if (!countdown || !activePaymentAttempt) return;
    const seconds = Math.max(0, Math.ceil((Date.parse(activePaymentAttempt.expiresAt) - Date.now()) / 1000));
    countdown.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const renderPaymentAttempt = (attempt) => {
    stopPaymentTimers();
    activePaymentAttempt = attempt;
    const panel = document.getElementById("payment-attempt-panel");
    if (!panel) return;
    const momoOverLimit = attempt?.provider === "MOMO" && Number(attempt.amount) > MOMO_MAX_AMOUNT;
    const defaultStateCopy = {
        PENDING: ["Chờ thanh toán", "Quét mã QR trước khi giao dịch hết hạn."],
        SUCCEEDED: ["Đã thanh toán", "MoMo/VNPay đã xác nhận giao dịch."],
        EXPIRED: ["Giao dịch đã hết hạn", "Hàng đã được trả lại kho. Bạn có thể thử thanh toán lại trên cùng đơn nếu hàng còn."],
        FAILED: ["Chưa khởi tạo được giao dịch", "Không có khoản thanh toán nào được xác nhận. Bạn có thể thử lại."],
        LATE_SUCCESS: ["Cần đối soát giao dịch", "Cổng báo thành công sau khi giao dịch hết hạn. Đơn chưa được xác nhận thanh toán; vui lòng liên hệ cửa hàng."]
    }[attempt?.status] || ["Trạng thái thanh toán", "Đang tải trạng thái giao dịch."];
    const stateCopy = attempt?.status === "FAILED" && momoOverLimit
        ? ["MoMo vượt giới hạn giao dịch", `MoMo chỉ hỗ trợ tối đa ${formatPrice(MOMO_MAX_AMOUNT)} mỗi giao dịch. Đơn này là ${formatPrice(attempt.amount)}; hãy chọn VNPay để thử lại trên cùng đơn.`]
        : defaultStateCopy;
    const canRetry = ["EXPIRED", "FAILED"].includes(attempt?.status) && activePaymentOrder?.paymentStatus === "UNPAID";
    const qrHtml = attempt?.qrDataUrl
        ? `<img class="payment-qr" src="${escapeHtml(attempt.qrDataUrl)}" alt="Mã QR thanh toán ${escapeHtml(paymentProviderName(attempt.provider))}">`
        : "";
    const providerAction = attempt?.paymentUrl && attempt.status === "PENDING"
        ? `<a class="btn btn--primary" href="${escapeHtml(attempt.paymentUrl)}" target="_blank" rel="noopener noreferrer">Mở trang ${escapeHtml(paymentProviderName(attempt.provider))} để quét QR</a>`
        : "";
    panel.innerHTML = `
        <div class="payment-attempt" role="status" data-attempt-id="${escapeHtml(attempt?.id)}">
            <h3>${escapeHtml(stateCopy[0])}</h3>
            <p>${escapeHtml(stateCopy[1])}</p>
            ${attempt?.status === "PENDING" ? `<p>Thời gian còn lại: <strong id="payment-countdown" aria-live="off"></strong></p>` : ""}
            ${qrHtml}
            ${providerAction}
            ${canRetry ? `
                <div class="payment-retry">
                    <label for="payment-retry-provider">Thử lại với</label>
                    <select id="payment-retry-provider">
                        <option value="MOMO" ${attempt.provider === "MOMO" && !momoOverLimit ? "selected" : ""} ${momoOverLimit ? "disabled" : ""}>${momoOverLimit ? "MoMo (vượt hạn mức)" : "MoMo"}</option>
                        <option value="VNPAY" ${attempt.provider === "VNPAY" || momoOverLimit ? "selected" : ""}>VNPay</option>
                    </select>
                    <button class="btn btn--secondary" type="button" onclick="retryPaymentAttempt()" ${paymentRetryLoading ? "disabled" : ""}>${paymentRetryLoading ? "Đang tạo giao dịch..." : "Thử thanh toán lại"}</button>
                </div>` : ""}
            <p class="payment-attempt__reference">Mã đơn: <strong>${escapeHtml(attempt?.orderId)}</strong></p>
        </div>`;

    if (attempt?.status === "PENDING") {
        updatePaymentCountdown();
        paymentCountdownTimer = setInterval(updatePaymentCountdown, 1000);
        paymentPollTimer = setInterval(refreshPaymentAttempt, 3000);
    }
};

const refreshPaymentAttempt = async () => {
    if (!activePaymentAttempt?.id) return;
    try {
        const latest = unwrap(await authApi(`/api/payments/attempts/${encodeURIComponent(activePaymentAttempt.id)}`));
        if (!latest) return;
        const wasPending = activePaymentAttempt.status === "PENDING";
        const changed = latest.status !== activePaymentAttempt.status || latest.id !== activePaymentAttempt.id;
        activePaymentAttempt = latest;
        if (changed) renderPaymentAttempt(latest);
        else updatePaymentCountdown();
        if (wasPending && latest.status !== "PENDING") stopPaymentTimers();
    } catch (_) {
        // Keep showing the current state; a later poll can recover transient network errors.
    }
};

const retryPaymentAttempt = async () => {
    if (paymentRetryLoading || !activePaymentOrder?.id) return;
    const provider = document.getElementById("payment-retry-provider")?.value;
    paymentRetryLoading = true;
    renderPaymentAttempt(activePaymentAttempt);
    try {
        const response = await authApi(`/api/payments/orders/${encodeURIComponent(activePaymentOrder.id)}/attempts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider })
        });
        renderPaymentAttempt(unwrap(response));
    } catch (error) {
        paymentRetryLoading = false;
        renderPaymentAttempt(activePaymentAttempt);
        const panel = document.getElementById("payment-attempt-panel");
        const message = document.createElement("p");
        message.className = "payment-attempt__error";
        message.textContent = error?.message || "Không thể tạo giao dịch mới.";
        panel?.append(message);
    } finally {
        paymentRetryLoading = false;
    }
};

const renderOrderSuccess = (order) => {
    stopPaymentTimers();
    activePaymentOrder = order;
    const container = document.getElementById("payment-info");
    const items = Array.isArray(order?.items) ? order.items : [];
    const itemsHtml = items.map((item) => {
        const optionsSnapshot = item.optionsSnapshot && typeof item.optionsSnapshot === "object"
            ? item.optionsSnapshot
            : item.options && typeof item.options === "object" ? item.options : {};
        const options = Object.entries(optionsSnapshot).map(([name, value]) => `${name}: ${value}`).join(" · ");
        const sku = item.skuSnapshot ?? item.sku;
        const details = [options, sku ? `SKU: ${sku}` : ""].filter(Boolean).join(" · ");
        return `<div class="order-detail-row"><span class="order-detail-label">${escapeHtml(item.name)} × ${item.quantity}${details ? `<small>${escapeHtml(details)}</small>` : ""}</span><span class="order-detail-value">${formatPrice(item.lineTotal)}</span></div>`;
    }).join("");
    const customer = order?.customer || { name: "", phone: "", address: "", note: "" };
    const paymentMethod = order?.paymentMethod === "MOMO" ? "MoMo" :
        order?.paymentMethod === "VNPAY" ? "VNPay" : order?.paymentMethod;
    const onlineUnpaid = ["MOMO", "VNPAY"].includes(order?.paymentMethod) && order?.paymentStatus !== "PAID";
    const successTitle = onlineUnpaid ? "Đơn hàng chờ thanh toán" : "Đặt hàng thành công!";
    container.innerHTML = `
        <div class="order-success-card" role="status" tabindex="-1">
            <div class="order-success-icon" aria-hidden="true">✓</div>
            <h2 class="order-success-title">${escapeHtml(successTitle)}</h2>
            <p class="order-success-desc">${onlineUnpaid ? "Đơn hàng được ghi nhận và đang chờ cổng thanh toán xác nhận." : "Đơn hàng đã được ghi nhận cho tài khoản của bạn."}</p>
            <div class="order-detail-box">
                <div class="order-detail-row"><span class="order-detail-label">Mã đơn hàng</span><span class="order-detail-value font-mono"><strong>${escapeHtml(order?.id)}</strong></span></div>
                <div class="order-detail-row"><span class="order-detail-label">Khách hàng</span><span class="order-detail-value">${escapeHtml(customer.name)}</span></div>
                <div class="order-detail-row"><span class="order-detail-label">Số điện thoại</span><span class="order-detail-value">${escapeHtml(customer.phone)}</span></div>
                <div class="order-detail-row"><span class="order-detail-label">Địa chỉ nhận hàng</span><span class="order-detail-value">${escapeHtml(customer.address)}</span></div>
                <div class="order-detail-row"><span class="order-detail-label">Phương thức thanh toán</span><span class="order-detail-value">${escapeHtml(paymentMethod)}</span></div>
                ${customer.note ? `<div class="order-detail-row"><span class="order-detail-label">Ghi chú (Tùy chọn)</span><span class="order-detail-value">${escapeHtml(customer.note)}</span></div>` : ""}
                ${itemsHtml}
                <div class="order-detail-row"><span class="order-detail-label">Tạm tính</span><span class="order-detail-value">${formatPrice(order?.subtotal)}</span></div>
                <div class="order-detail-row"><span class="order-detail-label">Phí vận chuyển</span><span class="order-detail-value">${formatPrice(order?.shippingFee)}</span></div>
                <div class="order-detail-row"><span class="order-detail-label">Tổng thanh toán</span><span class="order-detail-value order-detail-value--highlight">${formatPrice(order?.totalPrice)}</span></div>
            </div>
            ${order?.paymentAttempt ? '<section id="payment-attempt-panel" aria-label="Trạng thái thanh toán"></section>' : ""}
            <div class="order-actions"><a href="/" class="btn btn--primary">Tiếp tục mua sắm</a><a href="/cart.html" class="btn btn--secondary">Xem giỏ hàng</a></div>
        </div>`;
    if (order?.paymentAttempt) renderPaymentAttempt(order.paymentAttempt);
    container.querySelector("[tabindex]")?.focus();
};

const handleGuestSubmit = () => {
    const draft = saveCheckoutDraft();
    if (!draft) {
        showCheckoutError("Không thể lưu phiên checkout trong tab này. Hãy bật sessionStorage rồi thử lại.");
        return;
    }
    window.location.assign("/auth.html?tab=login");
};

const handleCheckout = async () => {
    if (checkoutLoading || !validateForm()) return;
    const session = currentSession();
    if (session.user?.role === "admin") return renderForbidden();
    if (!session.authenticated) return handleGuestSubmit();
    if (!isUserSession()) return showCheckoutError("Tài khoản hiện tại không thể thanh toán.");
    if (checkoutBlocked) return showCheckoutError("Hãy xử lý các sản phẩm không khả dụng trước khi thanh toán.");
    if (CartService.getMergeError()) return showCheckoutError("Giỏ hàng chưa hợp nhất ổn định. Hãy thử đăng nhập lại để retry cùng thao tác.");

    const button = document.getElementById("btn-checkout");
    checkoutLoading = true;
    if (button) { button.disabled = true; button.textContent = "Đang xử lý..."; }
    const values = formValues();
    try {
        let response;
        if (Array.isArray(cartItems)) {
            response = await authApi("/api/checkout/batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: cartItems.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
                    ...values
                })
            });
        } else {
            response = await authApi(`/api/checkout/${encodeURIComponent(currentVariant.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity: currentQuantity, ...values })
            });
        }
        const data = unwrap(response) || {};
        if (Array.isArray(cartItems)) {
            // Order creation is committed before cart cleanup; never clear earlier.
            try { await CartService.clearCart(); } catch (_) { /* order is already committed */ }
        }
        window.DigiCheckoutState?.clearDraft?.();
        window.DigiCheckoutState?.clearMergeReport?.();
        renderOrderSuccess(data);
    } catch (error) {
        checkoutLoading = false;
        if (error?.status === 401) {
            saveCheckoutDraft();
            window.location.assign("/auth.html?tab=login");
            return;
        }
        if (button) { button.disabled = false; button.textContent = "Xác nhận thanh toán"; }
        showCheckoutError(error?.message || "Không thể hoàn tất thanh toán. Vui lòng thử lại.");
    }
};

const validateGuestItems = async (items) => {
    try {
        const response = await fetch("/api/cart/validate", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: items.map((item) => ({
                    ...(item.variantId !== undefined ? { variantId: item.variantId } : { productId: item.legacyProductId ?? item.productId }),
                    quantity: item.quantity
                }))
            })
        });
        const body = await response.json();
        if (!response.ok || body.success === false) throw new Error(body.message || "Không thể kiểm tra giỏ hàng");
        const validated = body.data?.validatedItems || [];
        return items.map((item, index) => {
            const value = validated[index];
            return value ? { ...item, ...value } : item;
        });
    } catch (_) {
        return items;
    }
};

const loadBuyNow = async (id, variantId) => {
    const container = document.getElementById("payment-info");
    try {
        const response = await fetch(`/api/products/info/${encodeURIComponent(id)}`, { credentials: "same-origin" });
        const body = await response.json();
        if (!response.ok || body.success === false) throw new Error(body.message || "Không tìm thấy sản phẩm");
        currentProduct = body.data;
        const variants = currentProduct.variants || [];
        currentVariant = variants.find((variant) => Number(variant.id) === Number(variantId));
        if (!currentVariant) throw new Error("Không tìm thấy phiên bản sản phẩm đã chọn.");
        const draftQuantity = checkoutDraft?.mode === "buy-now" &&
            Number(checkoutDraft.productId) === Number(id) &&
            Number(checkoutDraft.variantId) === Number(variantId)
            ? Number(checkoutDraft.cartSnapshot?.[0]?.quantity || 1)
            : 1;
        currentQuantity = Math.max(1, Math.min(draftQuantity, Number(currentVariant.stock || 1)));
        const unavailable = currentProduct.isDeleted === true || currentVariant.isActive !== true || Number(currentVariant.stock) <= 0;
        const variantLabel = Object.entries(currentVariant.optionValues || {})
            .map(([name, value]) => `${name}: ${value}`)
            .join(" · ");
        const summaryHtml = `<div class="checkout-summary__item"><img src="${escapeHtml(currentProduct.image || "")}" alt="${escapeHtml(currentProduct.name)}" class="checkout-summary__img"><div class="checkout-summary__item-info"><div class="checkout-summary__item-name">${escapeHtml(currentProduct.name)}</div><div class="checkout-summary__item-desc">${escapeHtml([variantLabel, currentVariant.sku ? `SKU: ${currentVariant.sku}` : "", currentProduct.description || ""].filter(Boolean).join(" · "))}</div><div class="checkout-summary__item-price">${formatPrice(currentVariant.price)} × ${currentQuantity}</div></div></div>`;
        const qtyControls = unavailable ? "" : `<div class="checkout-form-row"><label for="qty-input">Số lượng đặt mua</label><div class="quantity-input"><button type="button" onclick="decreaseQty()" aria-label="Giảm số lượng">−</button><input type="number" id="qty-input" value="${currentQuantity}" min="1" max="${Number(currentVariant.stock)}" readonly><button type="button" onclick="increaseQty()" aria-label="Tăng số lượng">+</button></div></div>`;
        renderCheckoutForm(summaryHtml, qtyControls, unavailable, unavailable ? [{
            variantId: currentVariant.id,
            name: currentProduct.name,
            available: false,
            unavailableReason: currentProduct.isDeleted ? "soft_deleted" : currentVariant.isActive ? "out_of_stock" : "variant_unavailable"
        }] : []);
    } catch (error) {
        container.innerHTML = `<div class="error-message"><h2>Không tìm thấy sản phẩm</h2><p>${escapeHtml(error.message)}</p><a href="/" class="btn btn--primary">Quay lại trang chủ</a></div>`;
    }
};

const loadFromCart = async () => {
    const container = document.getElementById("payment-info");
    await CartService.refresh();
    cartItems = CartService.getItems();
    if (!CartService.isAccountCart()) cartItems = await validateGuestItems(cartItems);
    if (!cartItems.length) {
        container.innerHTML = `<div class="error-message"><h2>Giỏ hàng trống</h2><p>Vui lòng thêm sản phẩm vào giỏ trước khi thanh toán.</p><a href="/" class="btn btn--primary">Quay lại mua sắm</a></div>`;
        return;
    }
    const unavailable = cartItems.some((item) => item.available === false);
    const summaryHtml = cartItems.map((item) => `<div class="checkout-summary__item"><img src="${escapeHtml(item.image || item.product?.image || "")}" alt="${escapeHtml(item.name || item.product?.name)}" class="checkout-summary__img"><div class="checkout-summary__item-info"><div class="checkout-summary__item-name">${escapeHtml(item.name || item.product?.name)}</div><div class="checkout-summary__item-desc">${escapeHtml([item.variantLabel, item.sku ? `SKU: ${item.sku}` : "", item.description || item.product?.description || ""].filter(Boolean).join(" · "))}</div><div class="checkout-summary__item-price">${formatPrice(item.price || item.variant?.price)} × ${item.quantity}</div></div></div>`).join("");
    renderCheckoutForm(summaryHtml, "", unavailable, cartItems);
};

const loadPaymentReturn = async (attemptId) => {
    const container = document.getElementById("payment-info");
    if (!/^[a-f\d]{32}$/i.test(attemptId)) {
        container.innerHTML = `<div class="error-message"><h2>Không tìm thấy giao dịch</h2><p>Liên kết thanh toán không hợp lệ.</p></div>`;
        return;
    }
    try {
        const attempt = unwrap(await authApi(`/api/payments/attempts/${encodeURIComponent(attemptId)}`));
        const order = unwrap(await authApi(`/api/orders/${encodeURIComponent(attempt.orderId)}`));
        renderOrderSuccess({ ...order, paymentAttempt: attempt });
    } catch (error) {
        container.innerHTML = `<div class="error-message"><h2>Không thể tải trạng thái thanh toán</h2><p>${escapeHtml(error?.message || "Vui lòng đăng nhập lại hoặc mở lại đơn hàng.")}</p><a href="/" class="btn btn--primary">Trang chủ</a></div>`;
    }
};

const loadCheckout = async () => {
    if (window.DigiAuth?.ready) {
        try { await window.DigiAuth.ready; } catch (_) { /* treat failed bootstrap as Guest */ }
    }
    await CartService.whenReady();
    if (isAdminSession()) return renderForbidden();
    const paymentAttemptId = getUrlParam("paymentAttemptId");
    if (paymentAttemptId) return loadPaymentReturn(paymentAttemptId);
    checkoutDraft = window.DigiCheckoutState?.readDraft?.() || null;
    const expired = window.DigiCheckoutState?.takeExpiredNotice?.();
    if (expired) {
        const root = document.getElementById("payment-info");
        if (root) root.insertAdjacentHTML("beforebegin", `<div class="checkout-draft-expired" role="status">Phiên checkout đã hết hạn sau 30 phút và không được khôi phục. Vui lòng nhập lại thông tin.</div>`);
    }

    const id = getUrlParam("id");
    const variantId = getUrlParam("variantId");
    const source = getUrlParam("source");
    if (source === "cart") return loadFromCart();
    if (id && /^\d+$/.test(id) && variantId && /^\d+$/.test(variantId)) return loadBuyNow(Number(id), Number(variantId));
    document.getElementById("payment-info").innerHTML = `<div class="error-message"><h2>Không tìm thấy sản phẩm</h2><p>Vui lòng chọn một phiên bản từ trang chi tiết hoặc mở giỏ hàng trước khi thanh toán.</p><div class="checkout-auth-forbidden__actions"><a href="/" class="btn btn--primary">Trang chủ</a><a href="/cart.html" class="btn btn--secondary">Xem giỏ hàng</a></div></div>`;
};

document.addEventListener("DOMContentLoaded", loadCheckout);
