// ===== LANDING.JS =====
// Trang chủ: dải loại sản phẩm, Sản phẩm mới, Bán chạy và mỗi loại một dải. Dữ liệu lấy một lần từ /api/landing/highlights.
(() => {
    const { renderProductCard, renderProductSkeleton, escapeHtml } = window.CatalogRenderer;
    const { DEVICE_TYPES, DEVICE_TYPE_LABELS } = window.CatalogTaxonomy;
    const el = (id) => document.getElementById(id);
    const categoryHref = (deviceType) => `/catalog.html?category=${encodeURIComponent(deviceType)}`;
    const SKELETON_COUNT = { "new-products": 8, "best-sellers": 8 };

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
        el("landing-status").textContent = "";
    };

    const renderError = (network) => {
        for (const id of Object.keys(SKELETON_COUNT)) { el(id).innerHTML = ""; el(id).closest("section").hidden = true; }
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
