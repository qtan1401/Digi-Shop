// ===== CART-PAGE.JS =====
// Cart UI for Guest local storage and User server Account carts.

const SHIPPING_FEE = 100000;
const formatPrice = (price) => Number(price || 0).toLocaleString("vi-VN") + "₫";
let validatedItems = [];
let cartRenderVersion = 0;

const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const itemValidation = (item) => validatedItems.find((candidate) => Number(candidate.productId) === Number(item.productId));
const effectiveItem = (item) => itemValidation(item) || item;
const isUnavailable = (item) => effectiveItem(item).available === false || item.available === false;

const unavailableReason = (item) => {
    const reason = effectiveItem(item).unavailableReason;
    if (reason === "out_of_stock") return "Sản phẩm hiện đã hết hàng, vui lòng xóa khỏi giỏ hàng.";
    if (reason === "soft_deleted") return "Sản phẩm đã ngừng kinh doanh, vui lòng xóa khỏi giỏ hàng.";
    if (reason === "not_found") return "Sản phẩm không còn tồn tại, vui lòng xóa khỏi giỏ hàng.";
    return typeof reason === "string" && reason.length > 20 ? reason : "Sản phẩm không khả dụng, vui lòng xóa khỏi giỏ hàng.";
};

const calcSubtotal = (items) => items.reduce((sum, item) => {
    if (isUnavailable(item)) return sum;
    const value = effectiveItem(item);
    return sum + Number(value.price || item.price || 0) * Number(value.quantity || item.quantity || 0);
}, 0);

const renderForbidden = () => {
    const root = document.getElementById("cart-root");
    if (!root) return;
    root.innerHTML = `
        <div class="checkout-auth-forbidden" role="alert" tabindex="-1">
            <div class="checkout-auth-forbidden__code">403</div>
            <h2>Admin không thể mua hàng</h2>
            <p>Phiên Admin chỉ được dùng để quản trị. Hãy mở storefront bằng tài khoản User để xem giỏ hàng.</p>
            <div class="checkout-auth-forbidden__actions">
                <a class="btn btn--primary" href="/admin.html">Về quản trị</a>
                <a class="btn btn--secondary" href="/">Mở storefront</a>
            </div>
        </div>`;
    root.querySelector("[tabindex]")?.focus();
};

const renderCart = (items) => {
    const root = document.getElementById("cart-root");
    if (!root) return;
    const renderVersion = ++cartRenderVersion;
    const safeItems = Array.isArray(items) ? items : [];
    const mergeError = CartService.getMergeError();
    const mergeErrorHtml = mergeError
        ? `<section class="checkout-merge-error" role="alert" aria-live="assertive"><strong>Chưa hợp nhất được giỏ hàng.</strong><p>${escapeHtml(mergeError.message || "Giỏ Guest vẫn được giữ nguyên.")}</p><button type="button" class="btn btn--secondary" onclick="retryCartMerge()">Thử hợp nhất lại</button></section>`
        : "";
    if (safeItems.length === 0) {
        root.innerHTML = `${mergeErrorHtml}
            <div class="cart-empty">
                <div class="cart-empty__icon" aria-hidden="true">🛒</div>
                <h2 class="cart-empty__title">Giỏ hàng trống</h2>
                <p class="cart-empty__desc">Bạn chưa có sản phẩm nào trong giỏ hàng.</p>
                <a href="/" class="btn btn--primary">Tiếp tục mua sắm</a>
            </div>`;
        return;
    }

    const unavailableItems = safeItems.filter(isUnavailable);
    const subtotal = calcSubtotal(safeItems);
    const shippingFee = SHIPPING_FEE;
    const total = subtotal + shippingFee;
    const itemsHtml = safeItems.map((item) => {
        const value = effectiveItem(item);
        const productId = Number(item.productId);
        const quantity = Number(value.quantity || item.quantity || 1);
        const stock = Number(value.stock ?? item.stock ?? quantity);
        const unavailable = isUnavailable(item);
        const maxStock = Math.max(quantity, stock);
        const lineTotal = unavailable ? 0 : Number(value.price || item.price || 0) * quantity;
        const warning = unavailable ? unavailableReason(item) : value.quantityAdjusted ? "Số lượng đã điều chỉnh do tồn kho." : "";
        return `
        <article class="cart-item ${unavailable ? "cart-item--unavailable" : ""}" data-product-id="${productId}">
            <div class="cart-item__img-wrap">
                <img src="${escapeHtml(value.image || item.image || "/img/placeholder.png")}" alt="${escapeHtml(value.name || item.name)}" class="cart-item__img">
            </div>
            <div class="cart-item__body">
                <div class="cart-item__name">${escapeHtml(value.name || item.name)}</div>
                <p class="cart-item__desc">${escapeHtml(value.description || item.description || "")}</p>
                <div class="cart-item__price-row">
                    <span class="cart-item__unit-price">${formatPrice(value.price || item.price)}</span>
                    <div class="cart-item__qty-controls" aria-label="Số lượng ${escapeHtml(value.name || item.name)}">
                        <button class="qty-btn" type="button" onclick="changeQty(${productId}, ${quantity - 1}, ${stock})" ${quantity <= 1 ? "aria-label=\"Xóa sản phẩm\"" : "aria-label=\"Giảm số lượng\""}>−</button>
                        <span class="cart-item__qty" aria-live="polite">${quantity}</span>
                        <button class="qty-btn" type="button" onclick="changeQty(${productId}, ${quantity + 1}, ${stock})" ${unavailable || quantity >= stock ? "disabled" : "aria-label=\"Tăng số lượng\""}>+</button>
                    </div>
                    <span class="cart-item__line-total">${formatPrice(lineTotal)}</span>
                    <button class="cart-item__remove" type="button" onclick="removeItem(${productId})" aria-label="Xóa ${escapeHtml(value.name || item.name)}">✕</button>
                </div>
                ${warning ? `<p class="cart-item__stock-warning" role="alert">${escapeHtml(warning)}</p>` : ""}
            </div>
        </article>`;
    }).join("");

    root.innerHTML = `${mergeErrorHtml}
        ${unavailableItems.length ? `<div class="cart-item__stock-warning" role="alert" aria-live="polite">Có sản phẩm không khả dụng. Xóa hoặc sửa các sản phẩm được đánh dấu trước khi thanh toán.</div>` : ""}
        <div class="cart-layout">
            <div class="cart-items">
                <div class="cart-items__header"><span>${safeItems.length} sản phẩm</span><button class="cart-clear-btn" type="button" onclick="clearCart()">Xóa tất cả</button></div>
                ${itemsHtml}
            </div>
            <aside class="cart-sidebar">
                <div class="cart-freeship-banner">🚚 Phí vận chuyển tiêu chuẩn: <strong>${formatPrice(shippingFee)}</strong></div>
                <div class="cart-summary">
                    <div class="cart-summary__title">Tóm tắt đơn hàng</div>
                    <div class="cart-summary__row"><span>Tạm tính</span><span>${formatPrice(subtotal)}</span></div>
                    <div class="cart-summary__row"><span>Phí ship</span><span>${formatPrice(shippingFee)}</span></div>
                    <div class="cart-summary__row cart-summary__row--total"><span>Tổng cộng</span><span>${formatPrice(total)}</span></div>
                    ${unavailableItems.length
                        ? `<button class="btn btn--primary cart-checkout-btn" id="btn-checkout" type="button" disabled aria-disabled="true">Xóa sản phẩm không khả dụng để thanh toán</button>`
                        : `<a href="/checkouts.html?source=cart" class="btn btn--primary cart-checkout-btn" id="btn-checkout">Thanh toán ngay</a>`}
                    <a href="/" class="cart-continue-link">Tiếp tục mua sắm</a>
                </div>
            </aside>
        </div>`;
    if (renderVersion !== cartRenderVersion) return;
};

