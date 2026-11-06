(function (root, factory) {
    const renderer = factory();
    if (typeof module === "object" && module.exports) module.exports = renderer;
    if (root) root.CatalogRenderer = renderer;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
    "use strict";
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const formatPrice = (value) => Number(value || 0).toLocaleString("vi-VN") + "₫";
    const deviceTypeLabels = { phone: "Điện thoại", tablet: "Máy tính bảng", laptop: "Laptop" };
    const icon = (name, cls = "") => `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
    // 7,99 – 9,99 tr (dưới 1 triệu thì ghi đủ bằng ₫)
    const millions = (value) => (Number(value) / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
    const formatPriceRange = (min, max) => {
        const low = Number(min) || 0, high = Number(max) || 0;
        if (Math.max(low, high) < 1e6) return low === high ? formatPrice(low) : `${formatPrice(low)} – ${formatPrice(high)}`;
        return low === high ? `${millions(low)} tr` : `${millions(low)} – ${millions(high)} tr`;
    };
    const stockBadge = (stock) => {
        if (stock <= 0) return '<span class="stock-badge stock-badge--out"><span class="stock-badge__dot"></span>Hết hàng</span>';
        if (stock <= 5) return `<span class="stock-badge stock-badge--low"><span class="stock-badge__dot"></span>Chỉ còn ${stock}</span>`;
        return "";
    };
    // ===== Đánh giá sao (ratingAverage 1 chữ số thập phân hoặc null, ratingCount) =====
    const formatRating = (value) => Number(value).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const compactCount = (value) => { const n = Number(value) || 0; return n >= 1000 ? `${(n / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}k` : String(n); };
    const STAR_POINTS = "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2";
    const starIcon = (cls = "") => `<svg class="icon icon--fill${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="${STAR_POINTS}"/></svg>`;
    const hasRating = (product) => Number(product?.ratingCount) > 0 && Number.isFinite(Number(product?.ratingAverage));
    // Năm sao tô theo điểm: lớp trên cắt theo % (điểm / 5). Trang trí: số liệu nằm ở văn bản kèm theo.
    const renderStars = (average, cls = "") => {
        const percent = Math.max(0, Math.min(100, Math.round((Number(average) || 0) / 5 * 100)));
        const five = starIcon().repeat(5);
        return `<span class="stars${cls ? " " + cls : ""}" aria-hidden="true"><span class="stars__base">${five}</span><span class="stars__fill" style="width:${percent}%"><span class="stars__row">${five}</span></span></span>`;
    };
    const ratingLabel = (average, count) => `Đánh giá ${formatRating(average)} trên 5, ${Number(count).toLocaleString("vi-VN")} lượt`;
    // Dòng "N phiên bản" + điểm sao bên phải; không có điểm thì chỉ còn số phiên bản.
    const renderCardMeta = (variantCount, product) => {
        if (!variantCount && !hasRating(product)) return "";
        const variants = variantCount ? `<p class="product-card__variants">${variantCount} phiên bản</p>` : "";
        const rating = hasRating(product)
            ? `<span class="product-card__rating" role="img" aria-label="${escapeHtml(ratingLabel(product.ratingAverage, product.ratingCount))}">${starIcon("product-card__star")}<span class="product-card__rating-score">${formatRating(product.ratingAverage)}</span>(${compactCount(product.ratingCount)})</span>`
            : "";
        return `<div class="product-card__meta">${variants}${rating}</div>`;
    };
    const renderProductCard = (product, options = {}) => {
        const href = `/product_info.html?id=${encodeURIComponent(product.id ?? "")}`;
        const stock = Number(product.stock) || 0;
        const badge = stockBadge(stock);
        const variantCount = Number(product.variantCount) || 0;
        const typeLabel = deviceTypeLabels[product.deviceType] || product.deviceType;
        const action = options.canPurchase === false ? '<span class="product-card__role-note">Tài khoản Admin chỉ xem catalog.</span>' : `<a href="${href}" class="ui-btn ui-btn--outline ui-btn--card">Chọn phiên bản</a>`;
        return `<article class="product-card"><div class="product-card__media"><a href="${href}" tabindex="-1" aria-hidden="true" class="product-card__image-link"><img src="${escapeHtml(product.image)}" alt="" class="product-card__image${stock <= 0 ? " product-card__image--out" : ""}"></a>${badge ? `<span class="product-card__badge">${badge}</span>` : ""}</div><div class="product-card__body"><p class="product-card__metadata">${escapeHtml(product.brand)} · ${escapeHtml(typeLabel)}</p><h3 class="product-card__name"><a href="${href}" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</a></h3><p class="product-card__price">${formatPriceRange(product.price, product.priceMax)}</p>${renderCardMeta(variantCount, product)}</div>${action}</article>`;
    };
    const skeletonBar = (cls) => `<div class="skeleton ${cls}"></div>`;
    const renderProductSkeleton = () => `<div class="product-card product-card--skeleton"><div class="skeleton product-card__image-link"></div><div class="product-card__body"><div class="skeleton-row skeleton-row--16">${skeletonBar("skeleton--w-1-3")}</div><div class="skeleton-row skeleton-row--name">${skeletonBar("skeleton--w-5-6")}${skeletonBar("skeleton--w-2-3")}</div><div class="skeleton-row skeleton-row--24">${skeletonBar("skeleton--w-1-2")}</div><div class="skeleton-row skeleton-row--16">${skeletonBar("skeleton--w-1-4")}</div></div><div class="skeleton product-card__action-skeleton"></div></div>`;
    const renderPagination = ({ page, totalPages, hrefForPage, ariaLabel = "Phân trang", total, pageSize, noun = "sản phẩm" } = {}) => {
        const pagesCount = Math.max(1, Math.min(1000000, Math.floor(Number(totalPages) || 1)));
        const current = Math.max(1, Math.min(pagesCount, Math.floor(Number(page) || 1)));
        const href = (number) => escapeHtml(typeof hrefForPage === "function" ? hrefForPage(number) : `?page=${number}`);
        const item = (number) => number === current ? `<span class="catalog-pagination__item" aria-current="page">${number}</span>` : `<a class="catalog-pagination__item" href="${href(number)}" aria-label="Trang ${number}">${number}</a>`;
        const previousLink = current === 1 ? `<span class="catalog-pagination__arrow" aria-label="Trang trước" aria-disabled="true">${icon("chevron-left")}</span>` : `<a class="catalog-pagination__arrow" href="${href(current - 1)}" aria-label="Trang trước">${icon("chevron-left")}</a>`;
        const nextLink = current === pagesCount ? `<span class="catalog-pagination__arrow" aria-label="Trang sau" aria-disabled="true">${icon("chevron-right")}</span>` : `<a class="catalog-pagination__arrow" href="${href(current + 1)}" aria-label="Trang sau">${icon("chevron-right")}</a>`;
        const included = new Set([1, pagesCount, current - 1, current, current + 1]);
        const pages = [...included].filter((number) => number >= 1 && number <= pagesCount).sort((a, b) => a - b);
        const numbers = [];
        let previous = 0;
        for (const number of pages) { if (previous && number - previous > 1) numbers.push('<span class="catalog-pagination__ellipsis" aria-hidden="true">…</span>'); numbers.push(item(number)); previous = number; }
        const size = Math.max(1, Math.floor(Number(pageSize) || 12)), count = Math.max(0, Math.floor(Number(total)));
        const summary = Number.isFinite(count) && total !== undefined && total !== null ? `<p class="catalog-pagination__count"><span class="catalog-pagination__range">${count ? (current - 1) * size + 1 : 0} tới ${Math.min(current * size, count)} trong </span>${count.toLocaleString("vi-VN")} ${escapeHtml(noun)}</p>` : "";
        return `${summary}<nav class="catalog-pagination__links" aria-label="${escapeHtml(ariaLabel)}">${previousLink}<span class="catalog-pagination__pages">${numbers.join("")}</span><span class="catalog-pagination__compact">${current} / ${pagesCount}</span>${nextLink}</nav>`;
    };
    return { renderProductCard, renderProductSkeleton, renderPagination, deviceTypeLabels, escapeHtml, icon, renderStars, starIcon, formatRating, compactCount, ratingLabel };
});
