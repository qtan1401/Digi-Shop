/* ===== ADMIN CATALOG DASHBOARD ===== */
(() => {
    "use strict";

    const ADMIN_KEY = "dev-secret";
    const state = {
        status: "active",
        q: "",
        categoryId: "",
        categories: [],
        products: [],
        editingId: null,
        busy: false,
        searchTimer: null,
        confirmAction: null,
        lastFocus: null
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const productRegion = $("#product-table-region");
    const productSummary = $("#table-summary");

    const escapeHtml = (value) => String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const formatPrice = (value) => Number(value || 0).toLocaleString("vi-VN") + " ₫";
    const formatDate = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value)) : "—";
    const formatDateTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

    const api = async (url, options = {}) => {
        const headers = { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
        if (url.startsWith("/api/admin")) headers["x-admin-key"] = ADMIN_KEY;
        const response = await fetch(url, { ...options, headers });
        let payload = {};
        try { payload = await response.json(); } catch (_) { /* Keep the HTTP error below useful. */ }
        if (!response.ok || payload.success === false) {
            const error = new Error(payload.message || `Yêu cầu thất bại (${response.status})`);
            error.status = response.status;
            error.details = Array.isArray(payload.errors) ? payload.errors : [];
            throw error;
        }
        return payload;
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

    const setFeedback = (message, type = "error") => {
        const element = $("#global-feedback");
        element.className = `admin-feedback admin-feedback--${type}`;
        element.textContent = message;
        element.hidden = !message;
    };

    const renderCategories = () => {
        const list = $("#category-list");
        if (!state.categories.length) {
            list.innerHTML = `<div class="side-empty"><span aria-hidden="true">◌</span><p>Chưa có danh mục.</p></div>`;
        } else {
            list.innerHTML = state.categories.map((category) => `
                <div class="category-row">
                    <button type="button" class="category-row__filter ${String(category.id) === String(state.categoryId) ? "is-selected" : ""}" data-category-filter="${escapeHtml(category.id)}">
                        <span class="category-dot" aria-hidden="true"></span><span class="category-row__name">${escapeHtml(category.name)}</span><span class="category-row__count">${Number(category.productCount || 0)}</span>
                    </button>
                    <button type="button" class="category-row__delete" data-delete-category="${escapeHtml(category.id)}" aria-label="Xóa danh mục ${escapeHtml(category.name)}" title="Xóa danh mục">×</button>
                </div>`).join("");
        }
        const selects = [$("#category-filter"), $("#product-category"), $("#restore-category")];
        selects.forEach((select) => {
            if (!select) return;
            const selected = select.value;
            const placeholder = select.options[0] ? select.options[0].outerHTML : "";
            select.innerHTML = placeholder + state.categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join("");
            if ([...select.options].some((option) => option.value === selected)) select.value = selected;
        });
        $("#category-filter").value = state.categoryId;
    };

    const renderTableLoading = () => {
        productSummary.textContent = "Đang tải sản phẩm…";
        productRegion.innerHTML = `<div class="skeleton-table" aria-label="Đang tải sản phẩm"><span></span><span></span><span></span><span></span></div>`;
    };

    const renderTableState = (type, message, actionLabel = "") => {
        productRegion.innerHTML = `<div class="table-state table-state--${type}"><div class="table-state__icon" aria-hidden="true">${type === "error" ? "!" : state.status === "deleted" ? "♧" : "□"}</div><h3>${escapeHtml(message)}</h3>${actionLabel ? `<button type="button" class="btn btn--secondary btn--small" id="table-state-action">${escapeHtml(actionLabel)}</button>` : ""}</div>`;
    };

    const renderProducts = () => {
        const products = state.products;
        if (!products.length) {
            productSummary.textContent = state.q || state.categoryId ? "0 kết quả" : state.status === "deleted" ? "Thùng rác trống" : "Chưa có sản phẩm";
            renderTableState("empty", state.q || state.categoryId
                ? "Không tìm thấy sản phẩm nào khớp với từ khóa. Thử tìm kiếm theo tên khác hoặc đặt lại bộ lọc."
                : state.status === "deleted" ? "Thùng rác trống. Không có sản phẩm nào bị xóa." : "Chưa có sản phẩm nào", state.q || state.categoryId ? "Đặt lại bộ lọc" : "Thêm sản phẩm ngay");
            return;
        }
        productSummary.textContent = `Hiển thị ${products.length} sản phẩm${state.q || state.categoryId ? " phù hợp" : ""}`;
        productRegion.innerHTML = `<table class="product-table"><caption class="sr-only">Danh sách sản phẩm</caption><thead><tr>
            <th scope="col">Sản phẩm</th><th scope="col">SKU</th><th scope="col">Danh mục</th><th scope="col">Giá</th><th scope="col">Tồn kho</th>${state.status === "deleted" ? "<th scope=\"col\">Ngày xóa</th>" : ""}<th scope="col"><span class="sr-only">Thao tác</span></th>
        </tr></thead><tbody>${products.map((product) => {
            const deleted = Boolean(product.isDeleted);
            return `<tr class="${deleted ? "is-deleted" : ""}">
                <td><div class="product-cell"><img src="${escapeHtml(product.image || "")}" alt="" loading="lazy" onerror="this.classList.add('is-broken')"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || "")}</small></div></div></td>
                <td><code class="sku-badge">${escapeHtml(product.sku)}</code></td>
                <td>${escapeHtml(product.categoryName || categoryName(product.categoryId) || "Chưa phân loại")}</td>
                <td class="price-cell">${formatPrice(product.price)}</td>
                <td><span class="stock-pill ${Number(product.stock) <= 0 ? "stock-pill--empty" : Number(product.stock) <= 5 ? "stock-pill--low" : ""}">${escapeHtml(product.stock)}</span></td>
                ${state.status === "deleted" ? `<td class="date-cell">${formatDate(product.deletedAt)}</td>` : ""}
                <td class="row-actions">${deleted ? `<button type="button" class="table-action table-action--restore" data-restore-product="${escapeHtml(product.id)}">Khôi phục</button>` : `<button type="button" class="table-action" data-edit-product="${escapeHtml(product.id)}">Sửa</button><button type="button" class="table-action table-action--danger" data-delete-product="${escapeHtml(product.id)}">Xóa</button>`}</td>
            </tr>`;
        }).join("")}</tbody></table>`;
    };

    const categoryName = (id) => {
        const match = state.categories.find((category) => String(category.id) === String(id));
        return match ? match.name : "";
    };

    const renderCounts = async () => {
        try {
            const [active, deleted] = await Promise.all([
                api("/api/admin/products?status=active"),
                api("/api/admin/products?status=deleted")
            ]);
            $("#active-count").textContent = Number(active.total ?? (active.data || []).length);
            $("#deleted-count").textContent = Number(deleted.total ?? (deleted.data || []).length);
        } catch (_) {
            $("#active-count").textContent = "—";
            $("#deleted-count").textContent = "—";
        }
    };

    const loadProducts = async () => {
        renderTableLoading();
        const params = new URLSearchParams({ status: state.status });
        if (state.q) params.set("q", state.q);
        if (state.categoryId) params.set("categoryId", state.categoryId);
        try {
            const payload = await api(`/api/admin/products?${params}`);
            state.products = Array.isArray(payload.data) ? payload.data : [];
            renderProducts();
            setFeedback("");
        } catch (error) {
            state.products = [];
            productSummary.textContent = "Không thể tải dữ liệu";
            renderTableState("error", error.message, "Tải lại");
            setFeedback(error.status === 401 ? "Phiên admin không hợp lệ. Vui lòng kiểm tra quyền truy cập." : "Không thể tải dữ liệu từ máy chủ.", "error");
        }
    };

    const loadCategories = async () => {
        const list = $("#category-list");
        list.innerHTML = `<div class="side-loading" aria-label="Đang tải danh mục"><span class="mini-spinner"></span> Đang tải…</div>`;
        try {
            const payload = await api("/api/categories");
            state.categories = Array.isArray(payload.data) ? payload.data : [];
            renderCategories();
        } catch (error) {
            list.innerHTML = `<div class="side-error">Không tải được danh mục.<button class="text-button" type="button" id="retry-categories">Thử lại</button></div>`;
            setFeedback(error.message, "error");
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

    const refreshAll = async () => {
        await Promise.all([loadCategories(), loadProducts(), renderCounts(), loadAuditLogs()]);
    };

    const openModal = (id, focusSelector) => {
        const modal = $(`#${id}`);
        if (!modal) return;
        state.lastFocus = document.activeElement;
        modal.hidden = false;
        document.body.classList.add("modal-open");
        const focusTarget = focusSelector ? $(focusSelector, modal) : $("input, select, textarea, button", modal);
        if (focusTarget) window.setTimeout(() => focusTarget.focus(), 20);
    };

    const closeModal = (id) => {
        const modal = $(`#${id}`);
        if (!modal) return;
        modal.hidden = true;
        if (!$$(".modal-backdrop:not([hidden])").length) document.body.classList.remove("modal-open");
        if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
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

    const validateProductForm = () => {
        const form = $("#product-form");
        clearFormErrors(form);
        const fields = {
            name: $("#product-name").value.trim(), sku: $("#product-sku").value.trim(), categoryId: $("#product-category").value,
            price: $("#product-price").value, stock: $("#product-stock").value, image: $("#product-image").value.trim(), description: $("#product-description").value.trim()
        };
        const errors = {};
        if (!fields.name) errors.name = "Vui lòng nhập tên sản phẩm.";
        if (!state.editingId && !fields.sku) errors.sku = "Vui lòng nhập SKU.";
        if (!fields.categoryId) errors.categoryId = "Vui lòng chọn danh mục.";
        if (!fields.price || Number(fields.price) <= 0 || !Number.isInteger(Number(fields.price))) errors.price = "Giá bán phải là số nguyên dương.";
        if (fields.stock === "" || Number(fields.stock) < 0 || !Number.isInteger(Number(fields.stock))) errors.stock = "Tồn kho phải là số nguyên không âm.";
        if (!fields.image) errors.image = "Vui lòng nhập URL ảnh.";
        else { try { new URL(fields.image); } catch (_) { errors.image = "URL ảnh không hợp lệ."; } }
        if (!fields.description) errors.description = "Vui lòng nhập mô tả.";
        Object.entries(errors).forEach(([field, message]) => setFormError(form, field, message));
        if (Object.keys(errors).length) {
            const summary = $("#product-form-error");
            summary.textContent = "Vui lòng kiểm tra các trường bắt buộc.";
            summary.hidden = false;
            const first = $(`[data-field="${Object.keys(errors)[0]}"] input, [data-field="${Object.keys(errors)[0]}"] select, [data-field="${Object.keys(errors)[0]}"] textarea`, form);
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
        const form = $("#product-form");
        form.reset();
        clearFormErrors(form);
        const submitButton = $("#product-submit-btn");
        submitButton.disabled = Boolean(id);
        submitButton.textContent = id ? "Đang tải…" : "Thêm sản phẩm";
        $("#product-modal-title").textContent = id ? "Sửa sản phẩm" : "Thêm sản phẩm";
        $("#product-modal-kicker").textContent = id ? "EDIT CATALOG ITEM" : "NEW CATALOG ITEM";
        $("#product-submit-btn").textContent = id ? "Cập nhật" : "Thêm sản phẩm";
        $("#product-sku").disabled = Boolean(id);
        $("#sku-lock").hidden = !id;
        $("#sku-hint").textContent = id ? "SKU là mã cố định và không thể chỉnh sửa." : "Mã duy nhất, ví dụ IP16PM-256";
        renderCategories();
        openModal("product-modal", id ? "#product-name" : "#product-name");
        if (!id) return;
        try {
            const payload = await api(`/api/admin/products/${encodeURIComponent(id)}`);
            const product = payload.data || {};
            $("#product-name").value = product.name || "";
            $("#product-sku").value = product.sku || "";
            $("#product-category").value = product.categoryId ?? "";
            $("#product-price").value = product.price ?? "";
            $("#product-stock").value = product.stock ?? "";
            $("#product-image").value = product.image || "";
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
        const body = { name: values.name, categoryId: Number(values.categoryId), price: Number(values.price), stock: Number(values.stock), image: values.image, description: values.description };
        if (!state.editingId) body.sku = values.sku;
        try {
            const endpoint = state.editingId ? `/api/admin/products/${encodeURIComponent(state.editingId)}` : "/api/admin/products";
            await api(endpoint, { method: state.editingId ? "PUT" : "POST", body: JSON.stringify(body) });
            closeModal("product-modal");
            showToast(state.editingId ? "Cập nhật sản phẩm thành công." : "Thêm sản phẩm thành công.");
            await Promise.all([loadProducts(), loadCategories(), renderCounts(), loadAuditLogs()]);
        } catch (error) {
            error.details.forEach((detail) => setFormError($("#product-form"), detail.field, detail.message));
            const summary = $("#product-form-error");
            summary.textContent = error.message;
            summary.hidden = false;
        } finally {
            state.busy = false;
            setSubmitBusy(button, false, original);
        }
    };

    const submitCategory = async (event) => {
        event.preventDefault();
        const form = $("#category-form");
        clearFormErrors(form);
        const name = $("#category-name").value.trim();
        if (name.length < 2 || name.length > 100) {
            setFormError(form, "category-name", "Tên danh mục phải từ 2 đến 100 ký tự.");
            return;
        }
        const button = $("#category-submit-btn");
        setSubmitBusy(button, true, "Lưu danh mục");
        try {
            await api("/api/admin/categories", { method: "POST", body: JSON.stringify({ name, description: $("#category-description").value.trim() }) });
            closeModal("category-modal");
            form.reset();
            showToast("Thêm danh mục thành công.");
            await Promise.all([loadCategories(), loadProducts(), renderCounts(), loadAuditLogs()]);
        } catch (error) {
            const summary = $("#category-form-error");
            summary.textContent = error.message;
            summary.hidden = false;
        } finally {
            setSubmitBusy(button, false, "Lưu danh mục");
        }
    };

    const showConfirm = (title, message, action, options = {}) => {
        $("#confirm-title").textContent = title;
        $("#confirm-message").textContent = message;
        $("#confirm-icon").textContent = options.restore ? "↶" : "!";
        $("#confirm-icon").classList.toggle("confirm-icon--restore", Boolean(options.restore));
        const categoryField = $("#restore-category-field");
        categoryField.hidden = !options.restoreCategory;
        $("#restore-category").value = "";
        $("#restore-category").classList.remove("input-error");
        state.confirmAction = action;
        openModal("confirm-modal", options.restoreCategory ? "#restore-category" : "#confirm-action-btn");
    };

    const deleteProduct = (id) => {
        const product = state.products.find((item) => String(item.id) === String(id));
        showConfirm("Đưa sản phẩm vào thùng rác?", `“${product ? product.name : "Sản phẩm này"}” sẽ ngừng hiển thị trên cửa hàng. Bạn vẫn có thể khôi phục sau.`, async () => {
            await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
            showToast("Sản phẩm đã được chuyển vào thùng rác.");
            await Promise.all([loadProducts(), loadCategories(), renderCounts(), loadAuditLogs()]);
        });
    };

    const restoreProduct = (id) => {
        const product = state.products.find((item) => String(item.id) === String(id));
        showConfirm("Khôi phục sản phẩm?", `“${product ? product.name : "Sản phẩm này"}” sẽ xuất hiện lại trên cửa hàng.`, async () => {
            try {
                await api(`/api/admin/products/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({}) });
                closeModal("confirm-modal");
                showToast("Khôi phục sản phẩm thành công.");
                await Promise.all([loadProducts(), loadCategories(), renderCounts(), loadAuditLogs()]);
            } catch (error) {
                if (/danh mục|category/i.test(error.message)) {
                    closeModal("confirm-modal");
                    showConfirm("Chọn danh mục để khôi phục", "Danh mục gốc đã bị xóa. Vui lòng chọn danh mục mới trước khi khôi phục.", async () => {
                        const categoryId = $("#restore-category").value;
                        if (!categoryId) {
                            $("#restore-category").classList.add("input-error");
                            return;
                        }
                        await api(`/api/admin/products/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ newCategoryId: Number(categoryId) }) });
                        closeModal("confirm-modal");
                        showToast("Khôi phục sản phẩm thành công.");
                        await Promise.all([loadProducts(), loadCategories(), renderCounts(), loadAuditLogs()]);
                    }, { restore: true, restoreCategory: true });
                } else {
                    closeModal("confirm-modal");
                    showToast(error.message, "error");
                }
            }
        }, { restore: true });
    };

    const deleteCategory = (id) => {
        const category = state.categories.find((item) => String(item.id) === String(id));
        showConfirm("Xóa danh mục?", `Bạn có chắc muốn xóa “${category ? category.name : "danh mục này"}”? Danh mục có sản phẩm đang bán sẽ không thể xóa.`, async () => {
            try {
                await api(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
                closeModal("confirm-modal");
                if (String(state.categoryId) === String(id)) state.categoryId = "";
                showToast("Xóa danh mục thành công.");
                await Promise.all([loadCategories(), loadProducts(), renderCounts(), loadAuditLogs()]);
            } catch (error) {
                closeModal("confirm-modal");
                showToast(error.message, "error");
            }
        });
    };

    const resetFilters = () => {
        state.q = "";
        state.categoryId = "";
        $("#product-search").value = "";
        $("#category-filter").value = "";
        $("#clear-filters-btn").hidden = true;
        loadProducts();
    };

    document.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.matches("[data-close-modal]")) closeModal(target.dataset.closeModal);
        if (target.id === "add-product-btn") openProductForm();
        if (target.id === "add-category-btn") { $("#category-form").reset(); clearFormErrors($("#category-form")); openModal("category-modal", "#category-name"); }
        if (target.id === "refresh-products-btn" || target.id === "table-state-action") { loadProducts(); renderCounts(); }
        if (target.id === "refresh-audit-btn") loadAuditLogs();
        if (target.id === "retry-categories") loadCategories();
        if (target.id === "clear-filters-btn") resetFilters();
        if (target.dataset.status) {
            state.status = target.dataset.status;
            $$(".status-tab").forEach((tab) => { const active = tab === target; tab.classList.toggle("is-active", active); tab.setAttribute("aria-selected", String(active)); });
            loadProducts();
        }
        if (target.dataset.categoryFilter) {
            state.categoryId = target.dataset.categoryFilter;
            $("#category-filter").value = state.categoryId;
            $("#clear-filters-btn").hidden = false;
            renderCategories();
            loadProducts();
        }
        if (target.dataset.deleteCategory) deleteCategory(target.dataset.deleteCategory);
        if (target.dataset.editProduct) openProductForm(target.dataset.editProduct);
        if (target.dataset.deleteProduct) deleteProduct(target.dataset.deleteProduct);
        if (target.dataset.restoreProduct) restoreProduct(target.dataset.restoreProduct);
        if (target.id === "confirm-action-btn" && state.confirmAction) {
            const action = state.confirmAction;
            target.disabled = true;
            Promise.resolve(action()).catch((error) => showToast(error.message, "error")).finally(() => { target.disabled = false; });
        }
    });

    $("#product-form").addEventListener("submit", submitProduct);
    $("#category-form").addEventListener("submit", submitCategory);
    $("#category-filter").addEventListener("change", (event) => {
        state.categoryId = event.target.value;
        $("#clear-filters-btn").hidden = !state.categoryId && !state.q;
        renderCategories();
        loadProducts();
    });
    $("#product-search").addEventListener("input", (event) => {
        window.clearTimeout(state.searchTimer);
        $("#search-spinner").hidden = false;
        state.searchTimer = window.setTimeout(() => {
            state.q = event.target.value.trim();
            $("#clear-filters-btn").hidden = !state.categoryId && !state.q;
            loadProducts().finally(() => { $("#search-spinner").hidden = true; });
        }, 200);
    });
    $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") $$(".modal-backdrop:not([hidden])").forEach((modal) => closeModal(modal.id));
    });

    refreshAll();
})();
