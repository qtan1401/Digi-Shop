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
        const res = await fetch(`/api/products/info/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const product = data.data;
        const variants = product.variants || [];
        let selectedVariant = variants.find((variant) => variant.stock > 0) || variants[0] || null;
        const authState = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false }));
        const canPurchase = authState.user?.role !== "admin";
        const descriptionRows = createDescriptionRows(product.description);
        const normalizeOptionName = (name) => String(name ?? "").trim().toLowerCase();
        const optionControls = (product.options || []).map((option) => {
            const isColor = normalizeOptionName(option.name) === "màu sắc";
            const buttons = (option.values || []).map((value) => {
                const isSelected = selectedVariant?.optionValues?.[option.name] === value.value;
                if (isColor) {
                    const hasHex = Boolean(value.colorHex);
                    const dot = hasHex
                        ? `<span class="product-info__swatch-dot" style="background-color:${escapeHtml(value.colorHex)}"></span>`
                        : "";
                    return `<button type="button" class="product-info__swatch${hasHex ? "" : " product-info__swatch--outline"}" data-option-name="${escapeHtml(option.name)}" data-option-value="${escapeHtml(value.value)}" aria-pressed="${isSelected}" title="${escapeHtml(value.value)}">
                        ${dot}<span class="product-info__swatch-label">${escapeHtml(value.value)}</span>
                    </button>`;
                }
                return `<button type="button" class="product-info__chip" data-option-name="${escapeHtml(option.name)}" data-option-value="${escapeHtml(value.value)}" aria-pressed="${isSelected}">${escapeHtml(value.value)}</button>`;
            }).join("");
            return `<div class="product-info__option">
                <span class="product-info__option-label">${escapeHtml(option.name)}</span>
                <div class="product-info__option-values" role="group" aria-label="${escapeHtml(option.name)}">${buttons}</div>
            </div>`;
        }).join("");

        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="product-info__card">
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="product-info__image" id="product-info-image">
                <div class="product-info__content">
                    <h1 class="product-info__name">${escapeHtml(product.name)}</h1>
                    <div class="product-info__price" id="variant-price">${selectedVariant ? formatPrice(selectedVariant.price) : "Tạm hết hàng"}</div>
                    ${optionControls ? `<div class="product-info__options" aria-label="Chọn phiên bản">${optionControls}</div>` : ""}
                    <div class="product-info__sku">SKU: <strong id="variant-sku">${escapeHtml(selectedVariant?.sku || "—")}</strong></div>
                    <div id="variant-stock">${createStockInfo(selectedVariant?.stock || 0)}</div>
                    <div class="product-info__actions">
                        ${!canPurchase
                            ? `<span class="product-card__role-note">Tài khoản Admin chỉ xem catalog.</span>`
                            : `<a href="#" class="btn btn--primary" id="buy-now-link" ${selectedVariant?.stock > 0 ? "" : "aria-disabled=\"true\""}>Mua ngay</a>
                               <button class="btn btn--secondary btn--add-cart" id="btn-add-cart" type="button" ${selectedVariant?.stock > 0 ? "" : "disabled"}>
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

        const updateSelectedVariant = () => {
            const selectedOptions = Object.fromEntries(
                Array.from(container.querySelectorAll('[data-option-name][aria-pressed="true"]'))
                    .map((button) => [button.dataset.optionName, button.dataset.optionValue])
            );
            const matches = variants.filter((variant) =>
                Object.entries(selectedOptions).every(([name, value]) => variant.optionValues?.[name] === value)
            );
            selectedVariant = matches.length === 1 ? matches[0] : null;
            const price = container.querySelector("#variant-price");
            const sku = container.querySelector("#variant-sku");
            const stock = container.querySelector("#variant-stock");
            const buyNow = container.querySelector("#buy-now-link");
            const addToCart = container.querySelector("#btn-add-cart");
            price.textContent = selectedVariant ? formatPrice(selectedVariant.price) : "Tổ hợp này không được bán";
            sku.textContent = selectedVariant?.sku || "—";
            stock.innerHTML = selectedVariant
                ? createStockInfo(selectedVariant.stock)
                : `<div class="product-info__stock product-info__stock--out">Không có phiên bản này</div>`;
            const available = Boolean(selectedVariant && selectedVariant.stock > 0);
            if (buyNow) {
                buyNow.href = available ? `/checkouts.html?id=${encodeURIComponent(product.id)}&variantId=${encodeURIComponent(selectedVariant.id)}` : "#";
                buyNow.setAttribute("aria-disabled", String(!available));
                buyNow.classList.toggle("is-disabled", !available);
            }
            if (addToCart) addToCart.disabled = !available;
        };

        container.querySelectorAll("[data-option-name]").forEach((button) =>
            button.addEventListener("click", () => {
                const optionName = button.dataset.optionName;
                const optionValue = button.dataset.optionValue;
                container.querySelectorAll("[data-option-name]").forEach((sibling) => {
                    if (sibling.dataset.optionName === optionName) {
                        sibling.setAttribute("aria-pressed", String(sibling === button));
                    }
                });
                if (normalizeOptionName(optionName) === "màu sắc") {
                    const colorVariant = variants.find((variant) =>
                        variant.optionValues?.[optionName] === optionValue && variant.image
                    );
                    if (colorVariant?.image) {
                        const image = container.querySelector("#product-info-image");
                        if (image) image.src = colorVariant.image;
                    }
                }
                updateSelectedVariant();
            })
        );
        const buyNow = container.querySelector("#buy-now-link");
        updateSelectedVariant();
        buyNow?.addEventListener("click", (event) => {
            if (!selectedVariant || selectedVariant.stock <= 0) event.preventDefault();
        });
        container.querySelector("#btn-add-cart")?.addEventListener("click", () => {
            if (!selectedVariant || selectedVariant.stock <= 0) return;
            const result = CartService.addItem({
                variantId: selectedVariant.id,
                productId: product.id,
                name: product.name,
                variantLabel: Object.entries(selectedVariant.optionValues || {}).map(([name, value]) => `${name}: ${value}`).join(" · "),
                optionValues: selectedVariant.optionValues || {},
                sku: selectedVariant.sku,
                slug: product.slug,
                price: selectedVariant.price,
                stock: selectedVariant.stock,
                image: selectedVariant.image || product.image,
                description: product.description
            });
            if (!result.ok) {
                showToast(result.message || "Phiên bản đã hết hàng!", "error");
                return;
            }
            if (result.promise) result.promise.catch(() => {});
            showToast(`Đã thêm "${product.name}" vào giỏ hàng`, "success");
        });
    } catch (error) {
        container.innerHTML = `
            <a href="/" class="product-info__back">Quay lại trang chủ</a>
            <div class="error-message">
                <h2>Không tìm thấy sản phẩm</h2>
                <p>${escapeHtml(error.message)}</p>
            </div>`;
    }
};

document.addEventListener("DOMContentLoaded", loadProductInfo);