const rerender = async () => {
    const root = document.getElementById("cart-root");
    if (!root) return;
    const session = CartService.getSession();
    if (session.user?.role === "admin") return renderForbidden();
    const items = CartService.getItems();
    if (CartService.isAccountCart()) {
        validatedItems = [];
        renderCart(items);
        return;
    }
    await validateGuestCart(items);
};

async function retryCartMerge() {
    const button = document.querySelector(".checkout-merge-error button");
    if (button) { button.disabled = true; button.textContent = "Đang thử lại..."; }
    try {
        await window.DigiCart?.retryMerge?.();
        window.location.reload();
    } catch (error) {
        showToast(error.message || "Không thể hợp nhất giỏ hàng.", "error");
        if (button) { button.disabled = false; button.textContent = "Thử hợp nhất lại"; }
    }
}

async function changeQty(productId, newQty, maxStock) {
    if (newQty <= 0 && !window.confirm("Xóa sản phẩm này khỏi giỏ hàng?")) return;
    const result = CartService.updateQty(productId, newQty, maxStock);
    if (!result.ok) {
        showToast(result.message || "Không thể cập nhật số lượng", "error");
        return;
    }
    if (result.promise) await result.promise;
    await rerender();
}

async function removeItem(productId) {
    const result = CartService.removeItem(productId);
    if (result.promise) await result.promise;
    await rerender();
}

async function clearCart() {
    if (!window.confirm("Bạn có chắc muốn xóa toàn bộ giỏ hàng?")) return;
    try {
        await CartService.clearCart();
        await rerender();
    } catch (error) {
        showToast(error.message || "Không thể xóa giỏ hàng", "error");
    }
}

async function validateGuestCart(items) {
    const current = Array.isArray(items) ? items : [];
    if (!current.length) {
        validatedItems = [];
        renderCart([]);
        return;
    }
    try {
        const response = await fetch("/api/cart/validate", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: current.map((item) => ({ productId: item.productId, quantity: item.quantity })) })
        });
        const body = await response.json();
        if (!response.ok || body.success === false) throw new Error(body.message || "Không thể kiểm tra giỏ hàng");
        validatedItems = body.data?.validatedItems || [];
        const merged = current.map((item) => {
            const valid = validatedItems.find((entry) => Number(entry.productId) === Number(item.productId));
            return valid ? { ...item, quantity: valid.quantity, stock: valid.stock, available: valid.available, unavailableReason: valid.unavailableReason } : item;
        });
        // Keep unavailable items visible for repair; only available quantity caps are persisted.
        localStorage.setItem("digi_cart", JSON.stringify(merged));
        renderCart(merged);
    } catch (error) {
        validatedItems = [];
        renderCart(current);
        const alert = document.getElementById("cart-network-alert");
        if (alert) alert.textContent = error.message;
    }
}

const initCartPage = async () => {
    await CartService.whenReady();
    if (CartService.isAccountCart()) {
        try { await CartService.refresh(); } catch (_) { /* keep the current cart/error state visible */ }
    }
    const session = CartService.getSession();
    if (session.user?.role === "admin") return renderForbidden();
    await rerender();
};

document.addEventListener("DOMContentLoaded", initCartPage);
