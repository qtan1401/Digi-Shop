// ===== MAIN.JS =====
// Product cards link to detail; customers must select a purchasable variant there.
const catalogState = { canPurchase: true, sortBy: "default", sortDirection: "asc", search: "", minPrice: "", maxPrice: "", categories: new Set(), tags: new Set(), page: 1, totalPages: 1, total: 0, catalogTotal: 0, controller: null, searchTimer: null };
const normalizeCatalogText = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN").replace(/đ/g, "d");
const categoryValues = ["phone", "tablet", "laptop"];
const tagValues = ["Apple", "Samsung", "MSI"];
// Chip khoảng giá: [nhãn, minPrice, maxPrice]
const priceRanges = [["Mọi mức giá", "", ""], ["Dưới 10 triệu", "", "10000000"], ["10–20 triệu", "10000000", "20000000"], ["20–30 triệu", "20000000", "30000000"], ["Trên 30 triệu", "30000000", ""]];
const getPriceFilterError = () => {
    const min = catalogState.minPrice === "" ? null : Number(catalogState.minPrice), max = catalogState.maxPrice === "" ? null : Number(catalogState.maxPrice);
    if ([min, max].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) return "Hãy nhập mức giá hợp lệ, không nhỏ hơn 0₫.";
    return min !== null && max !== null && min > max ? "Giá tối thiểu không được lớn hơn giá tối đa." : "";
};
const renderer = () => window.CatalogRenderer;
const el = (id) => document.getElementById(id);
const hasActiveFilter = () => catalogState.search !== "" || catalogState.minPrice !== "" || catalogState.maxPrice !== "" || catalogState.categories.size > 0 || catalogState.tags.size > 0;

// ----- Bộ lọc: một mẫu, vẽ hai bản (cột từ 1024px, panel trượt dưới 1024px) -----
const filterBodyHtml = (kind) => {
    const { icon, deviceTypeLabels } = renderer();
    const radio = (label, value) => `<label class="filter-option"><input type="radio" name="loai-${kind}" value="${value}" data-filter-category>${label}</label>`;
    const brand = (value) => `<label class="filter-option"><span class="filter-check"><input type="checkbox" name="hang-${kind}" value="${value}" data-filter-brand>${icon("check")}</span>${value}</label>`;
    const chips = priceRanges.map(([label], index) => `<button type="button" role="radio" aria-checked="false" data-price-chip="${index}" class="chip ${kind === "col" ? "chip--sm" : "chip--md"}${kind === "col" && index === 0 ? " chip--wide" : ""}">${label}</button>`).join("");
    const priceField = (label, key) => `<label class="price-field">${label}${kind === "col" ? " (đ)" : ""}<span class="price-field__box"><input type="text" inputmode="numeric" autocomplete="off" class="ui-input tabular${kind === "col" ? " ui-input--compact" : ""}" data-filter-price="${key}">${kind === "col" ? "" : '<span class="price-field__unit">đ</span>'}</span></label>`;
    return `<div class="filter-search"><div class="search"><svg class="icon search__icon" aria-hidden="true"><use href="#i-search"/></svg><input type="search" maxlength="120" autocomplete="off" aria-label="Tìm theo tên" placeholder="Tìm theo tên" class="ui-input search__input" data-filter-search><button type="button" class="search__clear" aria-label="Xoá từ khoá" data-filter-search-clear hidden>${icon("x")}</button></div><p class="filter-hint" data-filter-search-hint aria-live="polite"></p></div>`
        + `<fieldset><legend>Loại</legend>${radio("Tất cả", "")}${categoryValues.map((value) => radio(deviceTypeLabels[value], value)).join("")}</fieldset>`
        + `<fieldset><legend>Hãng</legend>${tagValues.map(brand).join("")}</fieldset>`
        + `<fieldset><legend class="legend--chips">Khoảng giá</legend><div role="radiogroup" aria-label="Khoảng giá có sẵn" class="chips chips--${kind}">${chips}</div><div class="price-fields">${priceField("Từ", "min")}${priceField("Đến", "max")}</div><p class="filter-error" role="alert" data-filter-price-error></p></fieldset>`;
};
const renderFilterControls = () => document.querySelectorAll("[data-filter-host]").forEach((host) => { host.innerHTML = filterBodyHtml(host.dataset.filterHost); });
const syncCatalogControls = () => {
    const active = document.activeElement, count = Array.from(catalogState.search.trim()).length, priceError = getPriceFilterError();
    document.querySelectorAll("[data-filter-search]").forEach((input) => { if (input !== active && input.value !== catalogState.search) input.value = catalogState.search; });
    document.querySelectorAll("[data-filter-search-clear]").forEach((button) => { button.hidden = catalogState.search === ""; });
    document.querySelectorAll("[data-filter-search-hint]").forEach((hint) => { hint.textContent = count > 0 && count < 3 ? `Nhập thêm ${3 - count} ký tự để bắt đầu tìm kiếm.` : ""; });
    document.querySelectorAll("[data-filter-price]").forEach((input) => {
        const value = input.dataset.filterPrice === "min" ? catalogState.minPrice : catalogState.maxPrice;
        if (input !== active && input.value !== value) input.value = value;
        input.toggleAttribute("aria-invalid", Boolean(priceError));
    });
    document.querySelectorAll("[data-filter-price-error]").forEach((node) => { node.textContent = priceError; });
    document.querySelectorAll("[data-price-chip]").forEach((chip) => { const [, min, max] = priceRanges[Number(chip.dataset.priceChip)]; chip.setAttribute("aria-checked", String(catalogState.minPrice === min && catalogState.maxPrice === max)); });
    document.querySelectorAll("[data-filter-category]").forEach((input) => { input.checked = input.value === "" ? catalogState.categories.size === 0 : catalogState.categories.size === 1 && catalogState.categories.has(input.value); });
    document.querySelectorAll("[data-filter-brand]").forEach((input) => { input.checked = catalogState.tags.has(input.value); });
    document.querySelectorAll("[data-filter-clear]").forEach((button) => { button.disabled = !hasActiveFilter(); });
    updateSortButtons();
};

