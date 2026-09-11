// ===== PAYMENT.JS =====
// Trang thanh toán (checkouts.html)
// Nguồn sản phẩm: URL param ?id=X (Mua ngay 1 SP) hoặc ?source=cart (từ giỏ hàng)
// Validate form: name, phone, address bắt buộc — không được để trống

const getUrlParam = (param) => new URLSearchParams(window.location.search).get(param);
const formatPrice = (price) => Number(price).toLocaleString("vi-VN") + "₫";

const SHIPPING_FEE = 100000; // Phí vận chuyển mặc định 100.000 VNĐ

// ─── State ────────────────────────────────────────────────────────────────────
// Chế độ "buy now": currentProduct != null, cartItems = null
// Chế độ "cart":    currentProduct = null, cartItems = [...]
let currentProduct = null;
let currentQuantity = 1;
let cartItems = null;       // dùng khi source=cart

// ─── Helpers ──────────────────────────────────────────────────────────────────

const computeSubtotal = () => {
    if (cartItems) return cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    if (currentProduct) return currentProduct.price * currentQuantity;
    return 0;
};

const computeShipping = (subtotal) => SHIPPING_FEE;

const refreshSummary = () => {
    const subtotal = computeSubtotal();
    const shipping = computeShipping(subtotal);
    const total = subtotal + shipping;

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl("summary-subtotal", formatPrice(subtotal));
    setEl("summary-shipping", formatPrice(shipping));
    setEl("summary-total", formatPrice(total));
    if (currentProduct) setEl("checkout-total-price", formatPrice(currentProduct.price * currentQuantity));
};

// ─── Quantity controls (buy-now mode only) ────────────────────────────────────

const increaseQty = () => {
    if (currentProduct && currentQuantity < currentProduct.stock) { currentQuantity++; refreshSummary(); }
};
const decreaseQty = () => {
    if (currentQuantity > 1) { currentQuantity--; refreshSummary(); }
};
const updateTotal = refreshSummary; // alias

// ─── Form Validation ──────────────────────────────────────────────────────────

/**
 * Validate các ô thông tin bắt buộc trong form thanh toán.
 * Hiển thị lỗi inline bên dưới từng field.
 * Không được để trống bất kỳ ô bắt buộc nào: Họ tên, Số điện thoại, Địa chỉ nhận hàng.
 * @returns {boolean} true nếu form hợp lệ
 */
const validateForm = () => {
    let isValid = true;

    const rules = [
        {
            id: "customer-name",
            errorId: "error-name",
            validate: (v) => v.trim().length > 0 && v.trim().length >= 2,
            message: "Họ và tên không được để trống (tối thiểu 2 ký tự)."
        },
        {
            id: "customer-phone",
            errorId: "error-phone",
            validate: (v) => {
                const val = v.trim();
                if (!val) return false;
                return /^(0|\+84)[0-9]{8,10}$/.test(val);
            },
            message: "Số điện thoại không được để trống và phải đúng định dạng (VD: 0912345678)."
        },
        {
            id: "customer-address",
            errorId: "error-address",
            validate: (v) => v.trim().length > 0 && v.trim().length >= 5,
            message: "Địa chỉ nhận hàng không được để trống (tối thiểu 5 ký tự)."
        }
    ];

    rules.forEach(({ id, errorId, validate, message }) => {
        const input = document.getElementById(id);
        const errorEl = document.getElementById(errorId);
        if (!input || !errorEl) return;

        const ok = validate(input.value);
        if (!ok) {
            isValid = false;
            errorEl.textContent = message;
            errorEl.style.display = "block";
            input.classList.add("checkout-input--error");
        } else {
            errorEl.style.display = "none";
            errorEl.textContent = "";
            input.classList.remove("checkout-input--error");
        }
    });

    return isValid;
};

