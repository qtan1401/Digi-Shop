// ===== MAIN.JS =====
// File này xử lý trang chủ: fetch danh sách sản phẩm từ API và render cards

/**
 * Format giá tiền sang dạng VNĐ
 * @param {number} price - Giá sản phẩm
 * @returns {string} Giá đã format (vd: "34.990.000₫")
 */
const formatPrice = (price) => {
    return price.toLocaleString("vi-VN") + "₫";
};

/**
 * Tạo stock badge dựa trên số lượng tồn kho
 * @param {number} stock - Số lượng tồn kho
 * @returns {string} HTML string của badge
 */
const createStockBadge = (stock) => {
    if (stock <= 0) {
        return `<span class="product-card__badge product-card__badge--out">Hết hàng</span>`;
    }
    if (stock <= 5) {
        return `<span class="product-card__badge product-card__badge--low">Còn ${stock}</span>`;
    }
    return `<span class="product-card__badge">Còn ${stock}</span>`;
};

/**
 * Tạo HTML cho 1 product card
 * @param {Object} product - Object sản phẩm
 * @returns {string} HTML string của card
 */
const createProductCard = (product) => {
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
                <a href="/checkouts.html?id=${product.id}" class="btn btn--primary">Mua ngay</a>
                <a href="/product_info.html?id=${product.id}" class="btn btn--secondary">Xem chi tiết</a>
            </div>
        </div>
    </div>
    `;
};

/**
 * Fetch danh sách sản phẩm từ API và render lên trang
 */
const loadProducts = async () => {
    try {
        const res = await fetch("/api/products");
        const data = await res.json();
        const products = data.data;
        const grid = document.getElementById("product-grid");
        grid.innerHTML = products.map(createProductCard).join("");
    } catch (error) {
        const grid = document.getElementById("product-grid");
        grid.innerHTML = `
        <div class="error-message">
            <h2>Không thể tải sản phẩm</h2>
            <p>${error.message}</p>
        </div>
        `;
    }
};

// Chạy khi trang load xong
document.addEventListener("DOMContentLoaded", loadProducts);
