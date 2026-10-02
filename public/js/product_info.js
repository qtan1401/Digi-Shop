// ===== PRODUCT_INFO.JS =====
// Trang chi tiết sản phẩm: hiển thị thông tin + nút Mua ngay + Thêm vào giỏ
// Disabled cả 2 nút khi hết hàng

const getUrlParam = (param) => new URLSearchParams(window.location.search).get(param);
const formatPrice = (price) => price.toLocaleString("vi-VN") + "₫";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
})[character]);

const createDescriptionRows = (description) => {
    const text = String(description ?? "").trim();
    if (!text) return "";

    const entries = text
        .split(/(?:\s*•\s*|\r?\n)+/u)
        .flatMap((entry) => {
            const section = entry.match(/([.!?])\s+((?:\p{Lu}\p{Ll}+\s+){1,5}\p{Lu}\p{Ll}+)$/u);
            return section && entry.includes(":")
                ? [entry.slice(0, section.index).trim() + section[1], section[2]]
                : [entry];
        })
        .map((entry) => entry.trim())
        .filter(Boolean);

    if (!entries.some((entry) => entry.includes(":"))) {
        return `<tr><th scope="row">Mô tả</th><td>${escapeHtml(text)}</td></tr>`;
    }

    return entries.map((entry, index) => {
        const separator = entry.indexOf(":");
        if (separator > 0) {
            const label = entry.slice(0, separator).trim();
            const value = entry.slice(separator + 1).trim();
            return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
        }

        const hasFieldsAfter = entries.slice(index + 1).some((nextEntry) => nextEntry.includes(":"));
        return hasFieldsAfter
            ? `<tr class="product-info__specification-section"><th colspan="2">${escapeHtml(entry)}</th></tr>`
            : `<tr><th scope="row">Mô tả</th><td>${escapeHtml(entry)}</td></tr>`;
    }).join("");
};

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
        const authState = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false }));
        const canPurchase = authState.user?.role !== "admin";

        const descriptionRows = createDescriptionRows(product.description);
        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="product-info__card">
                <img src="${product.image}" alt="${product.name}" class="product-info__image">
                <div class="product-info__content">
                    <h1 class="product-info__name">${product.name}</h1>
                    <div class="product-info__price">${formatPrice(product.price)}</div>
                    ${createStockInfo(product.stock)}
                    <div class="product-info__actions">
                        ${!canPurchase
                            ? `<span class="product-card__role-note">Tài khoản Admin chỉ xem catalog.</span>`
                            : outOfStock
                                ? `<button class="btn btn--primary" disabled style="opacity:.45;cursor:not-allowed;">Hết hàng</button>
                                   <button class="btn btn--secondary" disabled style="opacity:.45;cursor:not-allowed;">Thêm vào giỏ</button>`
                                : `<a href="/checkouts.html?id=${product.id}" class="btn btn--primary">Mua ngay</a>
                                   <button class="btn btn--secondary btn--add-cart" id="btn-add-cart"
                                       onclick="handleAddToCart()">
                                       Thêm vào giỏ
                                   </button>`
                        }
                    </div>
                </div>
            </div>
            ${descriptionRows ? `
                <section class="product-info__specifications" aria-labelledby="product-info-specifications-title">
                    <h2 class="product-info__specifications-title" id="product-info-specifications-title">Thông số kỹ thuật</h2>
                    <div class="product-info__specifications-table-wrapper">
                        <table class="product-info__specifications-table">
                            <tbody>${descriptionRows}</tbody>
                        </table>
                    </div>
                </section>
            ` : ""}`;

        // Gắn handler sau khi DOM render xong (product đã có trong closure)
        if (!outOfStock && canPurchase) {
            window.handleAddToCart = () => {
                const btn = document.getElementById("btn-add-cart");
                const result = CartService.addItem(product);
                if (!result.ok) {
                    showToast(result.message || "Sản phẩm đã hết hàng!", "error");
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
