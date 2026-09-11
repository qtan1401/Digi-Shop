// ===== CART-PAGE.JS =====
// Logic dành riêng cho trang /cart.html
// Đọc CartService (từ cart.js), validate với server, render UI giỏ hàng

const SHIPPING_FEE = 100000; // Giá hiển thị mặc định là 100.000 VNĐ

const formatPrice = (price) => Number(price).toLocaleString("vi-VN") + "₫";

// ─── Tính toán ────────────────────────────────────────────────────────────────

const calcSubtotal = (items) => items.reduce((s, i) => s + i.price * i.quantity, 0);
const calcShipping = (subtotal) => SHIPPING_FEE;

// ─── Render giỏ hàng ─────────────────────────────────────────────────────────

const renderCart = (items) => {
    const root = document.getElementById("cart-root");

    if (!items || items.length === 0) {
        root.innerHTML = `
            <div class="cart-empty">
                <div class="cart-empty__icon">🛒</div>
                <h2 class="cart-empty__title">Giỏ hàng trống</h2>
                <p class="cart-empty__desc">Bạn chưa có sản phẩm nào trong giỏ hàng.</p>
                <a href="/" class="btn btn--primary">Tiếp tục mua sắm</a>
            </div>`;
        return;
    }

    const subtotal = calcSubtotal(items);
    const shippingFee = calcShipping(subtotal);
    const total = subtotal + shippingFee;

    const itemsHtml = items.map((item) => {
        const lineTotal = item.price * item.quantity;
        return `
        <div class="cart-item" data-product-id="${item.productId}">
            <div class="cart-item__img-wrap">
                <img src="${item.image || '/img/placeholder.png'}" alt="${item.name}" class="cart-item__img">
            </div>
            <div class="cart-item__body">
                <div class="cart-item__name">${item.name}</div>
                <p class="cart-item__desc">${item.description || ''}</p>
                <div class="cart-item__price-row">
                    <span class="cart-item__unit-price">${formatPrice(item.price)}</span>
                    <div class="cart-item__qty-controls">
                        <button class="qty-btn" onclick="changeQty(${item.productId}, ${item.quantity - 1})"
                            ${item.quantity <= 1 ? 'data-action="remove"' : ''}>−</button>
                        <span class="cart-item__qty">${item.quantity}</span>
                        <button class="qty-btn" onclick="changeQty(${item.productId}, ${item.quantity + 1})">+</button>
                    </div>
                    <span class="cart-item__line-total">${formatPrice(lineTotal)}</span>
                    <button class="cart-item__remove" onclick="removeItem(${item.productId})" title="Xóa sản phẩm">✕</button>
                </div>
            </div>
        </div>`;
    }).join("");

    const shipBanner = `
        <div class="cart-freeship-banner">
            🚚 Phí vận chuyển tiêu chuẩn: <strong>${formatPrice(shippingFee)}</strong>
        </div>`;

    root.innerHTML = `
        <div class="cart-layout">
            <!-- Danh sách sản phẩm -->
            <div class="cart-items">
                <div class="cart-items__header">
                    <span>${items.length} sản phẩm</span>
                    <button class="cart-clear-btn" onclick="clearCart()">Xóa tất cả</button>
                </div>
                ${itemsHtml}
            </div>

            <!-- Tóm tắt & thanh toán -->
            <div class="cart-sidebar">
                ${shipBanner}
                <div class="cart-summary">
                    <div class="cart-summary__title">Tóm tắt đơn hàng</div>
                    <div class="cart-summary__row">
                        <span>Tạm tính (${items.reduce((s, i) => s + i.quantity, 0)} sản phẩm)</span>
                        <span>${formatPrice(subtotal)}</span>
                    </div>
                    <div class="cart-summary__row">
                        <span>Phí vận chuyển</span>
                        <span>${formatPrice(shippingFee)}</span>
                    </div>
                    <div class="cart-summary__divider"></div>
                    <div class="cart-summary__row cart-summary__row--total">
                        <span>Tổng cộng</span>
                        <span>${formatPrice(total)}</span>
                    </div>
                    <a href="/checkouts.html?source=cart" class="btn btn--primary btn--checkout cart-checkout-btn">
                        Tiến hành thanh toán →
                    </a>
                    <a href="/" class="cart-continue-link">← Tiếp tục mua sắm</a>
                </div>
            </div>
        </div>`;
};

// ─── Actions ─────────────────────────────────────────────────────────────────

function changeQty(productId, newQty) {
    if (newQty <= 0) {
        if (confirm("Xóa sản phẩm này khỏi giỏ hàng?")) {
            CartService.removeItem(productId);
        } else return;
    } else {
        CartService.updateQty(productId, newQty);
    }
    renderCart(CartService.getItems());
}

function removeItem(productId) {
    CartService.removeItem(productId);
    renderCart(CartService.getItems());
}

function clearCart() {
    if (confirm("Bạn có chắc muốn xóa toàn bộ giỏ hàng?")) {
        CartService.clearCart();
        renderCart([]);
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    renderCart(CartService.getItems());
});