// Xóa lỗi inline khi user bắt đầu gõ
const attachLiveValidation = () => {
    ["customer-name", "customer-phone", "customer-address"].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener("input", () => {
            const errorEl = document.getElementById("error-" + id.replace("customer-", ""));
            if (errorEl) { errorEl.style.display = "none"; }
            input.classList.remove("checkout-input--error");
        });
    });
};

// ─── Render success ───────────────────────────────────────────────────────────

const renderOrderSuccess = (order) => {
    const container = document.getElementById("payment-info");

    const itemsHtml = order.items.map((item) => `
        <div class="order-detail-row">
            <span class="order-detail-label">${item.name} × ${item.quantity}</span>
            <span class="order-detail-value">${formatPrice(item.lineTotal)}</span>
        </div>`).join("");

    container.innerHTML = `
        <div class="order-success-card">
            <div class="order-success-icon">✓</div>
            <h2 class="order-success-title">Đặt hàng thành công!</h2>
            <p class="order-success-desc">Cảm ơn bạn đã mua sắm tại NodeShop. Đơn hàng đã được ghi nhận.</p>

            <div class="order-detail-box">
                <div class="order-detail-row">
                    <span class="order-detail-label">Mã đơn hàng</span>
                    <span class="order-detail-value font-mono"><strong>${order.id}</strong></span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Khách hàng</span>
                    <span class="order-detail-value">${order.customer.name}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Số điện thoại</span>
                    <span class="order-detail-value">${order.customer.phone}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Địa chỉ nhận hàng</span>
                    <span class="order-detail-value">${order.customer.address}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Phương thức thanh toán</span>
                    <span class="order-detail-value">${order.paymentMethod}</span>
                </div>
                ${order.customer.note ? `
                <div class="order-detail-row">
                    <span class="order-detail-label">Ghi chú</span>
                    <span class="order-detail-value">${order.customer.note}</span>
                </div>` : ""}
                <div class="order-detail-row"><span class="order-detail-label" style="font-weight:600;color:var(--text-primary)">Sản phẩm đã đặt</span><span></span></div>
                ${itemsHtml}
                <div class="order-detail-row">
                    <span class="order-detail-label">Tạm tính</span>
                    <span class="order-detail-value">${formatPrice(order.subtotal)}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Phí vận chuyển</span>
                    <span class="order-detail-value">${formatPrice(order.shippingFee)}</span>
                </div>
                <div class="order-detail-row">
                    <span class="order-detail-label">Tổng thanh toán</span>
                    <span class="order-detail-value order-detail-value--highlight">${formatPrice(order.totalPrice)}</span>
                </div>
            </div>

            <div class="order-actions">
                <a href="/" class="btn btn--primary">Tiếp tục mua sắm</a>
                <a href="/cart.html" class="btn btn--secondary">Xem giỏ hàng</a>
            </div>
        </div>`;
};

// ─── Checkout handler ─────────────────────────────────────────────────────────