// ----- Sắp xếp -----
const sortLabel = (sort, desc) => sort === "name" ? `Tên ${desc ? "Z–A" : "A–Z"}` : `Giá ${desc ? "cao đến thấp" : "thấp đến cao"}`;
const updateSortButtons = () => {
    document.querySelectorAll("[data-catalog-sort]").forEach((button) => {
        const active = catalogState.sortBy === button.dataset.catalogSort;
        button.querySelector("span").textContent = sortLabel(button.dataset.catalogSort, active && catalogState.sortDirection === "desc");
        button.closest("[role=option]").setAttribute("aria-selected", String(active));
        button.classList.toggle("is-selected", active);
    });
    const label = document.querySelector("[data-sort-label]");
    if (label) label.textContent = catalogState.sortBy === "default" ? "Mặc định" : sortLabel(catalogState.sortBy, catalogState.sortDirection === "desc");
};
const parseLocationState = () => {
    const url = new URL(window.location.href), categoryPath = url.pathname.match(/^\/danh-muc\/(phone|tablet|laptop)\/?$/i), tagPath = url.pathname.match(/^\/the\/(apple|samsung|msi)\/?$/i);
    catalogState.categories = new Set(url.searchParams.getAll("category").filter((value) => categoryValues.includes(value)));
    catalogState.tags = new Set(url.searchParams.getAll("tag").filter((value) => tagValues.includes(value)));
    if (categoryPath) catalogState.categories.add(categoryPath[1].toLowerCase());
    if (tagPath) catalogState.tags.add(tagValues.find((tag) => tag.toLowerCase() === tagPath[1].toLowerCase()));
    catalogState.page = Math.max(1, Number.parseInt(url.searchParams.get("page"), 10) || 1);
    catalogState.search = url.searchParams.get("q") || "";
    catalogState.minPrice = url.searchParams.get("minPrice") || ""; catalogState.maxPrice = url.searchParams.get("maxPrice") || "";
    const sort = url.searchParams.get("sort"); catalogState.sortBy = ["name", "price"].includes(sort) ? sort : "default";
    catalogState.sortDirection = url.searchParams.get("order") === "desc" ? "desc" : "asc";
    syncCatalogControls();
};
const buildCatalogUrl = (page = catalogState.page) => {
    const url = new URL(window.location.href), params = url.searchParams;
    ["page", "q", "sort", "order", "minPrice", "maxPrice", "category", "tag"].forEach((key) => params.delete(key));
    const categories = [...catalogState.categories], tags = [...catalogState.tags];
    const categoryPath = categories.length === 1 && tags.length <= 1, tagPath = categories.length === 0 && tags.length === 1;
    url.pathname = categoryPath ? `/danh-muc/${categories[0]}` : tagPath ? `/the/${tags[0].toLowerCase()}` : "/";
    if (page > 1) params.set("page", String(page));
    if (catalogState.search.trim().length >= 3) params.set("q", catalogState.search.trim());
    if (catalogState.sortBy !== "default") { params.set("sort", catalogState.sortBy); params.set("order", catalogState.sortDirection); }
    if (catalogState.minPrice !== "") params.set("minPrice", catalogState.minPrice);
    if (catalogState.maxPrice !== "") params.set("maxPrice", catalogState.maxPrice);
    if (!categoryPath) categories.forEach((value) => params.append("category", value));
    if (!tagPath) tags.forEach((value) => params.append("tag", value));
    return url.pathname + url.search;
};
const syncUrl = (replace = false) => window.history[replace ? "replaceState" : "pushState"]({}, "", buildCatalogUrl());

