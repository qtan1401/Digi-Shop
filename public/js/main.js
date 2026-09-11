// ===== MAIN.JS =====
// Trang chủ: fetch danh sách sản phẩm, render cards
// Mỗi card có: "Mua ngay" (direct checkout) + "Thêm vào giỏ" + disabled khi hết hàng

const formatPrice = (price) => price.toLocaleString("vi-VN") + "₫";

const createStockBadge = (stock) => {
    if (stock <= 0) return `<span class="product-card__badge product-card__badge--out">Hết hàng</span>`;
    if (stock <= 5) return `<span class="product-card__badge product-card__badge--low">Còn ${stock}</span>`;
    return `<span class="product-card__badge">Còn ${stock}</span>`;
};

const createProductCard = (product) => {
    const outOfStock = product.stock <= 0;
    return `
    <div class="product-card">
        <div class="product-card__image-wrapper">
            <img src="${product.image}" alt="${product.name}" class="product-card__image">
            ${createStockBadge(product.stock)}
        </div>
        <div class="product-card__body">
            <h3 class="product-card__name">${product.name}</h3>
            <p class="product-card__description">${product.description}</p>
            <span class="product-card__price">${formatPrice(product.price)}</span>
            <div class="product-card__footer">
                ${outOfStock
                    ? `<button class="btn btn--primary" disabled style="opacity:.45;cursor:not-allowed;">Hết hàng</button>
                       <button class="btn btn--secondary" disabled style="opacity:.45;cursor:not-allowed;">Thêm giỏ hàng</button>`
                    : `<a href="/checkouts.html?id=${product.id}" class="btn btn--primary">Mua ngay</a>
                       <button class="btn btn--secondary btn--add-cart"
                           onclick="handleAddToCart(${product.id}, '${product.name.replace(/'/g, "\\'")}', ${product.price}, ${product.stock}, this)">
                           Thêm vào giỏ
                       </button>`
                }
            </div>
        </div>
    </div>
    `;
};

/**
 * Xử lý nút "Thêm vào giỏ" từ product card
 * product data được truyền trực tiếp qua params để tránh gọi API thêm
 */
function handleAddToCart(id, name, price, stock, btnEl) {
    const result = CartService.addItem({ id, name, price, stock, image: "", description: "" });
    if (!result.ok) {
        showToast("Sản phẩm đã hết hàng!", "error");
        return;
    }
    // Visual feedback tạm thời trên nút
    const original = btnEl.textContent;
    btnEl.textContent = "✓ Đã thêm";
    btnEl.disabled = true;
    setTimeout(() => {
        btnEl.textContent = original;
        btnEl.disabled = false;
    }, 1500);
    showToast(`Đã thêm "${name}" vào giỏ hàng`, "success");
}

const loadProducts = async () => {
    try {
        const res = await fetch("/api/products");
        const data = await res.json();
        const grid = document.getElementById("product-grid");
        grid.innerHTML = data.data.map(createProductCard).join("");
    } catch (error) {
        document.getElementById("product-grid").innerHTML = `
        <div class="error-message">
            <h2>Không thể tải sản phẩm</h2>
            <p>${error.message}</p>
        </div>`;
    }
};

document.addEventListener("DOMContentLoaded", loadProducts);
