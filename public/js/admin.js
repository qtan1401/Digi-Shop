/* ===== ADMIN CATALOG DASHBOARD ===== */
(() => {
    "use strict";

    const state = {
        status: "active",
        q: "",
        page: 1,
        total: 0,
        totalPages: 1,
        products: [],
        variantSource: [],
        storages: [],
        busy: false,
        searchTimer: null,
        confirmAction: null,
        lastFocus: null
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const productRegion = $("#product-table-region");
    const productSummary = $("#table-summary");
    const PAGE_SIZE = 10;

    const escapeHtml = (value) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const formatPrice = (value) => Number(value || 0).toLocaleString("vi-VN") + " ₫";
    const formatDate = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value)) : "—";
    const formatDateTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

    const COLOR_PRESETS = [
        { name: "Đen", hex: "#1C1C1E" },
        { name: "Trắng", hex: "#F5F5F0" },
        { name: "Bạc", hex: "#E3E4E6" },
        { name: "Vàng", hex: "#F0E0C5" },
        { name: "Hồng", hex: "#F2C9CF" },
        { name: "Đỏ", hex: "#A8322A" },
        { name: "Xanh dương", hex: "#3A5A98" },
        { name: "Xanh lá", hex: "#5C7F5A" },
        { name: "Tím", hex: "#867AA0" },
        { name: "Titan Tự nhiên", hex: "#8E8C85" },
        { name: "Titan Sa mạc", hex: "#CDB997" },
        { name: "Titan Đen", hex: "#4A4845" },
        { name: "Titan Trắng", hex: "#D7D3C9" },
        { name: "Midnight", hex: "#1B1B20" },
        { name: "Starlight", hex: "#F0EADA" },
        { name: "Space Gray", hex: "#5F5F5F" },
        { name: "Graphite", hex: "#54524F" }
    ];
    const STORAGE_PRESETS = ["64GB", "128GB", "256GB", "512GB", "1TB", "2TB"];

    const encodeColorImageField = (value) => {
        const bytes = new TextEncoder().encode(String(value));
        let binary = "";
        bytes.forEach((b) => { binary += String.fromCharCode(b); });
        const base64 = btoa(binary);
        return `colorImage::${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    };

    const removeDiacritics = (value) => String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");

    const slugifyForSku = (value) => removeDiacritics(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    const buildSuggestedSku = (optionValues = {}) => {
        const base = slugifyForSku($("#product-name").value) || "SKU";
        const parts = [base];
        const colorValue = optionValues["Màu sắc"];
        if (colorValue) {
            const letters = removeDiacritics(colorValue).toUpperCase().replace(/[^A-Z]/g, "");
            parts.push(letters.slice(0, 3) || "MAU");
        }
        const storageValue = optionValues["Bộ nhớ"];
        if (storageValue) {
            parts.push(slugifyForSku(storageValue) || "PB");
        }
        return parts.join("-");
    };

    const api = async (url, options = {}) => {
        if (!window.DigiAuth || typeof window.DigiAuth.api !== "function") throw new Error("Phiên xác thực chưa sẵn sàng.");
        try {
            return await window.DigiAuth.api(url, options);
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                const redirect = error.code === "PASSWORD_CHANGE_REQUIRED" ? "/profile.html?force=1" : `/403.html?context=admin`;
                window.location.assign(redirect);
            }
            throw error;
        }
    };

    const showToast = (message, type = "success") => {
        const toast = document.createElement("div");
        toast.className = `admin-toast admin-toast--${type}`;
        toast.innerHTML = `<span aria-hidden="true">${type === "success" ? "✓" : type === "error" ? "!" : "i"}</span><p>${escapeHtml(message)}</p>`;
        $("#toast-container").appendChild(toast);
        requestAnimationFrame(() => toast.classList.add("is-visible"));
        window.setTimeout(() => {
            toast.classList.remove("is-visible");
            window.setTimeout(() => toast.remove(), 220);
        }, 4200);
    };

    /* ----- Cầu nối cho khung (admin-shell.js), Tổng quan và Đơn hàng ----- */
    const AVATAR_TONES = ["emerald", "sky", "indigo", "pink", "amber", "violet"];
    const avatarTone = (seed) => {
        let hash = 0;
        for (const character of String(seed || "")) hash = (hash * 31 + character.charCodeAt(0)) | 0;
        return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
    };
    const initials = (name) => {
        const text = String(name || "").trim();
        const parts = text.split(/[._\-\s@]+/).filter(Boolean);
        const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : text.slice(0, 2);
        return letters.toLocaleUpperCase("vi") || "AD";
    };
    const avatarHtml = (name) => `<span class="avatar avatar--${avatarTone(name)}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
    const paintAvatar = (element, name) => {
        element.className = `avatar avatar--${avatarTone(name)}`;
        element.textContent = initials(name);
    };
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    window.AdminUI = { api, toast: showToast, escapeHtml, ready, view: null, avatarHtml, paintAvatar, initials };

    const setFeedback = (message, type = "error") => {
        const element = $("#global-feedback");
        element.className = `admin-feedback admin-feedback--${type}`;
        element.textContent = message;
        element.hidden = !message;
    };


    const productFoot = () => productSummary.closest(".pd-foot");
    const formatInt = (value) => Number(value || 0).toLocaleString("vi-VN");

    const renderTableLoading = () => {
        const foot = productFoot();
        if (foot) foot.hidden = false;
        productSummary.textContent = "Đang tải sản phẩm…";
        $("#product-pagination").innerHTML = "";
        productRegion.innerHTML = `<div class="skeleton-table" aria-label="Đang tải sản phẩm"><span></span><span></span><span></span><span></span></div>`;
    };

    const renderTableState = (type, message, actionLabel = "", action = "retry") => {
        productRegion.innerHTML = `<div class="table-state table-state--${type}"><p>${escapeHtml(message)}</p>${actionLabel ? `<button type="button" class="ab ab--outline" id="table-state-action" data-state-action="${action}">${escapeHtml(actionLabel)}</button>` : ""}</div>`;
    };

    const stockCell = (stock) => {
        const value = Number(stock);
        if (value <= 0) return `<span class="badge badge--error"><span class="badge__dot"></span>Hết hàng</span>`;
        if (value <= 5) return `<span class="badge badge--warning"><span class="badge__dot"></span>Còn ${formatInt(value)}</span>`;
        return `<span class="tabular">${formatInt(value)}</span>`;
    };

    const renderProducts = () => {
        const products = state.products;
        const foot = productFoot();
        if (!products.length) {
            productSummary.textContent = "";
            if (foot) foot.hidden = true;
            $("#product-pagination").innerHTML = "";
            renderTableState("empty", state.q
                ? "Không tìm thấy sản phẩm nào khớp với từ khóa. Thử tìm kiếm theo tên khác hoặc đặt lại bộ lọc."
                : state.status === "deleted" ? "Thùng rác trống. Không có sản phẩm nào bị xóa." : "Chưa có sản phẩm nào", state.q ? "Đặt lại bộ lọc" : state.status === "deleted" ? "" : "Thêm sản phẩm ngay", state.q ? "reset" : "add");
            return;
        }
        if (foot) foot.hidden = false;
        const first = (state.page - 1) * PAGE_SIZE + 1;
        const last = first + products.length - 1;
        productSummary.innerHTML = `<span class="pg-range">${formatInt(first)} tới ${formatInt(last)} trong </span>${formatInt(state.total)} sản phẩm`;
        productRegion.innerHTML = `<table class="product-table"><caption class="sr-only">Danh sách sản phẩm</caption><thead><tr>
            <th scope="col">Sản phẩm</th><th scope="col">Phiên bản</th><th scope="col">Thương hiệu</th><th scope="col">Khoảng giá</th><th scope="col">Tồn kho tổng</th>${state.status === "deleted" ? "<th scope=\"col\">Ngày xóa</th>" : ""}<th scope="col"><span class="sr-only">Thao tác</span></th>
        </tr></thead><tbody>${products.map((product) => {
            const deleted = Boolean(product.isDeleted);
            return `<tr class="${deleted ? "is-deleted" : ""}">
                <td><div class="product-cell"><img src="${escapeHtml(product.image || "")}" alt="" loading="lazy" onerror="this.classList.add('is-broken')"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || "")}</small></div></div></td>
                <td><span class="variant-count">${escapeHtml(product.variantCount || 0)} phiên bản</span></td>
                <td class="brand-cell"><span>${escapeHtml(product.brand)}</span><small>${escapeHtml(product.deviceType)}</small></td>
                <td class="price-cell">${Number(product.price) === Number(product.priceMax) ? formatPrice(product.price) : `${formatPrice(product.price)} – ${formatPrice(product.priceMax)}`}</td>
                <td>${stockCell(product.stock)}</td>
                ${state.status === "deleted" ? `<td class="date-cell">${formatDate(product.deletedAt)}</td>` : ""}
                <td class="row-actions">${deleted ? `<button type="button" class="ab ab--outline ab--sm" data-restore-product="${escapeHtml(product.id)}">Khôi phục</button>` : `<button type="button" class="ab ab--ghost ab--sm" data-edit-product="${escapeHtml(product.id)}">Sửa</button><button type="button" class="ab ab--danger ab--sm" data-delete-product="${escapeHtml(product.id)}">Xóa</button>`}</td>
            </tr>`;
        }).join("")}</tbody></table>`;
        renderPagination();
    };

    // Giữ nguyên hash (#/san-pham) khi cập nhật query: URL(window.location.href) mang theo hash.
    const updateUrl = (replace = false) => {
        const url = new URL(window.location.href);
        url.searchParams.set("status", state.status);
        if (state.q) url.searchParams.set("q", state.q); else url.searchParams.delete("q");
        if (state.page > 1) url.searchParams.set("page", state.page); else url.searchParams.delete("page");
        window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    };
    // Rời màn Sản phẩm thì bỏ query của nó khỏi URL (state vẫn nằm trong bộ nhớ).
    const clearProductQuery = () => {
        const url = new URL(window.location.href);
        if (!["status", "q", "page"].some((key) => url.searchParams.has(key))) return;
        ["status", "q", "page"].forEach((key) => url.searchParams.delete(key));
        window.history.replaceState(window.history.state, "", url);
    };
    const navigateToPage = (page) => {
        state.page = page;
        updateUrl();
        loadProducts();
    };

    const ICON_CHEVRON = (direction) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}"/></svg>`;
    const pageWindow = (current, total) => {
        if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
        if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
        if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
        return [1, "…", current - 1, current, current + 1, "…", total];
    };
    const pageHref = (page) => {
        const url = new URL(window.location.href);
        url.searchParams.set("status", state.status);
        if (state.q) url.searchParams.set("q", state.q); else url.searchParams.delete("q");
        if (page > 1) url.searchParams.set("page", page); else url.searchParams.delete("page");
        return `${url.pathname}${url.search}${url.hash}`;
    };

    const renderPagination = () => {
        const holder = $("#product-pagination");
        const total = state.totalPages;
        const current = state.page;
        if (total <= 1) { holder.innerHTML = ""; return; }
        const arrow = (label, page, direction, disabled) => disabled
            ? `<span class="pg__item pg__arrow" aria-label="${label}" aria-disabled="true">${ICON_CHEVRON(direction)}</span>`
            : `<a class="pg__item pg__arrow" href="${escapeHtml(pageHref(page))}" aria-label="${label}">${ICON_CHEVRON(direction)}</a>`;
        const pages = pageWindow(current, total).map((item) => {
            if (item === "…") return `<span class="pg__ellipsis" aria-hidden="true">…</span>`;
            return item === current
                ? `<span class="pg__item" aria-current="page">${item}</span>`
                : `<a class="pg__item" href="${escapeHtml(pageHref(item))}" aria-label="Trang ${item}">${item}</a>`;
        }).join("");
        holder.innerHTML = `<nav class="pg" aria-label="Phân trang sản phẩm">${arrow("Trang trước", current - 1, "left", current <= 1)}<span class="pg__pages">${pages}</span><span class="pg__compact tabular">${current} / ${total}</span>${arrow("Trang sau", current + 1, "right", current >= total)}</nav>`;
        holder.querySelectorAll("a").forEach((link) => link.addEventListener("click", (event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigateToPage(Number(new URL(link.href).searchParams.get("page") || 1));
        }));
    };

    const renderCounts = async () => {
        try {
            const [active, deleted] = await Promise.all([
                api("/api/admin/products?status=active&page=1&pageSize=1"),
                api("/api/admin/products?status=deleted&page=1&pageSize=1")
            ]);
            $("#active-count").textContent = Number(active.meta?.total ?? active.total ?? 0);
            $("#deleted-count").textContent = Number(deleted.meta?.total ?? deleted.total ?? 0);
        } catch (_) {
            $("#active-count").textContent = "—";
            $("#deleted-count").textContent = "—";
        }
    };

    const loadProducts = async ({ updateHistory = false, replaceHistory = false } = {}) => {
        renderTableLoading();
        const params = new URLSearchParams({ status: state.status, page: String(state.page), pageSize: "10" });
        if (state.q) params.set("q", state.q);
        try {
            const payload = await api(`/api/admin/products?${params}`);
            state.products = Array.isArray(payload.data) ? payload.data : [];
            state.total = Number(payload.meta?.total ?? 0);
            state.totalPages = Math.max(1, Number(payload.meta?.totalPages ?? 1));
            state.page = Math.max(1, Number(payload.meta?.page ?? state.page));
            if (updateHistory) updateUrl(replaceHistory);
            else if (state.page !== Number(params.get("page"))) updateUrl(true);
            renderProducts();
            setFeedback("");
        } catch (error) {
            state.products = [];
            productSummary.textContent = "Không thể tải dữ liệu";
            renderTableState("error", error.message, "Tải lại");
            setFeedback(error.status === 401 ? "Phiên admin không hợp lệ. Vui lòng kiểm tra quyền truy cập." : "Không thể tải dữ liệu từ máy chủ.", "error");
        }
    };


    const loadAuditLogs = async () => {
        const list = $("#audit-list");
        list.innerHTML = `<p class="muted">Đang tải lịch sử…</p>`;
        try {
            const payload = await api("/api/admin/audit-logs");
            const logs = Array.isArray(payload.data) ? payload.data.slice(0, 8) : [];
            list.innerHTML = logs.length ? logs.map((log) => `<div class="audit-item"><span class="audit-action audit-action--${escapeHtml(String(log.action || "").toLowerCase())}">${escapeHtml(log.action || "ACTION")}</span><div><strong>${escapeHtml(log.entity || "catalog")} #${escapeHtml(log.entityId)}</strong><small>${escapeHtml(log.actor || "admin")} · ${formatDateTime(log.timestamp)}</small></div></div>`).join("") : `<p class="muted">Chưa có thao tác nào.</p>`;
        } catch (error) {
            list.innerHTML = `<p class="muted">Không tải được audit log.</p>`;
        }
    };

    const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const openModal = (id, focusSelector) => {
        const modal = $(`#${id}`);
        if (!modal) return;
        window.clearTimeout(modal._closeTimer);
        modal.classList.remove("is-closing");
        state.lastFocus = document.activeElement;
        modal.hidden = false;
        document.body.classList.add("modal-open");
        const focusTarget = focusSelector ? $(focusSelector, modal) : $("input, select, textarea, button", modal);
        if (focusTarget) window.setTimeout(() => focusTarget.focus(), 20);
    };

    const closeModal = (id) => {
        const modal = $(`#${id}`);
        if (!modal || modal.hidden || modal.classList.contains("is-closing")) return;
        const finish = () => {
            modal.classList.remove("is-closing");
            modal.hidden = true;
            if (!$$(".modal-backdrop:not([hidden])").length) document.body.classList.remove("modal-open");
            if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
        };
        if (prefersReducedMotion()) { finish(); return; }
        // Ra: 120ms, khớp keyframes admin-modal-out trong admin.css.
        modal.classList.add("is-closing");
        modal._closeTimer = window.setTimeout(finish, 120);
    };

    const clearFormErrors = (form) => {
        $$(".field", form).forEach((field) => field.classList.remove("has-error"));
        $$(".field-error", form).forEach((error) => { error.textContent = ""; });
        const summary = $(".form-error-summary", form);
        if (summary) { summary.hidden = true; summary.textContent = ""; }
    };

    const setFormError = (form, field, message) => {
        const wrapper = $(`[data-field="${field}"]`, form);
        const messageTarget = $(`[data-error-for="${field}"]`, form);
        if (wrapper) wrapper.classList.add("has-error");
        if (messageTarget) messageTarget.textContent = message;
    };

    let colorRowSeq = 0;

    const readColorRows = () => $$(".color-row", $("#color-rows")).map((row) => {
        const name = $("[data-color-name]", row).value.trim();
        return {
            row,
            name,
            hex: $("[data-color-hex]", row).value,
            file: $("[data-color-file]", row).files[0] || null,
            existingImage: row.dataset.originalColor === name ? row.dataset.existingImage || "" : ""
        };
    });

    const buildGridOptions = () => {
        const options = [];
        const colorNames = readColorRows().map((c) => c.name).filter(Boolean);
        if (colorNames.length) options.push({ name: "Màu sắc", values: colorNames });
        if (state.storages.length) options.push({ name: "Bộ nhớ", values: state.storages.slice() });
        return options;
    };

    const updateCoverImageVisibility = () => {
        const hasColors = readColorRows().some((c) => c.name);
        $("label[for='product-image']").hidden = hasColors;
        $("#product-image").hidden = hasColors;
        $("#product-image-color-hint").hidden = !hasColors;
        $("#product-image-current").hidden = hasColors || !$("#product-image-current").textContent;
    };

    const refreshVariantGrid = () => {
        const previousVariants = readVariantEditor();
        renderVariantEditor(buildGridOptions(), previousVariants);
        updateCoverImageVisibility();
    };

    const setColorRowError = (row, message) => {
        if (!row) return;
        row.classList.add("has-error");
        const target = $("[data-color-row-error]", row);
        if (target) target.textContent = message;
    };

    const clearColorRowError = (row) => {
        if (!row) return;
        row.classList.remove("has-error");
        const target = $("[data-color-row-error]", row);
        if (target) target.textContent = "";
    };

    const clearColorRowErrors = () => $$(".color-row", $("#color-rows")).forEach(clearColorRowError);

    const createColorRow = (prefill = {}) => {
        const row = document.createElement("div");
        row.className = "color-row";
        row.dataset.colorRow = String(++colorRowSeq);
        row.dataset.existingImage = prefill.existingImage || "";
        row.dataset.originalColor = prefill.name || "";
        const hasExisting = Boolean(prefill.existingImage && prefill.name);
        row.innerHTML = `<div class="color-row__palette" role="group" aria-label="Màu gợi ý">${COLOR_PRESETS.map((preset) => `<button type="button" class="color-swatch-btn" data-preset-name="${escapeHtml(preset.name)}" data-preset-hex="${preset.hex}" style="background-color:${preset.hex};" title="${escapeHtml(preset.name)}" aria-label="${escapeHtml(preset.name)}"></button>`).join("")}</div>
            <div class="color-row__body">
                <label class="color-row__field">Tên màu<input type="text" data-color-name maxlength="60" value="${escapeHtml(prefill.name || "")}" placeholder="VD: Đen"></label>
                <label class="color-row__field color-row__field--hex">Mã màu<input type="color" data-color-hex value="${escapeHtml(prefill.hex || "#1C1C1E")}"></label>
                <label class="color-row__field color-row__field--image">Ảnh màu<input type="file" data-color-file accept="image/png,.png,image/webp,.webp"></label>
                <div class="color-row__thumb">
                    <img data-color-thumb alt="" ${hasExisting ? `src="${escapeHtml(prefill.existingImage)}"` : ""} ${hasExisting ? "" : "hidden"}>
                    <span class="color-row__thumb-empty" data-color-thumb-empty ${hasExisting ? "hidden" : ""}>Chưa có ảnh</span>
                </div>
                <button type="button" class="color-row__remove" data-remove-color aria-label="Xoá màu">×</button>
            </div>
            <small class="field-error" data-color-row-error></small>`;
        return row;
    };

    const addColorRow = (prefill) => {
        const row = createColorRow(prefill);
        $("#color-rows").appendChild(row);
        refreshVariantGrid();
        return row;
    };

    const removeColorRow = (row) => {
        if (!row) return;
        if (row._objectUrl) URL.revokeObjectURL(row._objectUrl);
        row.remove();
        refreshVariantGrid();
    };

    const applyColorPreset = (row, name, hex) => {
        if (!row) return;
        $("[data-color-name]", row).value = name;
        $("[data-color-hex]", row).value = hex;
        clearColorRowError(row);
        const imageInput = $("[data-color-file]", row);
        if (!imageInput.files[0]) handleColorFileChange(imageInput);
        refreshVariantGrid();
    };

    const handleColorFileChange = (input) => {
        const row = input.closest(".color-row");
        if (!row) return;
        const file = input.files[0] || null;
        if (row._objectUrl) { URL.revokeObjectURL(row._objectUrl); row._objectUrl = null; }
        const thumb = $("[data-color-thumb]", row);
        const empty = $("[data-color-thumb-empty]", row);
        if (file) {
            row._objectUrl = URL.createObjectURL(file);
            thumb.src = row._objectUrl;
            thumb.hidden = false;
            empty.hidden = true;
        } else if (row.dataset.originalColor === $("[data-color-name]", row).value.trim() && row.dataset.existingImage) {
            thumb.src = row.dataset.existingImage;
            thumb.hidden = false;
            empty.hidden = true;
        } else {
            thumb.removeAttribute("src");
            thumb.hidden = true;
            empty.hidden = false;
        }
        clearColorRowError(row);
    };

    const resetColorRows = () => {
        $$(".color-row", $("#color-rows")).forEach((row) => { if (row._objectUrl) URL.revokeObjectURL(row._objectUrl); });
        $("#color-rows").innerHTML = "";
    };

    const renderStoragePresets = () => {
        $("#storage-presets").innerHTML = STORAGE_PRESETS.map((value) => `<button type="button" class="chip-toggle ${state.storages.includes(value) ? "is-selected" : ""}" data-storage-preset="${escapeHtml(value)}" aria-pressed="${state.storages.includes(value)}">${escapeHtml(value)}</button>`).join("");
    };

    const renderStorageChips = () => {
        $("#storage-chips").innerHTML = state.storages.length
            ? state.storages.map((value) => `<span class="chip chip--removable">${escapeHtml(value)}<button type="button" class="chip__remove" data-remove-storage="${escapeHtml(value)}" aria-label="Xoá ${escapeHtml(value)}">×</button></span>`).join("")
            : `<span class="muted">Chưa chọn dung lượng nào.</span>`;
    };

    const renderStorageBuilder = () => { renderStoragePresets(); renderStorageChips(); };

    const toggleStorage = (value) => {
        const index = state.storages.indexOf(value);
        if (index >= 0) state.storages.splice(index, 1); else state.storages.push(value);
        renderStorageBuilder();
        refreshVariantGrid();
    };

    const removeStorage = (value) => {
        state.storages = state.storages.filter((item) => item !== value);
        renderStorageBuilder();
        refreshVariantGrid();
    };

    const addCustomStorage = () => {
        const input = $("#storage-custom-input");
        const value = input.value.trim();
        if (!value) return;
        if (!state.storages.some((item) => item.toLocaleLowerCase("vi") === value.toLocaleLowerCase("vi"))) {
            state.storages.push(value);
            renderStorageBuilder();
            refreshVariantGrid();
        }
        input.value = "";
    };

    const sameOptionValues = (left = {}, right = {}) => {
        const canonical = (values) => Object.entries(values)
            .map(([name, value]) => [name.trim().toLocaleLowerCase("vi"), String(value).trim().toLocaleLowerCase("vi")])
            .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));
        return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
    };

    const renderVariantEditor = (options, existingVariants = []) => {
        let combinations = [{}];
        for (const option of options) {
            combinations = combinations.flatMap((combination) => option.values.map((value) => ({
                ...combination,
                [option.name]: value
            })));
        }
        const rows = $("#variant-editor-rows");
        rows.innerHTML = combinations.map((optionValues) => {
            const current = existingVariants.find((variant) => sameOptionValues(variant.optionValues || {}, optionValues));
            const label = Object.entries(optionValues).map(([name, value]) => `${name}: ${value}`).join(" · ") || "Phiên bản mặc định";
            return `<div class="variant-editor__row" data-option-values="${escapeHtml(JSON.stringify(optionValues))}">
                <strong class="variant-editor__combination">${escapeHtml(label)}</strong>
                <label>SKU<input type="text" data-variant-sku maxlength="100" value="${escapeHtml(current?.sku || buildSuggestedSku(optionValues))}" placeholder="SKU" required></label>
                <label>Giá (₫)<input type="number" data-variant-price min="1" step="1" value="${escapeHtml(current?.price ?? "")}" required inputmode="numeric"></label>
                <label>Tồn kho<input type="number" data-variant-stock min="0" step="1" value="${escapeHtml(current?.stock ?? "")}" required inputmode="numeric"></label>
            </div>`;
        }).join("");
    };

    const readVariantEditor = () => $$(".variant-editor__row", $("#variant-editor-rows")).map((row) => ({
        sku: $("[data-variant-sku]", row).value.trim(),
        price: $("[data-variant-price]", row).value === "" ? "" : Number($("[data-variant-price]", row).value),
        stock: $("[data-variant-stock]", row).value === "" ? "" : Number($("[data-variant-stock]", row).value),
        optionValues: JSON.parse(row.dataset.optionValues || "{}")
    }));

    const validateProductForm = () => {
        const form = $("#product-form");
        clearFormErrors(form);
        clearColorRowErrors();
        const colorRows = readColorRows();
        const activeColors = colorRows.filter((c) => c.name);
        const seenNames = new Set();
        let colorsValid = true;
        activeColors.forEach((color) => {
            const key = color.name.toLocaleLowerCase("vi");
            if (seenNames.has(key)) {
                setColorRowError(color.row, "Tên màu bị trùng.");
                colorsValid = false;
            } else {
                seenNames.add(key);
            }
            if (!color.file && !color.existingImage) {
                setColorRowError(color.row, "Vui lòng chọn ảnh cho màu này.");
                colorsValid = false;
            }
        });
        const options = [];
        if (activeColors.length) options.push({ name: "Màu sắc", values: activeColors.map((c) => ({ value: c.name, colorHex: c.hex })) });
        if (state.storages.length) options.push({ name: "Bộ nhớ", values: state.storages.map((value) => ({ value })) });
        const fields = {
            name: $("#product-name").value.trim(),
            brand: $("#product-brand").value,
            deviceType: $("#product-device-type").value,
            image: $("#product-image").files[0] || null,
            description: $("#product-description").value.trim(),
            options,
            variants: readVariantEditor(),
            colorFiles: activeColors.filter((c) => c.file).map((c) => ({ value: c.name, file: c.file }))
        };
        const errors = {};
        if (!fields.name) errors.name = "Vui lòng nhập tên sản phẩm.";
        if (!fields.brand) errors.brand = "Vui lòng chọn thương hiệu.";
        if (!fields.deviceType) errors.deviceType = "Vui lòng chọn loại thiết bị.";
        if (!activeColors.length && !state.editingId && !fields.image) errors.image = "Vui lòng chọn ảnh PNG hoặc WebP sản phẩm.";
        if (!fields.description) errors.description = "Vui lòng nhập mô tả.";
        if (!fields.variants.length || fields.variants.some((variant) =>
            !variant.sku || variant.price === "" || !Number.isInteger(variant.price) || variant.price <= 0 ||
            variant.stock === "" || !Number.isInteger(variant.stock) || variant.stock < 0
        )) errors.variants = "Mỗi phiên bản cần SKU riêng, giá nguyên dương và tồn kho nguyên không âm.";
        if (!colorsValid) errors.colorImages = "Vui lòng kiểm tra tên và ảnh của từng màu.";
        Object.entries(errors).forEach(([field, message]) => setFormError(form, field, message));
        if (Object.keys(errors).length) {
            const summary = $("#product-form-error");
            summary.textContent = "Vui lòng kiểm tra các trường bắt buộc.";
            summary.hidden = false;
            const firstField = Object.keys(errors)[0];
            const first = $(`[data-field="${firstField}"] input, [data-field="${firstField}"] select, [data-field="${firstField}"] textarea`, form);
            if (first) first.focus();
            return null;
        }
        return fields;
    };

    const setSubmitBusy = (button, busy, label) => {
        button.disabled = busy;
        button.innerHTML = busy ? `<span class="button-spinner" aria-hidden="true"></span> Đang lưu…` : label;
    };

    const openProductForm = async (id = null) => {
        state.editingId = id;
        state.variantSource = [];
        state.storages = [];
        const form = $("#product-form");
        form.reset();
        clearFormErrors(form);
        resetColorRows();
        renderStorageBuilder();
        renderVariantEditor([], []);
        updateCoverImageVisibility();
        $("#product-image-current").textContent = "";
        $("#product-image-current").hidden = true;
        const submitButton = $("#product-submit-btn");
        submitButton.disabled = Boolean(id);
        submitButton.textContent = id ? "Đang tải…" : "Thêm sản phẩm";
        $("#product-modal-title").textContent = id ? "Sửa sản phẩm" : "Thêm sản phẩm";
        $("#product-modal-kicker").textContent = id ? "EDIT CATALOG ITEM" : "NEW CATALOG ITEM";
        $("#product-submit-btn").textContent = id ? "Cập nhật" : "Thêm sản phẩm";
        openModal("product-modal", "#product-name");
        if (!id) return;
        try {
            const payload = await api(`/api/admin/products/${encodeURIComponent(id)}`);
            const product = payload.data || {};
            $("#product-name").value = product.name || "";
            $("#product-brand").value = product.brand || "";
            $("#product-device-type").value = product.deviceType || "";
            const options = product.options || [];
            const colorOption = options.find((option) => String(option.name).trim().toLocaleLowerCase("vi") === "màu sắc");
            const storageOption = options.find((option) => option !== colorOption);
            const colorImageByValue = {};
            (product.variants || []).forEach((variant) => {
                const colorValue = variant.optionValues && variant.optionValues["Màu sắc"];
                if (colorValue && variant.image && !colorImageByValue[colorValue]) colorImageByValue[colorValue] = variant.image;
            });
            (colorOption?.values || []).forEach((value) => {
                addColorRow({ name: value.value, hex: value.colorHex || "#1C1C1E", existingImage: colorImageByValue[value.value] || "" });
            });
            state.storages = (storageOption?.values || []).map((value) => value.value);
            renderStorageBuilder();
            state.variantSource = product.variants || [];
            renderVariantEditor(buildGridOptions(), state.variantSource);
            $("#product-image-current").textContent = product.image ? "Đang giữ ảnh hiện tại nếu bạn không chọn ảnh thay thế." : "";
            $("#product-image-current").hidden = !product.image;
            updateCoverImageVisibility();
            $("#product-description").value = product.description || "";
        } catch (error) {
            closeModal("product-modal");
            showToast(error.message, "error");
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Cập nhật";
        }
    };


    const submitProduct = async (event) => {
        event.preventDefault();
        if (state.busy) return;
        const values = validateProductForm();
        if (!values) return;
        state.busy = true;
        const button = $("#product-submit-btn");
        const original = state.editingId ? "Cập nhật" : "Thêm sản phẩm";
        setSubmitBusy(button, true, original);
        const body = new FormData();
        for (const [field, value] of Object.entries({
            name: values.name,
            brand: values.brand,
            deviceType: values.deviceType,
            description: values.description,
            options: JSON.stringify(values.options),
            variants: JSON.stringify(values.variants)
        })) {
            body.append(field, String(value));
        }
        const hasColorOption = values.options.some((option) => option.name === "Màu sắc");
        if (!hasColorOption && values.image) body.append("image", values.image);
        values.colorFiles.forEach(({ value, file }) => body.append(encodeColorImageField(value), file));
        try {
            const endpoint = state.editingId ? `/api/admin/products/${encodeURIComponent(state.editingId)}` : "/api/admin/products";
            await api(endpoint, { method: state.editingId ? "PUT" : "POST", body });
            closeModal("product-modal");
            showToast(state.editingId ? "Cập nhật sản phẩm thành công." : "Thêm sản phẩm thành công.");
            await Promise.all([loadProducts(), renderCounts(), loadAuditLogs()]);
        } catch (error) {
            (Array.isArray(error.details) ? error.details : []).forEach((detail) => setFormError($("#product-form"), detail.field, detail.message));
            const summary = $("#product-form-error");
            summary.textContent = error.message;
            summary.hidden = false;
        } finally {
            state.busy = false;
            setSubmitBusy(button, false, original);
        }
    };



    const showConfirm = (title, message, action, options = {}) => {
        $("#confirm-title").textContent = title;
        $("#confirm-message").textContent = message;
        $("#confirm-icon").textContent = options.restore ? "↶" : "!";
        state.confirmAction = action;
        openModal("confirm-modal", "#confirm-action-btn");
    };

    const deleteProduct = (id) => {
        const product = state.products.find((item) => String(item.id) === String(id));
        showConfirm("Đưa sản phẩm vào thùng rác?", `“${product ? product.name : "Sản phẩm này"}” sẽ ngừng hiển thị trên cửa hàng. Bạn vẫn có thể khôi phục sau.`, async () => {
            try {
                await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
                closeModal("confirm-modal");
                showToast("Sản phẩm đã được chuyển vào thùng rác.");
                await Promise.all([loadProducts(), renderCounts(), loadAuditLogs()]);
            } catch (error) {
                closeModal("confirm-modal");
                showToast(error.message, "error");
            }
        });
    };

    const restoreProduct = (id) => {
        const product = state.products.find((item) => String(item.id) === String(id));
        showConfirm("Khôi phục sản phẩm?", `“${product ? product.name : "Sản phẩm này"}” sẽ xuất hiện lại trên cửa hàng.`, async () => {
            try {
                await api(`/api/admin/products/${encodeURIComponent(id)}/restore`, { method: "POST", body: {} });
                closeModal("confirm-modal");
                showToast("Khôi phục sản phẩm thành công.");
                await Promise.all([loadProducts(), renderCounts(), loadAuditLogs()]);
            } catch (error) {
                closeModal("confirm-modal");
                showToast(error.message, "error");
            }
        }, { restore: true });
    };

    const resetFilters = () => {
        state.q = "";
        state.page = 1;
        $("#product-search").value = "";
        $("#clear-filters-btn").hidden = true;
        loadProducts({ updateHistory: true });
    };

    const initAdminAccountForm = () => {
        const form = $("#admin-account-form");
        if (!form) return;
        const feedback = $("#admin-account-feedback");
        const setAccountFeedback = (message, type = "success") => {
            feedback.textContent = message || "";
            feedback.className = `admin-feedback admin-feedback--${type}`;
            feedback.hidden = !message;
        };
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            $$(".field-error", form).forEach((element) => { element.textContent = ""; });
            $$("input", form).forEach((input) => input.setAttribute("aria-invalid", "false"));
            const username = form.username.value.trim();
            const temporaryPassword = form.temporaryPassword.value;
            let invalid = false;
            if (!/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
                $("[data-account-error=\"username\"]", form).textContent = "Username dài 3–64 ký tự, chỉ dùng chữ, số, ., _, -.";
                form.username.setAttribute("aria-invalid", "true");
                invalid = true;
            }
            if (temporaryPassword.length < 6) {
                $("[data-account-error=\"temporaryPassword\"]", form).textContent = "Mật khẩu tạm phải có ít nhất 6 ký tự.";
                form.temporaryPassword.setAttribute("aria-invalid", "true");
                invalid = true;
            }
            if (invalid) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
            const button = form.querySelector("button[type=submit]");
            button.disabled = true;
            const original = button.textContent;
            button.textContent = "Đang tạo…";
            try {
                const payload = await api("/api/admin/accounts", { method: "POST", body: { username, temporaryPassword } });
                form.reset();
                setAccountFeedback(`Đã tạo Admin ${payload.data?.username || username}. Tài khoản này phải đổi mật khẩu khi đăng nhập lần đầu.`, "success");
            } catch (error) {
                setAccountFeedback(error.code === "USERNAME_TAKEN" ? "Username đã được sử dụng." : error.message, "error");
                form.temporaryPassword.value = "";
            } finally { button.disabled = false; button.textContent = original; }
        });
    };

    document.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.matches("[data-close-modal]")) closeModal(target.dataset.closeModal);
        if (target.id === "add-product-btn") openProductForm();
        if (target.id === "refresh-products-btn") { loadProducts(); renderCounts(); }
        if (target.id === "table-state-action") {
            const action = target.dataset.stateAction;
            if (action === "reset") resetFilters();
            else if (action === "add") openProductForm();
            else { loadProducts(); renderCounts(); }
        }
        if (target.id === "refresh-audit-btn") loadAuditLogs();
        if (target.id === "clear-filters-btn") resetFilters();
        if (target.dataset.productStatus) {
            state.status = target.dataset.productStatus;
            state.page = 1;
            setActiveTab(state.status);
            loadProducts({ updateHistory: true });
        }
        if (target.dataset.editProduct) openProductForm(target.dataset.editProduct);
        if (target.dataset.deleteProduct) deleteProduct(target.dataset.deleteProduct);
        if (target.dataset.restoreProduct) restoreProduct(target.dataset.restoreProduct);
        if (target.id === "add-color-btn") addColorRow();
        if (target.dataset.removeColor !== undefined) removeColorRow(target.closest(".color-row"));
        if (target.dataset.presetName !== undefined) applyColorPreset(target.closest(".color-row"), target.dataset.presetName, target.dataset.presetHex);
        if (target.dataset.storagePreset !== undefined) toggleStorage(target.dataset.storagePreset);
        if (target.dataset.removeStorage !== undefined) removeStorage(target.dataset.removeStorage);
        if (target.id === "add-storage-btn") addCustomStorage();
        if (target.id === "confirm-action-btn" && state.confirmAction) {
            const action = state.confirmAction;
            target.disabled = true;
            Promise.resolve(action()).catch((error) => showToast(error.message, "error")).finally(() => { target.disabled = false; });
        }
    });

    $("#product-form").addEventListener("submit", submitProduct);
    $("#product-form").addEventListener("input", (event) => {
        if (!event.target.matches("[data-color-name]")) return;
        const row = event.target.closest(".color-row");
        clearColorRowError(row);
        const imageInput = $("[data-color-file]", row);
        if (!imageInput.files[0]) handleColorFileChange(imageInput);
        refreshVariantGrid();
    });
    $("#product-form").addEventListener("change", (event) => {
        if (event.target.matches("[data-color-file]")) handleColorFileChange(event.target);
    });
    $("#storage-custom-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); addCustomStorage(); }
    });
    $("#product-search").addEventListener("input", (event) => {
        window.clearTimeout(state.searchTimer);
        $("#search-spinner").hidden = false;
        state.searchTimer = window.setTimeout(() => {
            state.q = event.target.value.trim();
            state.page = 1;
            $("#clear-filters-btn").hidden = !state.q;
            loadProducts({ updateHistory: true }).finally(() => { $("#search-spinner").hidden = true; });
        }, 200);
    });
    const setActiveTab = (status) => {
        $$(".status-tab").forEach((tab) => {
            const active = tab.dataset.productStatus === status;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
    };
    $(".status-tabs").addEventListener("keydown", (event) => {
        const keys = { ArrowLeft: -1, ArrowRight: 1, Home: "first", End: "last" };
        if (!(event.key in keys)) return;
        const tabs = $$(".status-tab");
        const index = tabs.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const step = keys[event.key];
        const next = step === "first" ? 0 : step === "last" ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
    });

    const readQuery = () => {
        const url = new URL(window.location.href);
        state.status = ["active", "deleted", "all"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "active";
        state.q = url.searchParams.get("q") || "";
        const requestedPage = Number(url.searchParams.get("page"));
        state.page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    };
    const applyStateToControls = () => {
        $("#product-search").value = state.q;
        $("#clear-filters-btn").hidden = !state.q;
        setActiveTab(state.status);
    };

    let activeView = null;
    // Back/forward chỉ đổi query (cùng màn Sản phẩm, hash không đổi) thì nạp lại danh sách.
    // Đổi màn thì 'admin:view' lo.
    window.addEventListener("popstate", () => {
        if (activeView !== "san-pham" || !/^#\/san-pham(\/|$)/.test(window.location.hash)) return;
        readQuery();
        applyStateToControls();
        loadProducts();
    });
    document.addEventListener("admin:view", (event) => {
        const { view } = event.detail;
        const previous = activeView;
        activeView = view;
        if (previous === "san-pham" && view !== "san-pham") clearProductQuery();
        if (view === "san-pham") {
            if (new URL(window.location.href).searchParams.has("status")) readQuery();
            applyStateToControls();
            updateUrl(true);
            loadProducts();
            renderCounts();
        }
        if (view === "tai-khoan") loadAuditLogs();
    });
    $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") $$(".modal-backdrop:not([hidden])").forEach((modal) => closeModal(modal.id));
    });

    /* ----- Select tự vẽ (choice-controls.md): nút combobox + listbox; <select> gốc giữ làm nguồn giá trị ----- */
    const enhanceSelect = (select) => {
        const wrap = document.createElement("div");
        wrap.className = "select";
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.tabIndex = -1;
        select.setAttribute("aria-hidden", "true");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "select-btn";
        button.id = `${select.id}-btn`;
        button.setAttribute("role", "combobox");
        button.setAttribute("aria-haspopup", "listbox");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", `${select.id}-list`);
        button.innerHTML = `<span class="select-btn__text"></span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
        wrap.insertBefore(button, select);
        const label = document.querySelector(`label[for="${select.id}"]`);
        if (label) label.setAttribute("for", button.id);
        const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
        let list = null;
        let activeIndex = -1;
        const options = () => Array.from(select.options);
        const sync = () => {
            const selected = select.options[select.selectedIndex];
            button.firstElementChild.textContent = selected ? selected.textContent : "";
            button.classList.toggle("is-placeholder", !select.value);
        };
        Object.defineProperty(select, "value", {
            configurable: true,
            get() { return valueDescriptor.get.call(this); },
            set(next) { valueDescriptor.set.call(this, next); sync(); }
        });
        select.focus = () => button.focus();
        const setActive = (index) => {
            if (!list) return;
            activeIndex = Math.max(0, Math.min(index, list.children.length - 1));
            Array.from(list.children).forEach((item, position) => item.classList.toggle("is-active", position === activeIndex));
            button.setAttribute("aria-activedescendant", list.children[activeIndex].id);
            list.children[activeIndex].scrollIntoView({ block: "nearest" });
        };
        const close = ({ focus = false } = {}) => {
            if (!list) return;
            const closing = list;
            list = null;
            button.setAttribute("aria-expanded", "false");
            button.removeAttribute("aria-activedescendant");
            if (prefersReducedMotion()) closing.remove();
            else { closing.classList.add("is-closing"); window.setTimeout(() => closing.remove(), 100); }
            document.removeEventListener("pointerdown", onOutside, true);
            if (focus) button.focus();
        };
        const choose = (value) => {
            valueDescriptor.set.call(select, value);
            sync();
            select.dispatchEvent(new Event("change", { bubbles: true }));
            close({ focus: true });
        };
        const onOutside = (event) => { if (!wrap.contains(event.target)) close(); };
        const open = () => {
            if (list) return;
            list = document.createElement("ul");
            list.className = "select-list";
            list.id = `${select.id}-list`;
            list.setAttribute("role", "listbox");
            options().forEach((option, index) => {
                const item = document.createElement("li");
                item.className = "select-option";
                item.id = `${select.id}-opt-${index}`;
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected", String(option.value === select.value));
                item.dataset.value = option.value;
                item.textContent = option.textContent;
                item.addEventListener("pointerdown", (event) => event.preventDefault());
                item.addEventListener("click", () => choose(option.value));
                list.appendChild(item);
            });
            wrap.appendChild(list);
            button.setAttribute("aria-expanded", "true");
            document.addEventListener("pointerdown", onOutside, true);
            setActive(Math.max(0, select.selectedIndex));
        };
        button.addEventListener("click", () => (list ? close() : open()));
        button.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && list) { event.stopPropagation(); close(); return; }
            if (event.key === "Tab") { close(); return; }
            if (!["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            if (!list) { open(); return; }
            if (event.key === "ArrowDown") setActive(activeIndex + 1);
            else if (event.key === "ArrowUp") setActive(activeIndex - 1);
            else if (event.key === "Home") setActive(0);
            else if (event.key === "End") setActive(list.children.length - 1);
            else choose(options()[activeIndex].value);
        });
        button.addEventListener("blur", () => { window.setTimeout(() => { if (list && !wrap.contains(document.activeElement)) close(); }, 0); });
        const form = select.closest("form");
        if (form) form.addEventListener("reset", () => window.setTimeout(sync, 0));
        sync();
    };
    $$("#product-form select").forEach(enhanceSelect);

    const bootAdmin = async () => {
        const current = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false }));
        if (!current.authenticated) { window.location.assign("/403.html?context=admin"); return; }
        if (current.user?.role !== "admin") { window.location.assign("/403.html?context=admin"); return; }
        if (current.user.forcePasswordChange) { window.location.assign("/profile.html?force=1"); return; }
        initAdminAccountForm();
        readQuery();
        applyStateToControls();
        resolveReady(current);
    };
    bootAdmin();
})();
