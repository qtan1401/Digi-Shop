// ===== CART.JS =====
// Quản lý giỏ hàng qua localStorage. Là module dùng chung cho tất cả trang.
// Các trang import script này đều có thể gọi CartService.* trực tiếp.
//
// API công khai:
//   CartService.addItem(product)        — thêm / tăng số lượng
//   CartService.removeItem(productId)   — xóa hẳn item
//   CartService.updateQty(productId, qty) — cập nhật số lượng
//   CartService.clearCart()             — xóa toàn bộ giỏ hàng
//   CartService.getItems()              — trả về mảng items
//   CartService.getCount()              — tổng số lượng tất cả items
//   CartService.getSubtotal()           — tổng tiền hàng
//   CartService.updateBadge()           — cập nhật badge trên navbar

const CART_KEY = "digi_cart";
const SHIPPING_FEE_DEFAULT = 100000;

// ─── Lưu / Đọc ───────────────────────────────────────────────────────────────

const _load = () => {
    try {
        return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
        return [];
    }
};

const _save = (items) => {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

const CartService = {

    getItems() {
        return _load();
    },

    /**
     * Thêm sản phẩm vào giỏ. Nếu đã có thì tăng số lượng.
     * @param {{ id, name, slug, image, description, price, stock }} product
     * @param {number} quantity
     */
    addItem(product, quantity = 1) {
        if (!product || product.stock <= 0) return { ok: false, reason: "out_of_stock" };

        const items = _load();
        const idx = items.findIndex((i) => i.productId === product.id);

        if (idx >= 0) {
            const newQty = items[idx].quantity + quantity;
            items[idx].quantity = Math.min(newQty, product.stock);
        } else {
            items.push({
                productId: product.id,
                name: product.name,
                slug: product.slug || "",
                image: product.image || "",
                description: product.description || "",
                price: product.price,           // snapshot tại thời điểm add
                quantity: Math.min(quantity, product.stock),
                addedAt: new Date().toISOString()
            });
        }

        _save(items);
        this.updateBadge();
        return { ok: true };
    },

    removeItem(productId) {
        const items = _load().filter((i) => i.productId !== productId);
        _save(items);
        this.updateBadge();
    },

    updateQty(productId, qty) {
        const items = _load();
        const idx = items.findIndex((i) => i.productId === productId);
        if (idx < 0) return;
        if (qty <= 0) {
            items.splice(idx, 1);
        } else {
            items[idx].quantity = qty;
        }
        _save(items);
        this.updateBadge();
    },

    clearCart() {
        localStorage.removeItem(CART_KEY);
        this.updateBadge();
    },

    getCount() {
        return _load().reduce((sum, i) => sum + i.quantity, 0);
    },

    getSubtotal() {
        return _load().reduce((sum, i) => sum + i.price * i.quantity, 0);
    },

    getShippingFee(subtotal) {
        return SHIPPING_FEE_DEFAULT;
    },

    // ─── Badge ───────────────────────────────────────────────────────────────

    updateBadge() {
        const count = this.getCount();
        document.querySelectorAll(".cart-badge").forEach((el) => {
            el.textContent = count > 99 ? "99+" : count;
            el.classList.toggle("cart-badge--hidden", count === 0);
        });
    }
};

// ─── Toast Notification ───────────────────────────────────────────────────────

/**
 * Hiển thị toast nhỏ ở góc dưới phải
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 */
function showToast(message, type = "success") {
    // Tạo container toast nếu chưa có
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
        <span class="toast__icon">${type === "success" ? "✓" : type === "error" ? "✕" : "ℹ"}</span>
        <span class="toast__msg">${message}</span>
    `;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add("toast--show"));

    // Auto remove sau 3s
    setTimeout(() => {
        toast.classList.remove("toast--show");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 3000);
}

// Khởi tạo badge ngay khi DOM ready
document.addEventListener("DOMContentLoaded", () => CartService.updateBadge());
