// ===== PRODUCT_INFO.JS =====
// Trang chi tiết sản phẩm: hiển thị thông tin + nút Mua ngay + Thêm vào giỏ
// Disabled cả 2 nút khi hết hàng

const getUrlParam = (param) => new URLSearchParams(window.location.search).get(param);
const formatPrice = (price) => price.toLocaleString("vi-VN") + "₫";

const createStockInfo = (stock) => {
    if (stock <= 0) {
        return `<div class="product-info__stock product-info__stock--out">
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

const loadProductInfo = async () => {
    const id = getUrlParam("id");
    const container = document.getElementById("product-info");

    if (!id) {
        container.innerHTML = `
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>Không có ID sản phẩm trong URL</p>
                <a href="/" class="btn btn--primary" style="margin-top:16px;display:inline-block;">Quay lại trang chủ</a>
            </div>`;
        return;
    }

    try {
        const res = await fetch(`/api/products/info/${id}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        const product = data.data;
        const outOfStock = product.stock <= 0;

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
                        ${outOfStock
                            ? `<button class="btn btn--primary" disabled style="opacity:.45;cursor:not-allowed;">Hết hàng</button>
                               <button class="btn btn--secondary" disabled style="opacity:.45;cursor:not-allowed;">Thêm vào giỏ</button>`
                            : `<a href="/checkouts.html?id=${product.id}" class="btn btn--primary">Mua ngay</a>
                               <button class="btn btn--secondary btn--add-cart" id="btn-add-cart"
                                   onclick="handleAddToCart()">
                                   Thêm vào giỏ
                               </button>`
                        }
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
            </div>`;

        // Gắn handler sau khi DOM render xong (product đã có trong closure)
        if (!outOfStock) {
            window.handleAddToCart = () => {
                const btn = document.getElementById("btn-add-cart");
                const result = CartService.addItem(product);
                if (!result.ok) {
                    showToast("Sản phẩm đã hết hàng!", "error");
                    return;
                }
                const original = btn.textContent;
                btn.textContent = "✓ Đã thêm vào giỏ";
                btn.disabled = true;
                setTimeout(() => {
                    btn.textContent = original;
                    btn.disabled = false;
                }, 1500);
                showToast(`Đã thêm "${product.name}" vào giỏ hàng`, "success");
            };
        }

    } catch (error) {
        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>${error.message}</p>
            </div>`;
    }
};

document.addEventListener("DOMContentLoaded", loadProductInfo);
