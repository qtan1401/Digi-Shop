/* ===== ADMIN CATALOG DASHBOARD ===== */
(() => {
    "use strict";

    const state = {
        status: "active",
        q: "",
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

    const setFeedback = (message, type = "error") => {
        const element = $("#global-feedback");
        element.className = `admin-feedback admin-feedback--${type}`;
        element.textContent = message;
        element.hidden = !message;
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
            productSummary.textContent = state.q ? "0 kết quả" : state.status === "deleted" ? "Thùng rác trống" : "Chưa có sản phẩm";
            renderTableState("empty", state.q
                ? "Không tìm thấy sản phẩm nào khớp với từ khóa. Thử tìm kiếm theo tên khác hoặc đặt lại bộ lọc."
                : state.status === "deleted" ? "Thùng rác trống. Không có sản phẩm nào bị xóa." : "Chưa có sản phẩm nào", state.q ? "Đặt lại bộ lọc" : "Thêm sản phẩm ngay");
            return;
        }
        productSummary.textContent = `Hiển thị ${products.length} sản phẩm${state.q ? " phù hợp" : ""}`;
        productRegion.innerHTML = `<table class="product-table"><caption class="sr-only">Danh sách sản phẩm</caption><thead><tr>
            <th scope="col">Sản phẩm</th><th scope="col">SKU</th><th scope="col">Thương hiệu</th><th scope="col">Loại thiết bị</th><th scope="col">Giá</th><th scope="col">Tồn kho</th>${state.status === "deleted" ? "<th scope=\"col\">Ngày xóa</th>" : ""}<th scope="col"><span class="sr-only">Thao tác</span></th>
        </tr></thead><tbody>${products.map((product) => {
            const deleted = Boolean(product.isDeleted);
            return `<tr class="${deleted ? "is-deleted" : ""}">
                <td><div class="product-cell"><img src="${escapeHtml(product.image || "")}" alt="" loading="lazy" onerror="this.classList.add('is-broken')"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || "")}</small></div></div></td>
                <td><code class="sku-badge">${escapeHtml(product.sku)}</code></td>
                <td>${escapeHtml(product.brand)}</td>
                <td>${escapeHtml(product.deviceType)}</td>
                <td class="price-cell">${formatPrice(product.price)}</td>
                <td><span class="stock-pill ${Number(product.stock) <= 0 ? "stock-pill--empty" : Number(product.stock) <= 5 ? "stock-pill--low" : ""}">${escapeHtml(product.stock)}</span></td>
                ${state.status === "deleted" ? `<td class="date-cell">${formatDate(product.deletedAt)}</td>` : ""}
                <td class="row-actions">${deleted ? `<button type="button" class="table-action table-action--restore" data-restore-product="${escapeHtml(product.id)}">Khôi phục</button>` : `<button type="button" class="table-action" data-edit-product="${escapeHtml(product.id)}">Sửa</button><button type="button" class="table-action table-action--danger" data-delete-product="${escapeHtml(product.id)}">Xóa</button>`}</td>
            </tr>`;
        }).join("")}</tbody></table>`;
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
        await Promise.all([loadProducts(), renderCounts(), loadAuditLogs()]);
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
            name: $("#product-name").value.trim(), sku: $("#product-sku").value.trim(),
            brand: $("#product-brand").value, deviceType: $("#product-device-type").value,
            price: $("#product-price").value, stock: $("#product-stock").value, image: $("#product-image").value.trim(), description: $("#product-description").value.trim()
        };
        const errors = {};
        if (!fields.name) errors.name = "Vui lòng nhập tên sản phẩm.";
        if (!fields.brand) errors.brand = "Vui lòng chọn thương hiệu.";
        if (!fields.deviceType) errors.deviceType = "Vui lòng chọn loại thiết bị.";
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
        openModal("product-modal", id ? "#product-name" : "#product-name");
        if (!id) return;
        try {
            const payload = await api(`/api/admin/products/${encodeURIComponent(id)}`);
            const product = payload.data || {};
            $("#product-name").value = product.name || "";
            $("#product-sku").value = product.sku || "";
            $("#product-brand").value = product.brand || "";
            $("#product-device-type").value = product.deviceType || "";
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
        const body = { name: values.name, brand: values.brand, deviceType: values.deviceType, price: Number(values.price), stock: Number(values.stock), image: values.image, description: values.description };
        if (!state.editingId) body.sku = values.sku;
        try {
            const endpoint = state.editingId ? `/api/admin/products/${encodeURIComponent(state.editingId)}` : "/api/admin/products";
            await api(endpoint, { method: state.editingId ? "PUT" : "POST", body });
            closeModal("product-modal");
            showToast(state.editingId ? "Cập nhật sản phẩm thành công." : "Thêm sản phẩm thành công.");
            await Promise.all([loadProducts(), renderCounts(), loadAuditLogs()]);
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
            await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
            showToast("Sản phẩm đã được chuyển vào thùng rác.");
            await Promise.all([loadProducts(), renderCounts(), loadAuditLogs()]);
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
        $("#product-search").value = "";
        $("#clear-filters-btn").hidden = true;
        loadProducts();
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
        if (target.id === "refresh-products-btn" || target.id === "table-state-action") { loadProducts(); renderCounts(); }
        if (target.id === "refresh-audit-btn") loadAuditLogs();
        if (target.id === "clear-filters-btn") resetFilters();
        if (target.dataset.status) {
            state.status = target.dataset.status;
            $$(".status-tab").forEach((tab) => { const active = tab === target; tab.classList.toggle("is-active", active); tab.setAttribute("aria-selected", String(active)); });
            loadProducts();
        }
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
    $("#product-search").addEventListener("input", (event) => {
        window.clearTimeout(state.searchTimer);
        $("#search-spinner").hidden = false;
        state.searchTimer = window.setTimeout(() => {
            state.q = event.target.value.trim();
            $("#clear-filters-btn").hidden = !state.q;
            loadProducts().finally(() => { $("#search-spinner").hidden = true; });
        }, 200);
    });
    $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") $$(".modal-backdrop:not([hidden])").forEach((modal) => closeModal(modal.id));
    });

    const bootAdmin = async () => {
        const current = await (window.DigiAuth?.ready || Promise.resolve({ authenticated: false }));
        if (!current.authenticated) { window.location.assign("/403.html?context=admin"); return; }
        if (current.user?.role !== "admin") { window.location.assign("/403.html?context=admin"); return; }
        if (current.user.forcePasswordChange) { window.location.assign("/profile.html?force=1"); return; }
        initAdminAccountForm();
        $(".admin-shell").hidden = false;
        refreshAll();
    };
    bootAdmin();
})();
