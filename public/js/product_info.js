// ===== PRODUCT_INFO.JS =====
// File này xử lý trang chi tiết sản phẩm
// Lấy id từ URL (Query String), gọi API, và render thông tin

/**
 * Lấy giá trị của parameter từ URL
 * @param {string} param - Tên parameter cần lấy
 * @returns {string|null} Giá trị parameter hoặc null
 */
const getUrlParam = (param) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
};

/**
 * Format giá tiền sang dạng VNĐ
 */
const formatPrice = (price) => {
    return price.toLocaleString("vi-VN") + "₫";
};

/**
 * Tạo stock indicator
 */
const createStockInfo = (stock) => {
    if (stock <= 0) {
        return `<div class="product-info__stock">
            <span class="product-info__stock-dot product-info__stock-dot--low"></span>
            Hết hàng
        </div>`;
    }
    const dotClass = stock <= 5 ? "product-info__stock-dot--low" : "";
    const text = stock <= 5 ? `Chỉ còn ${stock} sản phẩm` : `Còn ${stock} sản phẩm`;
    return `<div class="product-info__stock">
        <span class="product-info__stock-dot ${dotClass}"></span>
        ${text}
    </div>`;
};

/**
 * Fetch thông tin sản phẩm từ API và render lên trang
 */
const loadProductInfo = async () => {
    const id = getUrlParam("id");
    const container = document.getElementById("product-info");

    if (!id) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>Không có ID sản phẩm trong URL</p>
            </div>
        `;
        return;
    }

    try {
        const res = await fetch(`/api/products/info/${id}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.message);
        }

        const product = data.data;
        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="product-info__card">
                <img src="${product.image}" alt="${product.name}" class="product-info__image">
                <div class="product-info__content">
                    <h1 class="product-info__name">${product.name}</h1>
                    <div class="product-info__price">${formatPrice(product.price)}</div>
                    ${createStockInfo(product.stock)}
                    <p class="product-info__description">${product.description}</p>
                    <div class="product-info__actions">
                        <a href="/checkouts.html?id=${product.id}" class="btn btn--primary">Mua ngay</a>
                    </div>
                    <div class="product-info__meta">
                        <div class="product-info__meta-item">
                            <span class="product-info__meta-label">ID</span>
                            <span class="product-info__meta-value">#${product.id}</span>
                        </div>
                        <div class="product-info__meta-item">
                            <span class="product-info__meta-label">Slug</span>
                            <span class="product-info__meta-value">${product.slug}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>${error.message}</p>
            </div>
        `;
    }
};

// Chạy khi trang load xong
document.addEventListener("DOMContentLoaded", loadProductInfo);
