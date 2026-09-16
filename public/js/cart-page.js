// ===== CART-PAGE.JS =====
// Logic dành riêng cho trang /cart.html
// Đọc CartService (từ cart.js), validate với server, render UI giỏ hàng

const SHIPPING_FEE = 100000; // Giá hiển thị mặc định là 100.000 VNĐ

const formatPrice = (price) => Number(price).toLocaleString("vi-VN") + "₫";

// ─── State ────────────────────────────────────────────────────────────────────
let validatedItems = []; // Cache validated items from server

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
        // Find stock from validatedItems
        const validated = validatedItems.find(v => v.productId === item.productId);
        const stock = validated ? validated.stock : item.quantity;
        const maxQty = Math.max(item.quantity, stock); // Allow current qty even if stock lower
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
                        <button class="qty-btn" onclick="changeQty(${item.productId}, ${item.quantity - 1}, ${stock})"
                            ${item.quantity <= 1 ? 'data-action="remove"' : ''}>−</button>
                        <span class="cart-item__qty">${item.quantity}</span>
                        <button class="qty-btn" onclick="changeQty(${item.productId}, ${item.quantity + 1}, ${stock})"
                            ${item.quantity >= stock ? 'disabled' : ''}>+</button>
                    </div>
                    <span class="cart-item__line-total">${formatPrice(lineTotal)}</span>
                    <button class="cart-item__remove" onclick="removeItem(${item.productId})" title="Xóa sản phẩm">✕</button>
                </div>
                ${validated && validated.quantityAdjusted ? '<span class="cart-item__stock-warning">Số lượng đã điều chỉnh do hết hàng</span>' : ''}
            </div>
        </div>`;
    }).join("");

    const shipBanner = `
        <div class="cart-freeship-banner">
            🚚 Phí vận chuyển tiêu chuẩn: <strong>${formatPrice(shippingFee)}</strong>
        </div>`;

    root.innerHTML = `
        <div class="cart-items">${itemsHtml}</div>
        ${shipBanner}
        <div class="cart-summary">
            <div class="cart-summary__row"><span>Tạm tính</span><span>${formatPrice(subtotal)}</span></div>
            <div class="cart-summary__row"><span>Phí ship</span><span>${formatPrice(shippingFee)}</span></div>
            <div class="cart-summary__row cart-summary__row--total"><span>Tổng cộng</span><span>${formatPrice(total)}</span></div>
        </div>
        <div class="cart-actions">
            <a href="/" class="btn btn--secondary">Tiếp tục mua sắm</a>
            <a href="/checkouts.html?source=cart" class="btn btn--primary" id="btn-checkout">Thanh toán ngay</a>
        </div>`;
};

// ─── Actions ─────────────────────────────────────────────────────────────────
function changeQty(productId, newQty, maxStock) {
    if (newQty <= 0) {
        if (confirm("Xóa sản phẩm này khỏi giỏ hàng?")) {
            CartService.removeItem(productId);
            loadAndRenderCart();
        } else return;
    } else {
        const result = CartService.updateQty(productId, newQty, maxStock);
        if (!result.ok) {
            showToast(result.message || "Không thể cập nhật số lượng", "error");
            return;
        }
        loadAndRenderCart();
    }
}

function removeItem(productId) {
    CartService.removeItem(productId);
    loadAndRenderCart();
}

function clearCart() {
    if (confirm("Bạn có chắc muốn xóa toàn bộ giỏ hàng?")) {
        CartService.clearCart();
        loadAndRenderCart();
    }
}

// ─── Load & Validate ─────────────────────────────────────────────────────────
async function loadAndRenderCart() {
    const items = CartService.getItems();
    if (items.length === 0) {
        validatedItems = [];
        renderCart([]);
        return;
    }

    try {
        const res = await fetch("/api/cart/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: items.map(i => ({ productId: i.productId, quantity: i.quantity })) })
        });
        const data = await res.json();
        if (data.success) {
            validatedItems = data.data.validatedItems || [];
            // Merge validated data with localStorage items (keep snapshot price, use validated quantity/stock)
            const mergedItems = items.map(item => {
                const validated = validatedItems.find(v => v.productId === item.productId);
                if (validated) {
                    return {
                        ...item,
                        quantity: validated.quantity, // Use server-validated quantity
                        stock: validated.stock,
                        quantityAdjusted: validated.quantityAdjusted,
                        unavailableReason: validated.unavailableReason
                    };
                }
                return item;
            });
            // Update localStorage with validated quantities
            const cartKey = "digi_cart";
            localStorage.setItem(cartKey, JSON.stringify(mergedItems));
            renderCart(mergedItems);
        } else {
            console.warn("Cart validate failed:", data.message);
            validatedItems = [];
            renderCart(items);
        }
    } catch (err) {
        console.error("Cart validate error:", err);
        validatedItems = [];
        renderCart(items);
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    loadAndRenderCart();
});
