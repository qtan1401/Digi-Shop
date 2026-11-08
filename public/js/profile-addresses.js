/* Trang hồ sơ: thông tin cá nhân và sổ địa chỉ giao hàng (tối đa 10).
 * Dùng DigiAuth.api (CSRF + làm mới phiên). Chỉ dành cho khách hàng; quản trị viên không thấy các khối này. */
(() => {
    "use strict";

    const PHONE = /^(0|\+84)[0-9]{8,10}$/;
    const MAX = 10;
    const $ = (selector) => document.querySelector(selector);

    const infoForm = $("#profile-info-form");
    const section = $("#profile-addresses");
    if (!infoForm || !section) return;

    const listEl = $("[data-address-list]");
    const statusEl = $("[data-address-status]");
    const countEl = $("[data-address-count]");
    const addBtn = $("[data-address-add]");
    const form = $("[data-address-form]");
    const formTitle = $("[data-address-form-title]");
    const infoStatus = $("[data-info-status]");

    let addresses = [];
    let limit = MAX;
    let editingId = null;
    let confirmingId = null;
    let busy = false;

    const apiError = (error) => error?.payload?.error?.message || error?.message || "Yêu cầu không thành công. Vui lòng thử lại.";

    const setStatus = (message, state = "info", retry) => {
        statusEl.hidden = !message;
        statusEl.dataset.state = state;
        statusEl.textContent = message || "";
        if (message && retry) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "addr-btn";
            button.textContent = "Thử lại";
            button.addEventListener("click", retry);
            statusEl.append(button);
        }
    };

    const setFieldError = (root, field, message) => {
        const input = root.querySelector(`[name="${field}"]`);
        const error = root.querySelector(`[data-field-error="${field}"]`);
        if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
        if (error) error.textContent = message || "";
    };
    const clearErrors = (root) => ["fullName", "recipientName", "phone", "addressLine"].forEach((field) => setFieldError(root, field, ""));

    // ===== Thông tin cá nhân =====
    const loadProfile = async () => {
        try {
            const { data } = await DigiAuth.api("/api/profile");
            infoForm.email.value = data.profile.email || "";
            infoForm.fullName.value = data.profile.fullName || "";
            const points = Number(data.profile.loyaltyPoints) || 0;
            infoForm.points.value = `${points.toLocaleString("vi-VN")} điểm (tương đương ${(points * 1000).toLocaleString("vi-VN")}₫)`;
            infoForm.hidden = false;
        } catch (error) {
            infoForm.hidden = false;
            infoStatus.hidden = false;
            infoStatus.dataset.state = "error";
            infoStatus.textContent = `Không thể tải thông tin cá nhân. ${apiError(error)}`;
        }
    };

    infoForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearErrors(infoForm);
        infoStatus.hidden = true;
        const fullName = infoForm.fullName.value.trim().replace(/\s+/g, " ");
        if (fullName.length < 2) {
            setFieldError(infoForm, "fullName", "Nhập họ và tên (ít nhất 2 ký tự).");
            infoForm.fullName.focus();
            return;
        }
        const submit = infoForm.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const { data } = await DigiAuth.api("/api/profile", { method: "PUT", body: { fullName } });
            infoForm.fullName.value = data.profile.fullName;
            infoStatus.dataset.state = "success";
            infoStatus.textContent = "Đã lưu thông tin cá nhân.";
        } catch (error) {
            infoStatus.dataset.state = "error";
            infoStatus.textContent = apiError(error);
        } finally {
            infoStatus.hidden = false;
            submit.disabled = false;
        }
    });

    // ===== Sổ địa chỉ =====
    const button = (label, className, attrs = {}) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `addr-btn ${className}`.trim();
        element.textContent = label;
        Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
        return element;
    };

    const renderItem = (address) => {
        const item = document.createElement("li");
        item.className = `addr-item${address.isDefault ? " addr-item--default" : ""}`;
        const top = document.createElement("div");
        top.className = "addr-item__top";
        const name = document.createElement("span");
        name.className = "addr-item__name";
        name.textContent = address.recipientName;
        const phone = document.createElement("span");
        phone.className = "addr-item__phone";
        phone.textContent = address.phone;
        top.append(name, phone);
        if (address.isDefault) {
            const badge = document.createElement("span");
            badge.className = "addr-badge";
            badge.textContent = "Mặc định";
            top.append(badge);
        }
        const line = document.createElement("p");
        line.className = "addr-item__line";
        line.textContent = address.addressLine;
        const actions = document.createElement("div");
        actions.className = "addr-item__actions";
        if (confirmingId === address.id) {
            const confirm = document.createElement("div");
            confirm.className = "addr-confirm";
            confirm.setAttribute("role", "alert");
            confirm.append("Xóa địa chỉ này?");
            const yes = button("Xóa", "addr-btn--danger");
            yes.addEventListener("click", () => removeAddress(address.id));
            const no = button("Giữ lại", "");
            no.addEventListener("click", () => { confirmingId = null; render(); });
            confirm.append(yes, no);
            actions.append(confirm);
        } else {
            const edit = button("Sửa", "", { "aria-label": `Sửa địa chỉ của ${address.recipientName}` });
            edit.addEventListener("click", () => openForm(address));
            actions.append(edit);
            if (!address.isDefault) {
                const makeDefault = button("Đặt làm mặc định", "", { "aria-label": `Đặt địa chỉ của ${address.recipientName} làm mặc định` });
                makeDefault.addEventListener("click", () => setDefault(address.id));
                actions.append(makeDefault);
            }
            const del = button("Xóa", "addr-btn--danger", { "aria-label": `Xóa địa chỉ của ${address.recipientName}` });
            del.addEventListener("click", () => { confirmingId = address.id; render(); });
            actions.append(del);
        }
        item.append(top, line, actions);
        return item;
    };

    const render = () => {
        listEl.replaceChildren();
        if (!addresses.length) {
            const empty = document.createElement("li");
            empty.className = "addr-empty";
            empty.textContent = "Bạn chưa lưu địa chỉ nào. Thêm một địa chỉ để điền nhanh khi thanh toán.";
            listEl.append(empty);
        } else {
            addresses.forEach((address) => listEl.append(renderItem(address)));
        }
        countEl.textContent = `Đã lưu ${addresses.length}/${limit} địa chỉ`;
        const full = addresses.length >= limit;
        addBtn.disabled = full && !editingId;
        addBtn.title = full ? `Tối đa ${limit} địa chỉ. Hãy xóa bớt để thêm mới.` : "";
    };

    const loadAddresses = async () => {
        listEl.replaceChildren();
        setStatus("Đang tải địa chỉ…");
        try {
            const { data } = await DigiAuth.api("/api/addresses");
            addresses = data.addresses;
            limit = data.limit || MAX;
            setStatus("");
            render();
        } catch (error) {
            countEl.textContent = "";
            setStatus(`Không thể tải địa chỉ. ${apiError(error)}`, "error", loadAddresses);
        }
    };

    const closeForm = () => { form.hidden = true; editingId = null; form.reset(); clearErrors(form); render(); };

    function openForm(address) {
        editingId = address ? address.id : null;
        confirmingId = null;
        form.reset();
        clearErrors(form);
        formTitle.textContent = address ? "Sửa địa chỉ" : "Thêm địa chỉ mới";
        if (address) {
            form.recipientName.value = address.recipientName;
            form.phone.value = address.phone;
            form.addressLine.value = address.addressLine;
            form.isDefault.checked = address.isDefault;
            form.isDefault.disabled = address.isDefault; // Đổi mặc định bằng cách chọn địa chỉ khác.
        } else {
            form.isDefault.disabled = !addresses.length; // Địa chỉ đầu tiên luôn là mặc định.
            form.isDefault.checked = !addresses.length;
        }
        form.hidden = false;
        render();
        form.recipientName.focus();
    }

    const mutate = async (action, successMessage) => {
        if (busy) return;
        busy = true;
        try {
            await action();
            if (successMessage) setStatus(successMessage, "success");
            return true;
        } catch (error) {
            setStatus(apiError(error), "error");
            // The address is gone (deleted in another tab or on another device): show the book as it really is.
            if (error?.status === 404) {
                confirmingId = null;
                try { await refreshList(); } catch (_) { /* the message above stays */ }
                if (editingId && !addresses.some((address) => address.id === editingId)) { form.hidden = true; editingId = null; render(); }
            }
            return false;
        } finally {
            busy = false;
        }
    };

    const refreshList = async () => {
        const { data } = await DigiAuth.api("/api/addresses");
        addresses = data.addresses;
        limit = data.limit || MAX;
        render();
    };

    const setDefault = (id) => mutate(async () => {
        await DigiAuth.api(`/api/addresses/${encodeURIComponent(id)}/default`, { method: "POST" });
        await refreshList();
    }, "Đã đổi địa chỉ mặc định.");

    const removeAddress = (id) => mutate(async () => {
        await DigiAuth.api(`/api/addresses/${encodeURIComponent(id)}`, { method: "DELETE" });
        confirmingId = null;
        if (editingId === id) { form.hidden = true; editingId = null; }
        await refreshList();
    }, "Đã xóa địa chỉ.");

    addBtn.addEventListener("click", () => openForm(null));
    $("[data-address-cancel]").addEventListener("click", () => { closeForm(); addBtn.focus(); });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearErrors(form);
        const body = {
            recipientName: form.recipientName.value.trim(),
            phone: form.phone.value.trim(),
            addressLine: form.addressLine.value.trim(),
            isDefault: form.isDefault.checked
        };
        let first = null;
        const fail = (field, message) => { setFieldError(form, field, message); first = first || form[field]; };
        if (body.recipientName.length < 2) fail("recipientName", "Nhập họ và tên người nhận (ít nhất 2 ký tự).");
        if (!PHONE.test(body.phone)) fail("phone", "Số điện thoại không hợp lệ (VD: 0901234567 hoặc +84901234567).");
        if (body.addressLine.length < 5) fail("addressLine", "Địa chỉ phải có ít nhất 5 ký tự.");
        if (first) { first.focus(); return; }
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        const editing = Boolean(editingId);
        const ok = await mutate(async () => {
            try {
                if (editing) await DigiAuth.api(`/api/addresses/${encodeURIComponent(editingId)}`, { method: "PUT", body });
                else await DigiAuth.api("/api/addresses", { method: "POST", body });
            } catch (error) {
                const fields = error?.payload?.error?.fields || {};
                ["recipientName", "phone", "addressLine"].forEach((field) => { if (fields[field]) setFieldError(form, field, fields[field]); });
                throw error;
            }
            await refreshList();
        }, editing ? "Đã cập nhật địa chỉ." : "Đã thêm địa chỉ.");
        submit.disabled = false;
        if (ok) { form.hidden = true; editingId = null; form.reset(); render(); addBtn.focus(); }
    });

    // ===== Khởi động =====
    (async () => {
        const session = await DigiAuth.ready;
        if (!session?.authenticated || session.user?.role !== "user") return; // Khách vãng lai đã được chuyển hướng; quản trị viên không có sổ địa chỉ.
        section.hidden = false;
        await Promise.all([loadProfile(), loadAddresses()]);
    })();
})();
