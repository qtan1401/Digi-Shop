// ===== MAIN.JS =====
// Trang chủ: fetch danh sách sản phẩm, render cards
// Mỗi card có: "Mua ngay" (direct checkout) + "Thêm vào giỏ" + disabled khi hết hàng

const catalogState = {
    products: [],
    canPurchase: true,
    sortBy: null,
    sortDirection: "asc",
    appliedSearch: "",
    searchTimer: null,
    minPrice: "",
    maxPrice: ""
};
const productNameCollator = new Intl.Collator("vi", { sensitivity: "accent", numeric: true });
const formatPrice = (price) => price.toLocaleString("vi-VN") + "₫";
const normalizeCatalogText = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/đ/g, "d");

const getPriceFilterError = () => {
    const minimum = catalogState.minPrice === "" ? null : Number(catalogState.minPrice);
    const maximum = catalogState.maxPrice === "" ? null : Number(catalogState.maxPrice);
    if ([minimum, maximum].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
        return "Hãy nhập mức giá hợp lệ, không nhỏ hơn 0₫.";
    }
    if (minimum !== null && maximum !== null && minimum > maximum) {
        return "Giá tối thiểu không được lớn hơn giá tối đa.";
    }
    return "";
};

const getFilteredProducts = () => {
    if (getPriceFilterError()) return [];
    const minimum = catalogState.minPrice === "" ? null : Number(catalogState.minPrice);
    const maximum = catalogState.maxPrice === "" ? null : Number(catalogState.maxPrice);
    return catalogState.products.filter((product) => {
        if (catalogState.appliedSearch) {
            const query = catalogState.appliedSearch;
            const searchableText = normalizeCatalogText(`${product.name ?? ""} ${product.description ?? ""}`);
            if (!searchableText.includes(query)) return false;
        }
        const price = Number(product.price);
        return (minimum === null || price >= minimum) && (maximum === null || price <= maximum);
    });
};

const getSortedProducts = (filteredProducts) => {
    const products = [...filteredProducts];
    if (!catalogState.sortBy) return products;

    const direction = catalogState.sortDirection === "asc" ? 1 : -1;
    return products.sort((left, right) => {
        const comparison = catalogState.sortBy === "name"
            ? productNameCollator.compare(String(left.name ?? ""), String(right.name ?? ""))
            : Number(left.price) - Number(right.price);
        return direction * comparison || Number(left.id) - Number(right.id);
    });
};

const updateSortButtons = () => {
    document.querySelectorAll("[data-catalog-sort]").forEach((button) => {
        const sortBy = button.dataset.catalogSort;
        const active = catalogState.sortBy === sortBy;
        button.setAttribute("aria-pressed", String(active));
        button.textContent = sortBy === "name"
            ? `Tên ${active && catalogState.sortDirection === "desc" ? "Z–A" : "A–Z"}`
            : `Giá ${active && catalogState.sortDirection === "desc" ? "cao đến thấp" : "thấp đến cao"}`;
    });
};

const renderProducts = () => {
    const grid = document.getElementById("product-grid");
    const resultsSummary = document.getElementById("catalog-results-summary");
    const filterError = getPriceFilterError();
    const products = getSortedProducts(getFilteredProducts());
    resultsSummary.textContent = filterError || `Hiển thị ${products.length} / ${catalogState.products.length} sản phẩm`;

    if (!products.length) {
        const message = filterError
            ? "Vui lòng kiểm tra khoảng giá."
            : catalogState.products.length
                ? "Không tìm thấy sản phẩm phù hợp."
                : "Chưa có sản phẩm nào.";
        grid.innerHTML = `<div class="catalog-empty"><h2>${message}</h2></div>`;
        return;
    }

    grid.innerHTML = products
        .map((product) => createProductCard(product, catalogState.canPurchase))
        .join("");
};

const toggleCatalogSort = (sortBy) => {
    if (catalogState.sortBy === sortBy) {
        catalogState.sortDirection = catalogState.sortDirection === "asc" ? "desc" : "asc";
    } else {
        catalogState.sortBy = sortBy;
        catalogState.sortDirection = "asc";
    }
    updateSortButtons();
    renderProducts();
};

const updateCatalogSearch = (value) => {
    const query = String(value ?? "").trim();
    const characterCount = Array.from(query).length;
    const hint = document.getElementById("catalog-search-hint");
    hint.textContent = characterCount > 0 && characterCount < 3
        ? `Nhập thêm ${3 - characterCount} ký tự để bắt đầu tìm kiếm.`
        : "";

    window.clearTimeout(catalogState.searchTimer);
    if (characterCount < 3) {
        catalogState.appliedSearch = "";
        renderProducts();
        return;
    }

    catalogState.searchTimer = window.setTimeout(() => {
        catalogState.appliedSearch = normalizeCatalogText(query);
        renderProducts();
    }, 250);
};

const bindCatalogControls = () => {
    document.querySelectorAll("[data-catalog-sort]").forEach((button) => {
        button.addEventListener("click", () => toggleCatalogSort(button.dataset.catalogSort));
    });
    document.getElementById("catalog-search").addEventListener("input", (event) => {
        updateCatalogSearch(event.currentTarget.value);
    });
    const updatePriceFilter = () => {
        catalogState.minPrice = document.getElementById("catalog-price-min").value.trim();
        catalogState.maxPrice = document.getElementById("catalog-price-max").value.trim();
        renderProducts();
    };
    document.getElementById("catalog-price-min").addEventListener("input", updatePriceFilter);
    document.getElementById("catalog-price-max").addEventListener("input", updatePriceFilter);
};


const createStockBadge = (stock) => {
    if (stock <= 0) return `<span class="product-card__badge product-card__badge--out">Hết hàng</span>`;
    if (stock <= 5) return `<span class="product-card__badge product-card__badge--low">Còn ${stock}</span>`;
    return `<span class="product-card__badge">Còn ${stock}</span>`;
};

const createProductCard = (product, canPurchase = true) => {
    const outOfStock = product.stock <= 0;
    const controls = !canPurchase
        ? `<span class="product-card__role-note">Tài khoản Admin chỉ xem catalog.</span>`
        : outOfStock
            ? `<button class="btn btn--primary" disabled style="opacity:.45;cursor:not-allowed;">Hết hàng</button>
               <button class="btn btn--secondary" disabled style="opacity:.45;cursor:not-allowed;">Thêm giỏ hàng</button>`
            : `<a href="/checkouts.html?id=${product.id}" class="btn btn--primary">Mua ngay</a>
               <button class="btn btn--secondary btn--add-cart"
                   onclick="handleAddToCart(${product.id}, '${product.name.replace(/'/g, "\\'")}', ${product.price}, ${product.stock}, this)">
                   Thêm vào giỏ
               </button>`;
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
            <div class="product-card__footer">${controls}</div>
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
        showToast(result.message || "Sản phẩm đã hết hàng!", "error");
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
        const authState = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false }));
        catalogState.canPurchase = authState.user?.role !== "admin";
        const res = await fetch("/api/products");
        const data = await res.json();
        catalogState.products = data.data;
        renderProducts();
    } catch (error) {
        document.getElementById("product-grid").innerHTML = `
        <div class="error-message">
            <h2>Không thể tải sản phẩm</h2>
            <p>Vui lòng thử lại sau.</p>
        </div>`;
    }
};

document.addEventListener("DOMContentLoaded", () => {
    bindCatalogControls();
    loadProducts();
});