// ----- Vẽ danh sách: đang tải / có dữ liệu / rỗng / lỗi -----
const setApplyLabel = () => document.querySelectorAll("[data-filter-apply]").forEach((button) => { button.textContent = `Xem ${catalogState.total.toLocaleString("vi-VN")} sản phẩm`; });
const setGridMessage = (html) => { const grid = el("product-grid"); grid.classList.add("product-grid--message"); grid.removeAttribute("aria-busy"); grid.innerHTML = html; el("catalog-pagination").innerHTML = ""; };
const renderLoading = () => {
    const grid = el("product-grid");
    grid.classList.remove("product-grid--message"); grid.setAttribute("aria-busy", "true");
    grid.innerHTML = Array.from({ length: 12 }, renderer().renderProductSkeleton).join("");
    el("catalog-count").innerHTML = '<span class="skeleton skeleton--count"></span>';
    el("catalog-pagination").innerHTML = ""; el("catalog-status").textContent = "Đang tải danh sách sản phẩm";
};
const renderEmpty = (error) => {
    const { escapeHtml } = renderer(), query = catalogState.search.trim();
    el("catalog-count").textContent = "0 sản phẩm"; el("catalog-status").textContent = ""; setApplyLabel();
    if (error) return setGridMessage(`<p class="catalog-empty">Vui lòng kiểm tra khoảng giá.</p>`);
    if (!catalogState.catalogTotal && !hasActiveFilter()) return setGridMessage('<p class="catalog-empty">Chưa có sản phẩm nào.</p>');
    if (query.length >= 3) return setGridMessage(`<p class="catalog-empty">Không có sản phẩm nào khớp <span>“${escapeHtml(query)}”</span>. Thử từ khoá khác. <button type="button" class="link-btn" data-catalog-clear-search>Xoá tìm kiếm</button></p>`);
    setGridMessage(`<p class="catalog-empty">Không có sản phẩm nào khớp bộ lọc. <button type="button" class="link-btn" data-filter-clear>Xoá lọc</button></p>`);
};
const renderError = (network) => {
    const { icon } = renderer();
    el("catalog-count").textContent = ""; el("catalog-status").textContent = "";
    setGridMessage(`<div role="alert" class="catalog-error"><div><p class="catalog-error__title">Không tải được danh sách sản phẩm</p><p class="catalog-error__reason">${network ? "Mất kết nối mạng" : "Máy chủ chưa phản hồi"}</p></div><button type="button" class="ui-btn ui-btn--outline" data-catalog-retry>${icon("rotate-cw")}Thử lại</button></div>`);
};
const renderProducts = (products) => {
    const grid = el("product-grid"), error = getPriceFilterError();
    syncCatalogControls();
    if (!products.length) return renderEmpty(error);
    grid.classList.remove("product-grid--message"); grid.removeAttribute("aria-busy");
    grid.innerHTML = products.map((product) => renderer().renderProductCard(product, { canPurchase: catalogState.canPurchase })).join("");
    el("catalog-count").textContent = `${catalogState.total.toLocaleString("vi-VN")} sản phẩm`; el("catalog-status").textContent = ""; setApplyLabel();
    el("catalog-pagination").innerHTML = renderer().renderPagination({ page: catalogState.page, totalPages: catalogState.totalPages, total: catalogState.total, pageSize: 12, ariaLabel: "Phân trang", hrefForPage: (page) => buildCatalogUrl(page) });
};
let requestSequence = 0;
const loadProducts = async () => {
    if (getPriceFilterError()) { catalogState.total = 0; catalogState.totalPages = 1; renderProducts([]); return; }
    if (catalogState.controller) catalogState.controller.abort();
    const controller = new AbortController(); catalogState.controller = controller; const sequence = ++requestSequence;
    const url = new URL("/api/products", window.location.origin), params = url.searchParams;
    params.set("page", String(catalogState.page)); params.set("pageSize", "12");
    if (catalogState.search.trim()) params.set("q", catalogState.search.trim());
    catalogState.categories.forEach((value) => params.append("category", value)); catalogState.tags.forEach((value) => params.append("tag", value));
    if (catalogState.minPrice !== "") params.set("minPrice", catalogState.minPrice); if (catalogState.maxPrice !== "") params.set("maxPrice", catalogState.maxPrice);
    if (catalogState.sortBy !== "default") params.set("sort", catalogState.sortBy);
    params.set("order", catalogState.sortDirection);
    renderLoading();
    try {
        const response = await fetch(url.pathname + url.search, { signal: controller.signal }); if (!response.ok) throw new Error("Catalog request failed");
        const result = await response.json(); if (sequence !== requestSequence) return;
        catalogState.page = Number(result.meta.page) || 1; catalogState.totalPages = Number(result.meta.totalPages) || 1; catalogState.total = Number(result.meta.total) || 0; catalogState.catalogTotal = Number(result.meta.catalogTotal) || 0;
        syncUrl(true); renderProducts(result.data || []);
    } catch (error) { if (error.name === "AbortError" || sequence !== requestSequence) return; renderError(error instanceof TypeError); }
};
const changeCatalog = (delay = 0) => { catalogState.page = 1; if (catalogState.controller) catalogState.controller.abort(); syncUrl(); window.clearTimeout(catalogState.searchTimer); catalogState.searchTimer = window.setTimeout(loadProducts, delay); };
const clearAllFilters = () => { catalogState.search = ""; catalogState.minPrice = ""; catalogState.maxPrice = ""; catalogState.categories = new Set(); catalogState.tags = new Set(); syncCatalogControls(); changeCatalog(); };

