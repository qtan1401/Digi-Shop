// ===== LANDING.JS =====
// Trang chủ: dải loại sản phẩm, Sản phẩm mới, Bán chạy và mỗi loại một dải. Dữ liệu lấy một lần từ /api/landing/highlights.
(() => {
    const { renderProductCard, renderProductSkeleton, escapeHtml, renderStars, formatRating } = window.CatalogRenderer;
    const { DEVICE_TYPES, DEVICE_TYPE_LABELS } = window.CatalogTaxonomy;
    const el = (id) => document.getElementById(id);
    const categoryHref = (deviceType) => `/catalog.html?category=${encodeURIComponent(deviceType)}`;
    const productHref = (product) => `/product_info.html?id=${encodeURIComponent(product.id ?? "")}`;
    const SKELETON_COUNT = { "new-products": 8, "best-sellers": 8 };
    const SHOWCASE_SIZE = 3;

    // ===== Trưng bày đầu trang: ba sản phẩm bán chạy (thiếu thì bù bằng hàng mới), mỗi cái trên một bệ =====
    const typeLabel = (product) => product.category?.name || DEVICE_TYPE_LABELS[product.category?.slug || product.deviceType] || product.deviceType || "";
    const renderStand = (product) => {
        const href = productHref(product);
        const name = escapeHtml(product.name);
        return `<div class="landing-stand"><a href="${href}" class="landing-stand__card" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(product.image)}" alt="" loading="eager"></a><span class="landing-stand__podium" aria-hidden="true"></span><span class="landing-stand__tick" aria-hidden="true"></span><p class="landing-stand__label">${escapeHtml(typeLabel(product))}</p><p class="landing-stand__name"><a href="${href}" title="${name}">${name}</a></p></div>`;
    };
    const renderStandSkeleton = () => '<div class="landing-stand landing-stand--skeleton" aria-hidden="true"><div class="landing-stand__card skeleton"></div><span class="landing-stand__podium"></span><span class="landing-stand__tick"></span><div class="landing-stand__label skeleton"></div></div>';
    const pickShowcase = (data) => {
        const seen = new Set();
        return [...(data.bestSellers || []), ...(data.newProducts || [])].filter((product) => {
            if (!product?.image || seen.has(product.id)) return false;
            seen.add(product.id);
            return true;
        }).slice(0, SHOWCASE_SIZE);
    };
    const renderShowcase = (products) => {
        el("landing-showcase").innerHTML = products.length === SHOWCASE_SIZE ? products.map(renderStand).join("") : "";
    };

    // Điểm trung bình (theo số lượt) của các sản phẩm đang hiện trên trang chủ; không có lượt nào thì ẩn dòng này.
    const renderRating = (data) => {
        const seen = new Set();
        let sum = 0, count = 0;
        for (const product of [...(data.bestSellers || []), ...(data.newProducts || []), ...(data.categories || []).flatMap((category) => category.products || [])]) {
            const n = Number(product?.ratingCount), avg = Number(product?.ratingAverage);
            if (seen.has(product?.id) || !(n > 0) || !Number.isFinite(avg)) continue;
            seen.add(product.id);
            sum += avg * n;
            count += n;
        }
        const line = el("landing-rating");
        if (!count) { line.hidden = true; line.innerHTML = ""; return; }
        const average = Math.round((sum / count) * 10) / 10;
        line.innerHTML = `${renderStars(average)}<span><strong>${formatRating(average)}/5</strong> từ ${count.toLocaleString("vi-VN")} lượt đánh giá</span>`;
        line.hidden = false;
    };

    const renderCategoryIndex = () => {
        el("landing-categories").innerHTML = DEVICE_TYPES.map((type) => `<li><a href="${categoryHref(type)}">${escapeHtml(DEVICE_TYPE_LABELS[type])}<svg class="icon" aria-hidden="true"><use href="#i-chevron-right"/></svg></a></li>`).join("");
    };

    const renderLoading = () => {
        el("landing-error").hidden = true;
        for (const [id, count] of Object.entries(SKELETON_COUNT)) {
            const grid = el(id);
            grid.setAttribute("aria-busy", "true");
            grid.innerHTML = Array.from({ length: count }, renderProductSkeleton).join("");
            grid.closest("section").hidden = false;
        }
        el("category-strips").innerHTML = "";
        el("landing-showcase").innerHTML = Array.from({ length: SHOWCASE_SIZE }, renderStandSkeleton).join("");
        el("landing-status").textContent = "Đang tải sản phẩm";
    };

    const renderGroup = (id, products, canPurchase) => {
        const grid = el(id);
        grid.removeAttribute("aria-busy");
        grid.innerHTML = products.map((product) => renderProductCard(product, { canPurchase })).join("");
        grid.closest("section").hidden = products.length === 0;
    };

    const renderStrip = (category, canPurchase) => {
        const label = escapeHtml(category.label);
        return `<section class="landing-section" aria-label="${label}"><div class="landing-section__head"><h2>${label}</h2><a href="${categoryHref(category.deviceType)}" class="landing-section__more" aria-label="Xem tất cả ${label}">Xem tất cả</a></div><div class="landing-grid">${category.products.map((product) => renderProductCard(product, { canPurchase })).join("")}</div></section>`;
    };

    const renderHighlights = (data, canPurchase) => {
        renderGroup("new-products", data.newProducts || [], canPurchase);
        renderGroup("best-sellers", data.bestSellers || [], canPurchase);
        el("category-strips").innerHTML = (data.categories || []).map((category) => renderStrip(category, canPurchase)).join("");
        renderShowcase(pickShowcase(data));
        renderRating(data);
        el("landing-status").textContent = "";
    };

    const renderError = (network) => {
        for (const id of Object.keys(SKELETON_COUNT)) { el(id).innerHTML = ""; el(id).closest("section").hidden = true; }
        el("landing-showcase").innerHTML = "";
        el("landing-rating").hidden = true;
        el("landing-status").textContent = "";
        el("landing-error-reason").textContent = network ? "Mất kết nối mạng" : "Máy chủ chưa phản hồi";
        el("landing-error").hidden = false;
    };

    const canPurchase = async () => {
        try { const state = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false })); return state.user?.role !== "admin"; } catch (_) { return true; }
    };

    const load = async () => {
        renderLoading();
        try {
            const [response, purchasable] = await Promise.all([fetch("/api/landing/highlights"), canPurchase()]);
            if (!response.ok) throw new Error("Landing request failed");
            const result = await response.json();
            renderHighlights(result.data || {}, purchasable);
        } catch (error) {
            renderError(error instanceof TypeError);
        }
    };

    document.addEventListener("DOMContentLoaded", () => {
        renderCategoryIndex();
        document.addEventListener("click", (event) => { if (event.target.closest("[data-landing-retry]")) load(); });
        load();
    });
})();
