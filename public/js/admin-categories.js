/* Danh mục & thẻ: quản trị hai danh sách dùng chung bộ điều khiển AdminKit. */
(() => {
    "use strict";
    const Kit = window.AdminKit;
    const { esc, ic, bar, lockScroll, trapTab } = Kit;
    const PAGE_SIZE = 10;
    const TYPES = {
        categories: { label: "Danh mục", singular: "danh mục", endpoint: "/api/admin/categories" },
        tags: { label: "Thẻ", singular: "thẻ", endpoint: "/api/admin/tags" }
    };
    const num = (value) => Number(value || 0).toLocaleString("vi-VN");

    const mount = (rootEl, { api, toast }) => {
        const state = { tab: "categories", page: { categories: 1, tags: 1 }, list: { categories: null, tags: null }, error: { categories: null, tags: null }, busy: false };
        let sequence = 0;
        let dialog = null;
        rootEl.innerHTML = `<div class="ao at ao-stack">
            <div class="at-heading"><p>Quản lý loại thiết bị và thẻ dùng để tìm sản phẩm trong cửa hàng.</p>
                <button type="button" class="ao-btn ao-btn-primary" data-action="create">Thêm danh mục</button></div>
            <div class="ao-tabs-block"><div class="pd-tabs scrollbar-clean"><div class="status-tabs" role="tablist" aria-label="Danh mục và thẻ">
                <button type="button" class="status-tab" id="at-tab-categories" role="tab" aria-controls="at-panel" data-tab="categories">Danh mục <span class="tab-count" data-count="categories">—</span></button>
                <button type="button" class="status-tab" id="at-tab-tags" role="tab" aria-controls="at-panel" data-tab="tags">Thẻ <span class="tab-count" data-count="tags">—</span></button>
            </div></div></div>
            <section class="ao-card" role="tabpanel" id="at-panel" aria-labelledby="at-tab-categories" tabindex="-1"><div data-slot="list"></div><div data-slot="foot"></div></section>
            <p class="ao-sr" role="status" aria-live="polite" data-slot="live"></p><div data-slot="dialog"></div>
        </div>`;
        const root = rootEl.querySelector(".at");
        const listSlot = root.querySelector('[data-slot="list"]');
        const footSlot = root.querySelector('[data-slot="foot"]');
        const dialogSlot = root.querySelector('[data-slot="dialog"]');
        const liveSlot = root.querySelector('[data-slot="live"]');
        const activeItems = () => state.list[state.tab] || [];
        const spec = () => TYPES[state.tab];
        const say = (text) => { liveSlot.textContent = text; };
        const reason = (row) => `Đang có ${num(row.productCount)} sản phẩm trong danh mục này. Hãy chuyển hoặc xóa các sản phẩm đó trước khi xóa danh mục.`;
        const actionHtml = (row) => {
            const inUse = state.tab === "categories" && row.productCount > 0;
            return `<div class="at-actions"><button type="button" class="ao-btn-sm" data-action="edit" data-id="${Number(row.id)}" aria-label="Sửa ${spec().singular} ${esc(row.name)}">Sửa</button>
            <button type="button" class="ao-btn ao-btn-danger at-delete" data-action="delete" data-id="${Number(row.id)}" aria-label="Xóa ${spec().singular} ${esc(row.name)}" ${inUse ? `disabled title="${esc(reason(row))}"` : ""}>Xóa</button></div>
            ${inUse ? `<p class="at-locked">${ic("lock", "ao-i3")} ${esc(reason(row))}</p>` : ""}`;
        };
        const rowHtml = (row) => `<tr class="ao-tr"><td class="ao-td ao-td-sticky"><strong class="at-name">${esc(row.name)}</strong><span class="at-slug">/${state.tab === "categories" ? "danh-muc" : "the"}/${esc(row.slug)}</span></td>
            ${state.tab === "categories" ? `<td class="ao-td at-number">${num(row.sortOrder)}</td>` : ""}<td class="ao-td at-number">${num(row.productCount)}</td><td class="ao-td ao-td-end">${actionHtml(row)}</td></tr>`;
        const cardHtml = (row) => `<li class="at-card"><div><strong class="at-name">${esc(row.name)}</strong><span class="at-slug">/${state.tab === "categories" ? "danh-muc" : "the"}/${esc(row.slug)}</span></div>
            <p class="at-card-meta">${num(row.productCount)} sản phẩm${state.tab === "categories" ? ` · Thứ tự ${num(row.sortOrder)}` : ""}</p>${actionHtml(row)}</li>`;
        const render = () => {
            for (const type of Object.keys(TYPES)) {
                const tab = root.querySelector(`[data-tab="${type}"]`);
                const on = state.tab === type;
                tab.classList.toggle("is-active", on);
                tab.setAttribute("aria-selected", String(on));
                tab.tabIndex = on ? 0 : -1;
                root.querySelector(`[data-count="${type}"]`).textContent = state.list[type] ? num(state.list[type].length) : "—";
            }
            root.querySelector("#at-panel").setAttribute("aria-labelledby", `at-tab-${state.tab}`);
            root.querySelector('[data-action="create"]').textContent = `Thêm ${spec().singular}`;
            const data = state.list[state.tab];
            const error = state.error[state.tab];
            if (!data && !error) {
                listSlot.innerHTML = `<div class="at-loading" role="status" aria-busy="true"><span class="ao-sr">Đang tải ${spec().singular}</span>${Array.from({ length: 5 }, () => `<div>${bar("11rem", "14px")}${bar("5rem", "12px")}</div>`).join("")}</div>`;
                footSlot.innerHTML = "";
                return;
            }
            if (error) {
                listSlot.innerHTML = `<div class="ao-err" role="alert"><div><p class="ao-err-title">Không tải được ${spec().singular}</p><p class="ao-err-msg">${esc(error.message || "Không thể kết nối. Hãy thử lại.")}</p></div><button type="button" class="ao-btn ao-btn-outline" data-action="retry">Thử lại</button></div>`;
                footSlot.innerHTML = "";
                return;
            }
            if (!data.length) {
                listSlot.innerHTML = `<div class="ao-empty-block"><div><p class="ao-empty-title">Chưa có ${spec().singular} nào</p><p class="ao-empty-desc">Tạo ${spec().singular} đầu tiên để sử dụng trong sản phẩm và bộ lọc cửa hàng.</p></div><button type="button" class="ao-btn ao-btn-primary" data-action="create">Thêm ${spec().singular}</button></div>`;
                footSlot.innerHTML = "";
                return;
            }
            const pages = Math.ceil(data.length / PAGE_SIZE);
            state.page[state.tab] = Math.min(state.page[state.tab], pages);
            const page = state.page[state.tab];
            const items = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            listSlot.innerHTML = `<div class="ao-table-wrap"><table class="ao-table at-table"><caption class="ao-sr">Danh sách ${spec().singular}</caption><thead><tr>
                <th class="ao-th ao-th-sticky" scope="col">Tên và đường dẫn</th>${state.tab === "categories" ? '<th class="ao-th" scope="col">Thứ tự</th>' : ""}<th class="ao-th" scope="col">Sản phẩm</th><th class="ao-th ao-th-end" scope="col">Thao tác</th></tr></thead><tbody>${items.map(rowHtml).join("")}</tbody></table></div>
                <ul class="ao-cards">${items.map(cardHtml).join("")}</ul>`;
            // AdminKit's pager hides page numbers on mobile; this screen keeps the current number visible on every width.
            const start = Math.max(1, Math.min(page - 2, pages - 4));
            const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
            const button = (value, text, disabled, current = false) => `<button type="button" class="ao-pg-num ${current ? "is-on" : ""}" data-page="${value}" ${current ? 'aria-current="page"' : ""} ${disabled ? "disabled" : ""} aria-label="Trang ${value}">${text}</button>`;
            footSlot.innerHTML = `<div class="ao-foot ao-foot-flat"><p class="ao-count">${num(data.length)} ${spec().singular} · Trang ${page}/${pages}</p><nav class="ao-pager at-pager" aria-label="Phân trang ${spec().singular}">
                ${button(page - 1, ic("chevron-left"), page === 1)}${numbers.map((n) => button(n, n, false, n === page)).join("")}${button(page + 1, ic("chevron-right"), page === pages)}</nav></div>`;
        };
        const load = async () => {
            const mine = ++sequence;
            const results = await Promise.allSettled(Object.keys(TYPES).map((type) => api(TYPES[type].endpoint)));
            if (mine !== sequence) return;
            Object.keys(TYPES).forEach((type, index) => {
                const result = results[index];
                if (result.status === "fulfilled" && Array.isArray(result.value?.data)) {
                    state.list[type] = result.value.data;
                    state.error[type] = null;
                } else {
                    state.error[type] = result.status === "rejected" ? result.reason : new Error("Danh sách trả về không hợp lệ.");
                }
            });
            render();
            say(state.error[state.tab] ? `Không tải được ${spec().singular}.` : `Đã tải ${num(activeItems().length)} ${spec().singular}.`);
        };
        const closeDialog = (force = false) => {
            if (!dialog || (state.busy && !force)) return;
            const opener = dialog.opener;
            dialog = null;
            dialogSlot.replaceChildren();
            lockScroll(false);
            if (opener?.isConnected) opener.focus({ preventScroll: true });
        };
        const openDialog = (mode, row, opener) => {
            if (dialog) return;
            dialog = { mode, row, opener };
            const type = state.tab;
            const what = TYPES[type].singular;
            const title = mode === "delete" ? `Xóa ${what}` : `${mode === "create" ? "Thêm" : "Sửa"} ${what}`;
            const form = mode !== "delete";
            const slugHint = mode === "create" ? "Để trống để tạo từ tên; hoặc nhập 2–40 ký tự chữ thường, số và dấu gạch ngang." : type === "categories" && row?.productCount > 0 ? "Đang có sản phẩm: không thể đổi đường dẫn (slug)." : "Slug: 2–40 ký tự chữ thường không dấu, số và dấu gạch ngang.";
            dialogSlot.innerHTML = `<div class="at-overlay"><div class="at-scrim" data-action="close"></div><section class="at-dialog" role="dialog" aria-modal="true" aria-labelledby="at-dialog-title">
                <header class="at-dialog-head"><h2 id="at-dialog-title">${title}</h2><button type="button" class="ao-btn-sm" data-action="close" aria-label="Đóng cửa sổ">Đóng</button></header>
                ${form ? `<form id="at-form" class="at-form" novalidate><p class="at-error" role="alert" hidden></p>
                    <label class="at-field">Tên ${what}<input name="name" class="ao-input" autocomplete="off" maxlength="${type === "categories" ? 80 : 60}" value="${esc(row?.name || "")}" required><small data-error="name"></small></label>
                    <label class="at-field">Đường dẫn (slug)<input name="slug" class="ao-input" autocomplete="off" spellcheck="false" maxlength="40" value="${esc(row?.slug || "")}"><small>${slugHint}</small><small data-error="slug"></small></label>
                    ${type === "categories" ? `<label class="at-field">Thứ tự hiển thị<input name="sortOrder" class="ao-input" type="number" min="0" max="100000" step="1" inputmode="numeric" value="${esc(row?.sortOrder ?? "")}"><small>Để trống khi thêm để xếp sau các danh mục hiện có.</small><small data-error="sortOrder"></small></label>` : ""}
                    <footer class="at-dialog-foot"><button type="button" class="ao-btn ao-btn-secondary" data-action="close">Hủy</button><button type="submit" class="ao-btn ao-btn-primary" data-action="save">${mode === "create" ? "Thêm" : "Lưu"} ${what}</button></footer></form>`
                    : `<div class="at-form"><p>Bạn có chắc muốn xóa <strong>${esc(row.name)}</strong>? ${what === "thẻ" ? "Thẻ sẽ biến mất khỏi tất cả sản phẩm và trang thẻ." : "Danh mục sẽ không xuất hiện trên cửa hàng nữa."}</p>
                    <p class="at-error" role="alert" hidden></p><footer class="at-dialog-foot"><button type="button" class="ao-btn ao-btn-secondary" data-action="close">Hủy</button><button type="button" class="ao-btn ao-btn-danger" data-action="confirm-delete">Xóa ${what}</button></footer></div>`}
                </section></div>`;
            lockScroll(true);
            dialogSlot.querySelector(form ? '[name="name"]' : '[data-action="close"]:not(.at-scrim)').focus();
        };
        const setError = (error) => {
            const banner = dialogSlot.querySelector(".at-error");
            if (!banner) { toast(error?.payload?.error?.message || error.message || "Thao tác không thành công.", "error"); return; }
            banner.textContent = error?.payload?.error?.message || error.message || "Không lưu được. Hãy thử lại.";
            banner.hidden = false;
            const fields = error?.payload?.error?.details?.fields || error.fields || {};
            for (const [name, message] of Object.entries(fields)) {
                const target = dialogSlot.querySelector(`[data-error="${name}"]`);
                if (target) target.textContent = message;
            }
        };
        const save = async (form) => {
            if (state.busy || !dialog) return;
            const { mode, row } = dialog;
            const type = state.tab;
            const name = form.elements.name.value.trim();
            const slug = form.elements.slug.value.trim();
            const sort = type === "categories" ? form.elements.sortOrder.value.trim() : "";
            form.querySelectorAll("[data-error]").forEach((item) => { item.textContent = ""; });
            form.querySelector(".at-error").hidden = true;
            if (!name || name.length > (type === "categories" ? 80 : 60)) { form.querySelector('[data-error="name"]').textContent = "Tên không hợp lệ."; form.elements.name.focus(); return; }
            if ((mode === "edit" && !slug) || (slug && !/^[a-z0-9-]{2,40}$/.test(slug))) { form.querySelector('[data-error="slug"]').textContent = "Slug phải gồm 2–40 chữ thường, số hoặc dấu gạch ngang."; form.elements.slug.focus(); return; }
            if (sort && (!/^\d+$/.test(sort) || Number(sort) > 100000)) { form.querySelector('[data-error="sortOrder"]').textContent = "Thứ tự phải là số nguyên từ 0 đến 100000."; form.elements.sortOrder.focus(); return; }
            const body = { name };
            if (slug || mode === "edit") body.slug = slug;
            if (type === "categories" && sort) body.sortOrder = Number(sort);
            state.busy = true;
            const submit = form.querySelector('[data-action="save"]');
            submit.disabled = true;
            submit.textContent = "Đang lưu…";
            try {
                await api(mode === "edit" ? `${TYPES[type].endpoint}/${row.id}` : TYPES[type].endpoint, { method: mode === "edit" ? "PATCH" : "POST", body });
                state.busy = false;
                closeDialog();
                toast(`${mode === "edit" ? "Đã cập nhật" : "Đã thêm"} ${TYPES[type].singular}.`);
                await load();
            } catch (error) { setError(error); }
            finally { state.busy = false; if (submit.isConnected) { submit.disabled = false; submit.textContent = mode === "edit" ? `Lưu ${TYPES[type].singular}` : `Thêm ${TYPES[type].singular}`; } }
        };
        const remove = async () => {
            if (state.busy || !dialog || dialog.mode !== "delete") return;
            const { row } = dialog;
            const type = state.tab;
            const btn = dialogSlot.querySelector('[data-action="confirm-delete"]');
            state.busy = true;
            btn.disabled = true;
            btn.textContent = "Đang xóa…";
            try {
                await api(`${TYPES[type].endpoint}/${row.id}`, { method: "DELETE" });
                state.busy = false;
                closeDialog();
                toast(`Đã xóa ${TYPES[type].singular}.`);
                await load();
            } catch (error) { setError(error); }
            finally { state.busy = false; if (btn.isConnected) { btn.disabled = false; btn.textContent = `Xóa ${TYPES[type].singular}`; } }
        };
        root.addEventListener("click", (event) => {
            const target = event.target.closest("[data-action], [data-tab], [data-page]");
            if (!target || !root.contains(target)) return;
            if (target.dataset.tab) {
                if (target.dataset.tab === state.tab) return;
                state.tab = target.dataset.tab;
                say(`Đang xem ${spec().singular}.`);
                render();
            } else if (target.dataset.page) {
                const page = Number(target.dataset.page);
                if (target.disabled || !Number.isInteger(page)) return;
                state.page[state.tab] = page;
                render();
                say(`Trang ${page} của ${spec().singular}.`);
                root.querySelector('[data-page][aria-current="page"]').focus({ preventScroll: true });
            } else if (target.dataset.action === "close") closeDialog();
            else if (target.dataset.action === "retry") load();
            else if (target.dataset.action === "confirm-delete") remove();
            else if (target.dataset.action === "create") openDialog("create", null, target);
            else if (["edit", "delete"].includes(target.dataset.action)) {
                const row = activeItems().find((item) => item.id === Number(target.dataset.id));
                if (row && !target.disabled) openDialog(target.dataset.action, row, target);
            }
        });
        root.addEventListener("submit", (event) => {
            if (event.target.id !== "at-form") return;
            event.preventDefault();
            save(event.target);
        });
        root.addEventListener("keydown", (event) => {
            if (dialog) {
                if (event.key === "Escape" && !state.busy) { event.preventDefault(); event.stopPropagation(); closeDialog(); }
                else trapTab(event, dialogSlot.querySelector(".at-dialog"));
                return;
            }
            const tab = event.target.closest('[role="tab"]');
            if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "categories" : event.key === "End" ? "tags" : state.tab === "categories" ? "tags" : "categories";
            state.tab = next;
            render();
            root.querySelector(`[data-tab="${next}"]`).focus();
        });
        document.addEventListener("admin:view", (event) => {
            if (event.detail.view !== "danh-muc-the" && dialog) closeDialog(true);
        });
        render();
        load();
        instance.activate = () => { if (!dialog) load(); };
    };
    const instance = { mount, activate: () => {} };
    window.AdminCategories = instance;
})();