// ----- Lớp nổi: dropdown sắp xếp, panel lọc -----
const setupSortMenu = () => {
    const root = document.querySelector("[data-sort]"), trigger = root.querySelector("[data-sort-trigger]"), options = [...root.querySelectorAll("[data-sort-option]")];
    const isOpen = () => root.hasAttribute("data-open");
    const close = (focus = false) => { root.removeAttribute("data-open"); trigger.setAttribute("aria-expanded", "false"); if (focus) trigger.focus(); };
    const open = () => { root.setAttribute("data-open", ""); trigger.setAttribute("aria-expanded", "true"); (options.find((option) => option.classList.contains("is-selected")) || options[0]).focus(); };
    trigger.addEventListener("click", () => (isOpen() ? close() : open()));
    trigger.addEventListener("keydown", (event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); if (!isOpen()) open(); } });
    root.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isOpen()) { event.preventDefault(); close(true); }
        if (["ArrowDown", "ArrowUp"].includes(event.key) && options.includes(document.activeElement)) { event.preventDefault(); const next = options.indexOf(document.activeElement) + (event.key === "ArrowDown" ? 1 : -1); options[(next + options.length) % options.length].focus(); }
        if (event.key === "Tab" && isOpen()) close();
    });
    document.addEventListener("click", (event) => { if (isOpen() && !root.contains(event.target)) close(); });
    options.forEach((button) => button.addEventListener("click", () => {
        const sort = button.dataset.catalogSort;
        if (catalogState.sortBy === sort) catalogState.sortDirection = catalogState.sortDirection === "asc" ? "desc" : "asc"; else { catalogState.sortBy = sort; catalogState.sortDirection = "asc"; }
        updateSortButtons(); changeCatalog(); close(true);
    }));
};
const setupFilterPanel = () => {
    const panel = document.querySelector("[data-filter-panel]"), opener = document.querySelector("[data-filter-open]"), sheet = panel.querySelector(".filter-panel__sheet"), wide = window.matchMedia("(min-width: 1024px)");
    const close = (focus = true) => { if (!panel.hasAttribute("data-open")) return; panel.removeAttribute("data-open"); opener.setAttribute("aria-expanded", "false"); document.documentElement.classList.remove("is-locked"); if (focus) opener.focus(); };
    const open = () => { panel.setAttribute("data-open", ""); opener.setAttribute("aria-expanded", "true"); document.documentElement.classList.add("is-locked"); sheet.querySelector(".icon-btn").focus(); };
    opener.addEventListener("click", open);
    panel.addEventListener("click", (event) => { if (event.target.closest("[data-filter-close]")) close(); });
    document.addEventListener("keydown", (event) => {
        if (!panel.hasAttribute("data-open")) return;
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Tab") {
            const focusable = [...sheet.querySelectorAll("button:not([disabled]), input:not([disabled]), [href]")].filter((node) => !node.hidden && node.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    wide.addEventListener("change", () => { if (wide.matches) close(false); });
};

const bindCatalogControls = () => {
    document.addEventListener("input", (event) => {
        const target = event.target;
        if (target.matches("[data-filter-search]")) {
            catalogState.search = target.value; const count = Array.from(catalogState.search.trim()).length; syncCatalogControls(); changeCatalog(count >= 3 ? 250 : 0);
        } else if (target.matches("[data-filter-price]")) {
            const value = target.value.trim();
            if (target.dataset.filterPrice === "min") catalogState.minPrice = value; else catalogState.maxPrice = value;
            syncCatalogControls(); changeCatalog();
        }
    });
    document.addEventListener("change", (event) => {
        const target = event.target;
        if (target.matches("[data-filter-category]")) { catalogState.categories = target.value ? new Set([target.value]) : new Set(); }
        else if (target.matches("[data-filter-brand]")) { target.checked ? catalogState.tags.add(target.value) : catalogState.tags.delete(target.value); }
        else return;
        syncCatalogControls(); changeCatalog();
    });
    document.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-price-chip]");
        if (chip) { const [, min, max] = priceRanges[Number(chip.dataset.priceChip)]; catalogState.minPrice = min; catalogState.maxPrice = max; syncCatalogControls(); changeCatalog(); return; }
        const clearSearch = event.target.closest("[data-filter-search-clear], [data-catalog-clear-search]");
        if (clearSearch) { catalogState.search = ""; syncCatalogControls(); changeCatalog(); document.querySelector("[data-filter-search]")?.focus({ preventScroll: true }); return; }
        if (event.target.closest("[data-filter-clear]")) { clearAllFilters(); return; }
        if (event.target.closest("[data-catalog-retry]")) { loadProducts(); }
    });
    el("catalog-pagination").addEventListener("click", (event) => { const link = event.target.closest("a[href]"); if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); const next = new URL(link.href); history.pushState({}, "", next.pathname + next.search); parseLocationState(); loadProducts(); });
    setupSortMenu(); setupFilterPanel();
};
document.addEventListener("DOMContentLoaded", async () => {
    renderFilterControls(); bindCatalogControls(); parseLocationState();
    try { const authState = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false })); catalogState.canPurchase = authState.user?.role !== "admin"; } catch (_) { catalogState.canPurchase = true; }
    window.addEventListener("popstate", () => { if (catalogState.controller) catalogState.controller.abort(); parseLocationState(); loadProducts(); });
    loadProducts();
});
