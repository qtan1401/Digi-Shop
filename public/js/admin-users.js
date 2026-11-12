/* NodeShop admin: màn Người dùng (#/nguoi-dung): danh sách khách hàng, tìm, sửa họ tên, khóa / mở khóa.
 * Hợp đồng với khung admin:
 *   AdminUsers.mount(rootEl, { api, toast })   gọi một lần, vẽ cả màn vào rootEl
 *   AdminUsers.activate()                      mở lại màn: tải lại danh sách âm thầm
 * Dữ liệu: GET /api/admin/users?page&pageSize=20&q, PATCH /api/admin/users/:id { fullName? , status? }.
 * Dùng bộ mảnh chung window.AdminKit và class `.ao-*` (admin-orders.css); riêng màn này là `.au-*` (admin-users.css).
 */
(() => {
    "use strict";
    const Kit = window.AdminKit;
    if (!Kit) return;
    const { esc, ic, bar, badge, pagerHtml, lockScroll, trapTab } = Kit;

    const PAGE_SIZE = 20;
    const SEARCH_DELAY = 300;
    const STATUS = {
        ACTIVE: ["s", "Hoạt động", "circle-check"],
        UNVERIFIED: ["w", "Chưa xác minh", "circle-ellipsis"],
        BANNED: ["e", "Đã khóa", "ban"]
    };

    const pad = (n) => String(n).padStart(2, "0");
    const num = (n) => Number(n || 0).toLocaleString("vi-VN");
    const dmy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const statusBadge = (status) => {
        const [tone, label, icon] = STATUS[status] || ["n", status, "circle"];
        return badge(tone, esc(label), icon);
    };
    const displayName = (u) => u.fullName || u.username || u.email || "Khách hàng";

    const mount = (rootEl, options = {}) => {
        const apiCall = options.api || ((url, opts) => window.DigiAuth.api(url, opts));
        const toast = typeof options.toast === "function" ? options.toast : () => {};
        const state = {
            phase: "loading", error: null, users: [], q: "", page: 1, fetching: false,
            meta: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }, busy: new Set()
        };
        let seq = 0;
        let searchTimer = null;
        let dialog = null;

        rootEl.innerHTML = `
            <div class="ao au">
                <div class="ao-stack">
                    <div class="ao-toolbar">
                        <label class="ao-search"><span class="ao-sr">Tìm người dùng</span><input type="search" class="ao-input" placeholder="Tìm theo email, họ tên hoặc username" autocomplete="off" maxlength="100" data-role="search"></label>
                    </div>
                    <section class="ao-card au-card" aria-label="Danh sách khách hàng">
                        <div data-slot="body"></div>
                        <div data-slot="foot"></div>
                    </section>
                </div>
                <p class="ao-sr" role="status" aria-live="polite" data-slot="live"></p>
            </div>`;
        const $ = (name) => rootEl.querySelector(`[data-slot="${name}"]`);
        const slots = { body: $("body"), foot: $("foot"), live: $("live") };
        const searchInput = rootEl.querySelector('[data-role="search"]');
        const live = (msg) => { slots.live.textContent = ""; if (msg) setTimeout(() => { slots.live.textContent = msg; }, 20); };

        // ---------- bảng ----------
        const THEAD = `<thead><tr>
            <th scope="col" class="ao-th ao-th-sticky au-th-email">Email</th>
            <th scope="col" class="ao-th au-th-name">Họ tên</th>
            <th scope="col" class="ao-th">Trạng thái</th>
            <th scope="col" class="ao-th au-num">Số đơn</th>
            <th scope="col" class="ao-th au-num">Điểm</th>
            <th scope="col" class="ao-th">Ngày tạo</th>
            <th scope="col" class="ao-th ao-th-end"><span class="ao-sr">Hành động</span></th></tr></thead>`;
        const actionsHtml = (u, touch = false) => {
            const busy = state.busy.has(u.id);
            const cls = `ao-btn-sm ${touch ? "ao-btn-touch" : ""}`;
            const banned = u.status === "BANNED";
            return `<div class="au-actions">
                <button type="button" class="${cls}" data-role="rename" data-id="${esc(u.id)}" ${busy ? "disabled" : ""} aria-label="Sửa họ tên của ${esc(displayName(u))}">Sửa tên</button>
                <button type="button" class="${cls} ${banned ? "" : "au-danger"}" data-role="${banned ? "unban" : "ban"}" data-id="${esc(u.id)}" ${busy ? "disabled" : ""} aria-label="${banned ? "Mở khóa" : "Khóa"} tài khoản ${esc(displayName(u))}">${banned ? "Mở khóa" : "Khóa"}</button></div>`;
        };
        const rowHtml = (u) => `<tr class="ao-tr au-row ${u.status === "BANNED" ? "is-banned" : ""}" data-row="${esc(u.id)}">
            <td class="ao-td ao-td-sticky au-td-email"><p class="au-email" title="${esc(u.email || "")}">${u.email ? esc(u.email) : '<span class="ao-muted">Chưa có email</span>'}</p>${u.username ? `<p class="au-sub">@${esc(u.username)}</p>` : ""}</td>
            <td class="ao-td au-td-name">${u.fullName ? esc(u.fullName) : '<span class="ao-muted">Chưa đặt</span>'}</td>
            <td class="ao-td">${statusBadge(u.status)}</td>
            <td class="ao-td au-num">${num(u.orderCount)}</td>
            <td class="ao-td au-num">${num(u.loyaltyPoints)}</td>
            <td class="ao-td au-nowrap"><time datetime="${esc(u.createdAt)}">${dmy(new Date(u.createdAt))}</time></td>
            <td class="ao-td ao-td-end">${actionsHtml(u)}</td></tr>`;
        const cardHtml = (u) => `<li class="au-card-item ${u.status === "BANNED" ? "is-banned" : ""}" data-row="${esc(u.id)}">
            <div class="au-card-head"><div class="au-card-who"><p class="au-email">${u.email ? esc(u.email) : "Chưa có email"}</p>
                <p class="au-sub">${u.fullName ? esc(u.fullName) : "Chưa đặt họ tên"}</p></div>${statusBadge(u.status)}</div>
            <dl class="au-card-meta"><div><dt>Số đơn</dt><dd>${num(u.orderCount)}</dd></div><div><dt>Điểm</dt><dd>${num(u.loyaltyPoints)}</dd></div><div><dt>Ngày tạo</dt><dd>${dmy(new Date(u.createdAt))}</dd></div></dl>
            ${actionsHtml(u, true)}</li>`;
        const skRow = (k) => `<tr><td class="ao-td ao-td-sticky">${bar(["11rem", "9rem", "10rem"][k % 3], "12px")}</td><td class="ao-td">${bar("7rem", "12px")}</td><td class="ao-td">${bar("6rem", "24px")}</td><td class="ao-td">${bar("2rem", "12px")}</td><td class="ao-td">${bar("2rem", "12px")}</td><td class="ao-td">${bar("5rem", "12px")}</td><td class="ao-td ao-td-end">${bar("8rem", "32px", "au-sk-sq")}</td></tr>`;
        const skCard = () => `<li class="au-card-item" aria-hidden="true">${bar("10rem", "12px")}${bar("6rem", "12px")}${bar("100%", "32px", "au-sk-sq")}</li>`;

        const emptyHtml = () => (state.q.trim()
            ? `<div class="ao-empty-block"><div><p class="ao-empty-title">Không có khách hàng nào khớp</p><p class="ao-empty-desc">Không tìm thấy “${esc(state.q.trim())}” theo email, họ tên hay username.</p></div><button type="button" class="ao-linkbtn" data-role="clear-search">Xóa tìm kiếm</button></div>`
            : '<div class="ao-empty-block"><div><p class="ao-empty-title">Chưa có khách hàng nào</p><p class="ao-empty-desc">Tài khoản khách hàng sẽ hiện ở đây sau khi có người đăng ký hoặc đặt hàng.</p></div></div>');
        const errorHtml = () => {
            const net = !state.error || !state.error.status;
            return `<div role="alert" class="ao-err"><div><p class="ao-err-title">Không tải được danh sách người dùng</p><p class="ao-err-msg">${net ? "Mất kết nối tới máy chủ" : "Máy chủ gặp lỗi, thử lại sau ít phút"}</p></div>
                <button type="button" class="ao-btn ao-btn-outline" data-role="retry">${ic("rotate-cw", "ao-i4 ao-shrink")}Thử lại</button></div>`;
        };
        const renderBody = () => {
            slots.body.classList.toggle("is-fetching", state.fetching && state.phase === "ready");
            if (state.phase === "loading") {
                slots.body.innerHTML = `<div aria-busy="true"><div class="ao-table-wrap"><table class="ao-table au-table">${THEAD}<tbody>${Array.from({ length: 8 }, (_, k) => skRow(k)).join("")}</tbody></table></div>
                    <ul class="ao-cards">${Array.from({ length: 5 }, skCard).join("")}</ul><span class="ao-sr" role="status">Đang tải danh sách người dùng</span></div>`;
                return;
            }
            if (state.phase === "error") { slots.body.innerHTML = `<div class="ao-err-top">${errorHtml()}</div>`; return; }
            if (!state.users.length) { slots.body.innerHTML = `<div class="ao-table-wrap"><table class="ao-table au-table">${THEAD}</table></div><div class="ao-err-top">${emptyHtml()}</div>`; return; }
            slots.body.innerHTML = `<div class="ao-table-wrap ao-fade-r"><table class="ao-table au-table">${THEAD}<tbody>${state.users.map(rowHtml).join("")}</tbody></table></div>
                <ul class="ao-cards">${state.users.map(cardHtml).join("")}</ul>`;
        };
        const renderFoot = () => {
            if (state.phase === "loading") { slots.foot.innerHTML = `<div class="ao-foot-sk-row">${bar("10rem", "12px")}${bar("6rem", "12px")}</div>`; return; }
            if (state.phase === "error" || !state.users.length) { slots.foot.innerHTML = ""; return; }
            const { page, pageSize, total, totalPages } = state.meta;
            const from = (page - 1) * pageSize + 1;
            const to = Math.min(total, page * pageSize);
            slots.foot.innerHTML = `<div class="ao-foot ao-foot-flat"><p class="ao-count">${num(from)} tới ${num(to)} trong ${num(total)} khách hàng</p><div class="ao-foot-nav">${pagerHtml(page, totalPages)}</div></div>`;
        };
        const renderAll = () => { renderBody(); renderFoot(); };

        // ---------- tải dữ liệu ----------
        const listUrl = () => {
            const params = new URLSearchParams({ page: String(state.page), pageSize: String(PAGE_SIZE) });
            if (state.q.trim()) params.set("q", state.q.trim());
            return `/api/admin/users?${params}`;
        };
        const load = async ({ quiet = false } = {}) => {
            const mine = ++seq;
            state.error = null;
            if (!quiet || state.phase !== "ready") { state.phase = "loading"; renderAll(); } else { state.fetching = true; renderBody(); }
            try {
                const payload = await apiCall(listUrl(), { method: "GET" });
                if (mine !== seq) return;
                state.users = Array.isArray(payload && payload.data) ? payload.data : [];
                const meta = (payload && payload.meta) || {};
                state.meta = { page: Number(meta.page) || 1, pageSize: Number(meta.pageSize) || PAGE_SIZE, total: Number(meta.total) || 0, totalPages: Math.max(1, Number(meta.totalPages) || 1) };
                state.page = state.meta.page;
                state.phase = "ready";
                state.fetching = false;
                renderAll();
                live(`${num(state.meta.total)} khách hàng`);
            } catch (error) {
                if (mine !== seq) return;
                state.fetching = false;
                if (quiet && state.phase === "ready") { renderBody(); toast("Không tải lại được danh sách. Thử lại sau.", "error"); return; }
                state.phase = "error";
                state.error = error;
                renderAll();
            }
        };

        // ---------- hộp thoại (xác nhận khóa / mở khóa, sửa họ tên) ----------
        const closeDialog = (restore = true) => {
            if (!dialog) return;
            const { el, opener } = dialog;
            dialog = null;
            el.removeAttribute("data-open");
            lockScroll(false);
            if (restore && opener && document.contains(opener)) opener.focus({ preventScroll: true });
            setTimeout(() => el.remove(), 120);
        };
        const openDialog = ({ title, bodyHtml, confirmLabel, danger, opener, onConfirm, field }) => {
            if (dialog) return;
            const uid = `au-dlg-${Math.random().toString(36).slice(2, 7)}`;
            const el = document.createElement("div");
            el.className = "ao-modal";
            el.innerHTML = `<div class="ao-modal-scrim"></div>
                <form class="ao-modal-box" role="alertdialog" aria-modal="true" aria-labelledby="${uid}-t" aria-describedby="${uid}-d" novalidate>
                    <div class="ao-modal-head">
                        <div class="ao-modal-icon ${danger ? "" : "au-icon-neutral"}">${ic(danger ? "ban" : "lock", `ao-i5 ${danger ? "ao-text-danger" : ""}`)}</div>
                        <h2 id="${uid}-t">${esc(title)}</h2>
                        <div class="ao-modal-desc" id="${uid}-d">${bodyHtml}</div>
                    </div>
                    <p class="au-dlg-error" role="alert" data-role="error" hidden></p>
                    <div class="ao-modal-actions">
                        <button type="button" class="ao-btn ao-btn-secondary" data-role="cancel">Hủy</button>
                        <button type="submit" class="ao-btn ${danger ? "ao-btn-danger" : "ao-btn-primary"}" data-role="confirm">${esc(confirmLabel)}</button>
                    </div></form>`;
            rootEl.querySelector(".ao").appendChild(el);
            const form = el.querySelector("form");
            const cancel = el.querySelector('[data-role="cancel"]');
            const confirm = el.querySelector('[data-role="confirm"]');
            const error = el.querySelector('[data-role="error"]');
            const input = field ? el.querySelector("input") : null;
            let busy = false;
            const setBusy = (b) => { busy = b; cancel.disabled = b; confirm.disabled = b; confirm.textContent = b ? "Đang lưu…" : confirmLabel; };
            dialog = { el, opener, cancel: () => { if (!busy) closeDialog(); } };
            cancel.addEventListener("click", () => dialog && dialog.cancel());
            el.querySelector(".ao-modal-scrim").addEventListener("click", () => dialog && dialog.cancel());
            form.addEventListener("keydown", (e) => trapTab(e, form));
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                if (busy) return;
                error.hidden = true;
                let value;
                if (input) {
                    value = input.value.trim().replace(/\s+/g, " ");
                    if (value.length < 2 || value.length > 200) { error.textContent = "Họ và tên phải có 2-200 ký tự."; error.hidden = false; input.focus(); return; }
                }
                setBusy(true);
                const failure = await onConfirm(value);
                if (failure) { setBusy(false); error.textContent = failure; error.hidden = false; return; }
                closeDialog();
            });
            lockScroll(true);
            requestAnimationFrame(() => { el.setAttribute("data-open", ""); (input || cancel).focus(); });
        };

        const failMessage = (error) => {
            if (error && error.code === "CANNOT_MODIFY_ADMIN") return "Không thể sửa hoặc khóa tài khoản quản trị.";
            if (error && error.code === "USER_NOT_FOUND") return "Không tìm thấy người dùng này. Danh sách sẽ được tải lại.";
            if (error && error.code === "VALIDATION_FAILED") return error.message || "Dữ liệu không hợp lệ.";
            if (!error || !error.status) return "Mất kết nối tới máy chủ. Thử lại sau.";
            return "Không lưu được thay đổi. Thử lại sau.";
        };
        const patch = async (id, body) => {
            state.busy.add(id);
            renderBody();
            try {
                const payload = await apiCall(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body });
                const next = payload && payload.data;
                const i = state.users.findIndex((u) => u.id === id);
                if (next && i >= 0) state.users[i] = next;
                return null;
            } catch (error) {
                if (error && (error.code === "USER_NOT_FOUND")) load({ quiet: true });
                return failMessage(error);
            } finally {
                state.busy.delete(id);
                renderBody();
            }
        };

        const askBan = (u, opener) => openDialog({
            title: "Khóa tài khoản này?", danger: true, confirmLabel: "Khóa tài khoản", opener,
            bodyHtml: `<p><span class="ao-strong">${esc(displayName(u))}</span> (${esc(u.email || "không có email")}) sẽ bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho tới khi bạn mở khóa. Đơn đã đặt vẫn giữ nguyên.</p>`,
            onConfirm: async () => {
                const failure = await patch(u.id, { status: "BANNED" });
                if (!failure) { toast(`Đã khóa tài khoản ${displayName(u)}`, "success"); live(`Đã khóa tài khoản ${displayName(u)}`); }
                return failure;
            }
        });
        const askUnban = (u, opener) => openDialog({
            title: "Mở khóa tài khoản này?", danger: false, confirmLabel: "Mở khóa", opener,
            bodyHtml: `<p><span class="ao-strong">${esc(displayName(u))}</span> (${esc(u.email || "không có email")}) sẽ đăng nhập lại được. Phiên cũ không được khôi phục.</p>`,
            onConfirm: async () => {
                const failure = await patch(u.id, { status: "ACTIVE" });
                if (!failure) { toast(`Đã mở khóa tài khoản ${displayName(u)}`, "success"); live(`Đã mở khóa tài khoản ${displayName(u)}`); }
                return failure;
            }
        });
        const askRename = (u, opener) => openDialog({
            title: "Sửa họ tên", danger: false, confirmLabel: "Lưu", opener, field: true,
            bodyHtml: `<label class="au-field"><span>Họ và tên</span><input type="text" class="ao-input" minlength="2" maxlength="200" autocomplete="off" value="${esc(u.fullName || "")}"></label>`,
            onConfirm: async (value) => {
                if (value === (u.fullName || "")) return null;
                const failure = await patch(u.id, { fullName: value });
                if (!failure) { toast("Đã lưu họ tên", "success"); live("Đã lưu họ tên"); }
                return failure;
            }
        });

        // ---------- sự kiện ----------
        searchInput.addEventListener("input", () => {
            state.q = searchInput.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { state.page = 1; load({ quiet: true }); }, SEARCH_DELAY);
        });
        slots.body.addEventListener("click", (e) => {
            const target = e.target.closest("[data-role]");
            if (!target) return;
            const role = target.dataset.role;
            if (role === "retry") { load(); return; }
            if (role === "clear-search") { state.q = ""; searchInput.value = ""; state.page = 1; load({ quiet: true }); return; }
            const user = state.users.find((u) => u.id === target.dataset.id);
            if (!user || target.disabled) return;
            if (role === "ban") askBan(user, target);
            else if (role === "unban") askUnban(user, target);
            else if (role === "rename") askRename(user, target);
        });
        slots.foot.addEventListener("click", (e) => {
            const b = e.target.closest("[data-page]");
            if (!b || b.disabled) return;
            state.page = Number(b.dataset.page);
            load({ quiet: true });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && dialog) { e.preventDefault(); dialog.cancel(); }
        });

        instance.activate = () => { if (state.phase === "ready") load({ quiet: true }); };
        load();
    };

    const instance = { mount, activate: () => {} };
    window.AdminUsers = instance;
})();