const handleCheckout = async () => {
    // Validate form trước — nếu có ô trống hoặc sai thì dừng lại
    if (!validateForm()) return;

    const btnEl = document.getElementById("btn-checkout");
    const errorAlertEl = document.getElementById("checkout-error-alert");
    if (errorAlertEl) { errorAlertEl.style.display = "none"; errorAlertEl.textContent = ""; }

    const customerName = document.getElementById("customer-name")?.value?.trim() || "";
    const customerPhone = document.getElementById("customer-phone")?.value?.trim() || "";
    const customerAddress = document.getElementById("customer-address")?.value?.trim() || "";
    const paymentMethod = document.getElementById("payment-method")?.value || "COD";
    const note = document.getElementById("customer-note")?.value?.trim() || "";

    btnEl.textContent = "Đang xử lý...";
    btnEl.disabled = true;

    try {
        let res, body;

        if (cartItems) {
            // ── Chế độ giỏ hàng (POST /api/checkout/batch) ──
            body = {
                items: cartItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
                customerName, customerPhone, customerAddress, paymentMethod, note
            };
            res = await fetch("/api/checkout/batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
        } else {
            // ── Chế độ mua ngay (POST /api/checkout/:id) ──
            body = { quantity: currentQuantity, customerName, customerPhone, customerAddress, paymentMethod, note };
            res = await fetch(`/api/checkout/${currentProduct.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
        }

        const data = await res.json();
        if (!data.success) throw new Error(data.message || "Có lỗi xảy ra.");

        // Xóa giỏ hàng sau khi thanh toán thành công
        if (cartItems && typeof CartService !== "undefined") CartService.clearCart();

        renderOrderSuccess(data.data);
    } catch (error) {
        btnEl.textContent = "Xác nhận thanh toán";
        btnEl.disabled = false;
        if (errorAlertEl) {
            errorAlertEl.textContent = "⚠ " + error.message;
            errorAlertEl.style.display = "block";
            errorAlertEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
            alert("Lỗi: " + error.message);
        }
    }
};

// ─── Render form layout (dùng chung cho cả 2 mode) ───────────────────────────

const renderCheckoutForm = (summaryHtml, qtyControls, isOutOfStock) => {
    const container = document.getElementById("payment-info");
    container.innerHTML = `
        <div class="checkout-layout">

            <!-- LEFT: Tóm tắt đơn hàng -->
            <div class="checkout-summary">
                <div class="checkout-summary__title">Đơn hàng của bạn</div>
                ${summaryHtml}
                <div class="checkout-summary__row checkout-summary__row--subtotal">
                    <span>Tạm tính</span>
                    <span id="summary-subtotal">—</span>
                </div>
                <div class="checkout-summary__row">
                    <span>Phí vận chuyển</span>
                    <span id="summary-shipping">—</span>
                </div>
                <div class="checkout-summary__row checkout-summary__row--total">
                    <span>Tổng cộng</span>
                    <span id="summary-total">—</span>
                </div>
            </div>

            <!-- RIGHT: Form thông tin -->
            <div class="checkout-card__form">
                <div id="checkout-error-alert" class="checkout-alert-error" style="display:none;"></div>

                ${qtyControls}
                ${qtyControls ? '<div class="checkout-divider"></div>' : ''}

                <div class="checkout-section-title">Thông tin giao hàng</div>

                <div class="checkout-grid-2">
                    <div class="checkout-input-group">
                        <label for="customer-name">Họ và tên người nhận <span class="required-star">*</span></label>
                        <input type="text" id="customer-name" class="checkout-input" placeholder="Ví dụ: Nguyễn Văn A" autocomplete="name">
                        <span class="checkout-field-error" id="error-name" style="display:none;"></span>
                    </div>
                    <div class="checkout-input-group">
                        <label for="customer-phone">Số điện thoại <span class="required-star">*</span></label>
                        <input type="tel" id="customer-phone" class="checkout-input" placeholder="Ví dụ: 0912345678" autocomplete="tel">
                        <span class="checkout-field-error" id="error-phone" style="display:none;"></span>
                    </div>
                </div>

                <div class="checkout-input-group">
                    <label for="customer-address">Địa chỉ nhận hàng <span class="required-star">*</span></label>
                    <input type="text" id="customer-address" class="checkout-input" placeholder="Số nhà, tên đường, phường/xã, quận/huyện, tỉnh/thành" autocomplete="street-address">
                    <span class="checkout-field-error" id="error-address" style="display:none;"></span>
                </div>

                <div class="checkout-grid-2">
                    <div class="checkout-input-group">
                        <label for="payment-method">Phương thức thanh toán</label>
                        <select id="payment-method" class="checkout-select">
                            <option value="COD">Thanh toán khi nhận hàng (COD)</option>
                            <option value="BANKING">Chuyển khoản ngân hàng (QR)</option>
                        </select>
                    </div>
                    <div class="checkout-input-group">
                        <label for="customer-note">Ghi chú (Tùy chọn)</label>
                        <input type="text" id="customer-note" class="checkout-input" placeholder="Ví dụ: Giao giờ hành chính">
                    </div>
                </div>

                <div class="checkout-divider"></div>

                <button class="btn btn--primary btn--checkout" id="btn-checkout"
                    onclick="handleCheckout()" ${isOutOfStock ? 'disabled style="opacity:.45;cursor:not-allowed;"' : ''}>
                    ${isOutOfStock ? "Sản phẩm đã hết hàng" : "Xác nhận thanh toán"}
                </button>
            </div>
        </div>`;

    attachLiveValidation();
    refreshSummary();
};

// ─── Load: Mua ngay (source = product id) ────────────────────────────────────

const loadBuyNow = async (id) => {
    const container = document.getElementById("payment-info");
    try {
        const res = await fetch(`/api/products/info/${id}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        currentProduct = data.data;
        currentQuantity = 1;
        const isOutOfStock = currentProduct.stock <= 0;

        const summaryHtml = `
            <div class="checkout-summary__item">
                <img src="${currentProduct.image}" alt="${currentProduct.name}" class="checkout-summary__img">
                <div class="checkout-summary__item-info">
                    <div class="checkout-summary__item-name">${currentProduct.name}</div>
                    <div class="checkout-summary__item-desc">${currentProduct.description}</div>
                    <div class="checkout-summary__item-price">${formatPrice(currentProduct.price)}</div>
                </div>
            </div>`;

        const qtyControls = isOutOfStock ? "" : `
            <div class="checkout-form-row">
                <label>Số lượng đặt mua</label>
                <div class="quantity-input">
                    <button type="button" onclick="decreaseQty()">−</button>
                    <input type="number" id="qty-input" value="1" min="1" max="${currentProduct.stock}" readonly>
                    <button type="button" onclick="increaseQty()">+</button>
                </div>
            </div>`;

        renderCheckoutForm(summaryHtml, qtyControls, isOutOfStock);
    } catch (error) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>${error.message}</p>
                <a href="/" class="btn btn--primary" style="margin-top:16px;display:inline-block;">Quay lại trang chủ</a>
            </div>`;
    }
};

// ─── Load: Từ giỏ hàng (source = cart) ───────────────────────────────────────

const loadFromCart = () => {
    const container = document.getElementById("payment-info");
    cartItems = (typeof CartService !== "undefined") ? CartService.getItems() : [];

    if (!cartItems || cartItems.length === 0) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Giỏ hàng trống</h2>
                <p>Vui lòng thêm sản phẩm vào giỏ trước khi thanh toán.</p>
                <a href="/" class="btn btn--primary" style="margin-top:16px;display:inline-block;">Quay lại mua sắm</a>
            </div>`;
        return;
    }

    const summaryHtml = cartItems.map((item) => `
        <div class="checkout-summary__item">
            <img src="${item.image || ''}" alt="${item.name}" class="checkout-summary__img">
            <div class="checkout-summary__item-info">
                <div class="checkout-summary__item-name">${item.name}</div>
                <div class="checkout-summary__item-desc">${item.description || ''}</div>
                <div class="checkout-summary__item-price">${formatPrice(item.price)} × ${item.quantity}</div>
            </div>
        </div>`).join("");

    renderCheckoutForm(summaryHtml, "", false);
};

// ─── Entry point ──────────────────────────────────────────────────────────────

const loadCheckout = async () => {
    const id = getUrlParam("id");
    const source = getUrlParam("source");

    if (!id && source !== "cart") {
        document.getElementById("payment-info").innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>Vui lòng chọn sản phẩm từ trang chủ hoặc vào giỏ hàng trước khi thanh toán.</p>
                <div style="margin-top:16px;display:flex;gap:12px;">
                    <a href="/" class="btn btn--primary">Trang chủ</a>
                    <a href="/cart.html" class="btn btn--secondary">Xem giỏ hàng</a>
                </div>
            </div>`;
        return;
    }

    if (source === "cart") {
        loadFromCart();
    } else {
        await loadBuyNow(id);
    }
};

document.addEventListener("DOMContentLoaded", loadCheckout);
