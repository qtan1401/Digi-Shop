/* NodeShop admin: màn Voucher, phương án A (bảng theo trạng thái + modal tạo/sửa).
 * Hợp đồng với khung admin:
 *   AdminVouchers.mount(rootEl, { api, toast })   gọi một lần, vẽ cả màn vào rootEl
 *   AdminVouchers.activate()                      mở lại màn: tải lại danh sách âm thầm
 * api(url, options) = DigiAuth.api (ném Error có .code/.status/.payload); toast(message, 'success'|'error'|'info').
 * Dữ liệu: GET/POST /api/admin/vouchers, GET/PUT/DELETE /api/admin/vouchers/:id.
 * Dùng bộ mảnh chung window.AdminKit và class `.ao-*` (admin-orders.css); riêng màn này là `.av-*` (admin-vouchers.css).
 */
(() => {
    "use strict";
    const Kit = window.AdminKit;
    if (!Kit) return;
    const { esc, vnd, ic, bar, badge, pagerHtml, createSelect, lockScroll, trapTab } = Kit;

    const PAGE_SIZE = 100;
    const TABS = ["ALL", "active", "scheduled", "expired", "exhausted", "disabled"];
    const STATUS_LABEL = { active: "Đang chạy", scheduled: "Sắp diễn ra", expired: "Hết hạn", exhausted: "Hết lượt", disabled: "Đã tắt" };
    const STATUS_TONE = { active: ["s", "circle-check"], scheduled: ["n", "calendar-clock"], expired: ["n", "calendar-x"], exhausted: ["w", "package-x"], disabled: ["n", "ban"] };
    const tabLabel = (k) => (k === "ALL" ? "Tất cả" : STATUS_LABEL[k]);
    const DAY = 864e5;
    const MAX_DISCOUNT = 500000;
    const MIN_MAX_DISCOUNT = 1000;
    const MAX_QUANTITY = 1000000;
    // Tên trường API → tên ô trong form
    const FIELD_OF = { code: "code", description: "desc", percent: "percent", maxDiscount: "max", startsAt: "start", endsAt: "end", quantity: "qty" };

    // ---------- tiện ích ----------
    const pad = (n) => String(n).padStart(2, "0");
    const num = (n) => Number(n || 0).toLocaleString("vi-VN");
    const dm = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    const dmy = (d) => `${dm(d)}/${d.getFullYear()}`;
    const toLocalInput = (iso) => {
        const d = new Date(iso);
        if (!iso || Number.isNaN(d.getTime())) return "";
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const range = (v) => {
        const s = new Date(v.startsAt);
        const e = new Date(v.endsAt);
        return s.getFullYear() === e.getFullYear() ? `${dm(s)} – ${dmy(e)}` : `${dmy(s)} – ${dmy(e)}`;
    };
    const apiError = (error) => {
        const detail = (error && error.payload && error.payload.error) || {};
        return { code: error && error.code, status: error && error.status, message: detail.message || "", details: Array.isArray(detail.details) ? detail.details : [] };
    };
    const offerMain = (v) => (v.type === "PERCENT" ? `Giảm ${v.percent}%` : "Miễn phí vận chuyển");
    const offerSub = (v) => (v.type === "PERCENT" ? `Tối đa ${vnd(v.maxDiscount)}` : "Bằng phí vận chuyển");
    const isLocked = (v) => Boolean(v && v.redeemedCount > 0);
    const stBadge = (s) => badge(STATUS_TONE[s][0], esc(STATUS_LABEL[s]), STATUS_TONE[s][1]);

    const relHtml = (v, now) => {
        if (v.status === "expired") return '<span class="ao-muted">Đã kết thúc</span>';
        if (v.status === "scheduled") return `<span class="ao-muted">Bắt đầu sau ${Math.max(1, Math.ceil((new Date(v.startsAt) - now) / DAY))} ngày</span>`;
        const d = Math.max(1, Math.ceil((new Date(v.endsAt) - now) / DAY));
        return v.status === "active" && d <= 3
            ? `<span class="av-soon">${ic("clock", "ao-i3")}Còn ${d} ngày</span>`
            : `<span class="ao-muted">Còn ${d} ngày</span>`;
    };
    const listedHtml = (v) => `<span class="av-listed ${v.isListed ? "" : "ao-muted"}" title="${v.isListed ? "Khách thấy mã này trong danh sách chọn mã" : "Chỉ khách nhập đúng mã mới dùng được"}">${ic(v.isListed ? "eye" : "eye-off", "ao-i4 ao-muted")}${v.isListed ? "Công khai" : "Chỉ nhập mã"}</span>`;
    const usageHtml = (v, cls = "") => {
        const pct = Math.min(100, Math.round((v.redeemedCount / Math.max(1, v.quantity)) * 100));
        return `<div class="av-usage ${cls}"><p class="av-usage-n"><span class="av-usage-used">${num(v.redeemedCount)}</span><span class="ao-muted"> / ${num(v.quantity)}</span></p>
            <div role="progressbar" aria-label="Đã dùng ${v.redeemedCount} trên ${v.quantity} lượt" aria-valuemin="0" aria-valuemax="${v.quantity}" aria-valuenow="${v.redeemedCount}" class="av-meter"><div class="av-meter-fill ${v.redeemedCount >= v.quantity ? "is-full" : ""}" style="width:${pct}%"></div></div></div>`;
    };
    const switchHtml = (v, busy) => `<label class="ao-switch"><input type="checkbox" role="switch" class="ao-switch-input" data-role="toggle" data-id="${v.id}" aria-label="Bật voucher ${esc(v.code)}" ${v.isEnabled ? "checked" : ""} ${busy ? "disabled" : ""}><span class="ao-switch-track" aria-hidden="true"></span><span class="ao-switch-thumb" aria-hidden="true"></span></label>`;
    const codeBtn = (v, cls = "") => `<button type="button" class="av-code ${cls}" data-role="edit" data-id="${v.id}" title="Sửa voucher ${esc(v.code)}">${esc(v.code)}</button>`;

    const mount = (rootEl, options = {}) => {
        const apiCall = options.api || ((url, opts) => window.DigiAuth.api(url, opts));
        const toast = typeof options.toast === "function" ? options.toast : () => {};
        const state = {
            phase: "loading", error: null, list: [], meta: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 },
            counts: null, tab: "ALL", q: "", page: 1, fetching: false, busy: new Set(), now: Date.now(),
        };
        let seq = 0;
        let searchTimer = null;
        let formState = null;
        let confirmState = null;

        rootEl.innerHTML = `
            <div class="ao av">
                <div class="ao-stack" data-slot="page">
                    <div class="ao-tabs-block" data-slot="tabs"></div>
                    <div class="ao-toolbar">
                        <label class="ao-search"><span class="ao-sr">Tìm voucher</span><input type="search" class="ao-input" placeholder="Tìm theo mã hoặc mô tả" autocomplete="off" data-role="search"></label>
                        <button type="button" class="ao-btn ao-btn-primary av-create" data-role="create">Tạo voucher</button>
                    </div>
                    <section class="ao-card av-card" aria-label="Danh sách voucher">
                        <div data-slot="body"></div>
                        <div data-slot="foot"></div>
                    </section>
                </div>
                <p class="ao-sr" role="status" aria-live="polite" data-slot="live"></p>
            </div>`;
        const $ = (name) => rootEl.querySelector(`[data-slot="${name}"]`);
        const slots = { page: $("page"), tabs: $("tabs"), body: $("body"), foot: $("foot"), live: $("live") };
        const root = rootEl.querySelector(".ao");
        const searchInput = rootEl.querySelector('[data-role="search"]');
        const createBtn = rootEl.querySelector('[data-role="create"]');
        const live = (msg) => { slots.live.textContent = ""; if (msg) setTimeout(() => { slots.live.textContent = msg; }, 20); };

        // ---------- bộ lọc trạng thái ----------
        const countOf = (k) => (state.counts ? state.counts[k] : undefined);
        const statusSelect = createSelect({
            label: "Lọc theo trạng thái", size: "lg",
            getValueHtml: (v) => `<span class="ao-muted">Trạng thái:</span> ${tabLabel(v)}${countOf(v) !== undefined ? ` · ${num(countOf(v))}` : ""}`,
            getGroups: () => [TABS.map((k) => ({ value: k, html: tabLabel(k), hint: countOf(k) !== undefined ? num(countOf(k)) : "" }))],
            onSelect: (v) => { state.tab = v; onFilterChange(); },
        });
        statusSelect.setValue("ALL");

        const renderTabs = () => {
            const countHtml = (k) => {
                if (state.counts) return `<span class="tab-count">${num(state.counts[k])}</span>`;
                return state.phase === "loading" ? '<span class="ao-tab-sk"></span>' : "";
            };
            slots.tabs.innerHTML = `<div class="ao-tabs-wide"><div class="ao-fade ao-fade-x scrollbar-clean"><div class="status-tabs" role="tablist" aria-label="Lọc theo trạng thái">${TABS.map((k) => {
                const on = k === state.tab;
                return `<button type="button" role="tab" id="av-tab-${k}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${k}" class="status-tab ${on ? "is-active" : ""}">${tabLabel(k)}${countHtml(k)}</button>`;
            }).join("")}</div></div></div><div class="ao-tabs-narrow" data-slot="tabs-select"></div>`;
            slots.tabs.querySelector('[data-slot="tabs-select"]').append(statusSelect.el);
            statusSelect.setValue(state.tab);
        };

        // ---------- bảng ----------
        const THEAD = `<thead><tr>
            <th scope="col" class="ao-th ao-th-sticky av-th-code">Mã và mô tả</th>
            <th scope="col" class="ao-th av-th-offer">Ưu đãi</th>
            <th scope="col" class="ao-th av-th-range">Hiệu lực</th>
            <th scope="col" class="ao-th av-th-usage">Đã dùng</th>
            <th scope="col" class="ao-th av-col-listed">Hiển thị</th>
            <th scope="col" class="ao-th av-th-status">Trạng thái</th>
            <th scope="col" class="ao-th ao-th-end">Bật</th></tr></thead>`;
        const rowHtml = (v) => `<tr class="ao-tr">
            <td class="ao-td ao-td-sticky av-td-code"><div class="av-code-line">${codeBtn(v)}${v.isListed ? "" : `<span class="av-hidden-mark">${ic("eye-off", "ao-i3 ao-muted")}<span class="ao-sr">Chỉ nhập mã</span></span>`}</div>
                <p class="av-desc" title="${esc(v.description)}">${esc(v.description)}</p></td>
            <td class="ao-td av-nowrap"><p class="av-strong">${offerMain(v)}</p><p class="av-sub">${offerSub(v)}</p></td>
            <td class="ao-td av-nowrap"><p class="av-tnum">${range(v)}</p><p class="av-sub">${relHtml(v, state.now)}</p></td>
            <td class="ao-td">${usageHtml(v)}</td>
            <td class="ao-td av-col-listed">${listedHtml(v)}</td>
            <td class="ao-td av-nowrap">${stBadge(v.status)}</td>
            <td class="ao-td ao-td-end"><div class="av-switch-cell">${switchHtml(v, state.busy.has(v.id))}</div></td></tr>`;
        const cardHtml = (v) => `<li class="av-card-item">
            <div class="av-card-top">${codeBtn(v, "av-code-block")}${stBadge(v.status)}</div>
            <p class="av-card-desc">${esc(v.description)}</p>
            <div class="av-card-offer"><span class="av-strong">${offerMain(v)}</span><span class="av-sub av-tnum">${range(v)}</span></div>
            <div class="av-card-bottom">${usageHtml(v, "av-usage-wide")}<div class="av-card-end">${v.isListed ? "" : '<span class="av-sub">Chỉ nhập mã</span>'}${switchHtml(v, state.busy.has(v.id))}</div></div></li>`;
        const skRow = (k) => `<tr><td class="ao-td ao-td-sticky">${bar(["7rem", "9rem", "6rem", "8rem"][k % 4], "12px")}<div class="av-sk-gap">${bar("12rem", "12px")}</div></td>
            <td class="ao-td">${bar("6rem", "12px")}<div class="av-sk-gap">${bar("5rem", "12px")}</div></td>
            <td class="ao-td">${bar("8rem", "12px")}<div class="av-sk-gap">${bar("4rem", "12px")}</div></td>
            <td class="ao-td">${bar("4rem", "12px")}<div class="av-sk-gap">${bar("7rem", "4px")}</div></td>
            <td class="ao-td av-col-listed">${bar("5rem", "12px")}</td>
            <td class="ao-td">${bar("6rem", "24px")}</td><td class="ao-td ao-td-end"><div class="av-switch-cell">${bar("44px", "24px")}</div></td></tr>`;
        const skCard = () => `<li class="av-card-item" aria-hidden="true"><div class="av-card-top">${bar("8rem", "12px")}${bar("6rem", "24px")}</div>${bar("14rem", "12px")}<div class="av-card-offer">${bar("7rem", "12px")}${bar("8rem", "12px")}</div><div class="av-card-bottom">${bar("8rem", "24px")}${bar("44px", "24px")}</div></li>`;

        const filtered = () => state.tab !== "ALL" || state.q.trim() !== "";
        const emptyHtml = () => {
            if (!filtered()) {
                return `<div class="ao-empty-block"><div><p class="ao-empty-title">Chưa có voucher nào</p><p class="ao-empty-desc">Tạo voucher đầu tiên để khách có mã giảm giá hoặc miễn phí vận chuyển khi thanh toán.</p></div><button type="button" class="ao-btn ao-btn-primary" data-role="create">Tạo voucher đầu tiên</button></div>`;
            }
            const q = state.q.trim();
            const label = state.tab === "ALL" ? "" : ` ${STATUS_LABEL[state.tab].toLowerCase()}`;
            const desc = q ? `Không có voucher${label} nào chứa “${esc(q)}”.` : `Chưa có voucher${label} nào.`;
            return `<div class="ao-empty-block"><div><p class="ao-empty-title">Không có voucher nào khớp</p><p class="ao-empty-desc">${desc}</p></div><button type="button" class="ao-linkbtn" data-role="clear-filter">Xoá lọc</button></div>`;
        };
        const errorHtml = () => {
            const net = !state.error || !state.error.status;
            return `<div role="alert" class="ao-err"><div><p class="ao-err-title">Không tải được danh sách voucher</p><p class="ao-err-msg">${net ? "Mất kết nối tới máy chủ" : "Máy chủ gặp lỗi, thử lại sau ít phút"}</p></div>
                <button type="button" class="ao-btn ao-btn-outline" data-role="retry">${ic("rotate-cw", "ao-i4 ao-shrink")}Thử lại</button></div>`;
        };
        const renderBody = () => {
            slots.body.classList.toggle("is-fetching", state.fetching && state.phase === "ready");
            if (state.phase === "loading") {
                slots.body.innerHTML = `<div aria-busy="true"><div class="ao-table-wrap"><table class="ao-table av-table">${THEAD}<tbody>${Array.from({ length: 8 }, (_, k) => skRow(k)).join("")}</tbody></table></div>
                    <ul class="ao-cards">${Array.from({ length: 5 }, skCard).join("")}</ul><span class="ao-sr" role="status">Đang tải danh sách voucher</span></div>`;
                return;
            }
            if (state.phase === "error") {
                slots.body.innerHTML = `<div class="ao-table-wrap"><table class="ao-table av-table">${THEAD}</table></div><div class="ao-err-top">${errorHtml()}</div>`;
                return;
            }
            if (!state.list.length) {
                slots.body.innerHTML = `<div class="ao-table-wrap"><table class="ao-table av-table">${THEAD}</table></div><div class="ao-err-top">${emptyHtml()}</div>`;
                return;
            }
            slots.body.innerHTML = `<div class="ao-table-wrap ao-fade-r"><table class="ao-table av-table">${THEAD}<tbody>${state.list.map(rowHtml).join("")}</tbody></table></div>
                <ul class="ao-cards">${state.list.map(cardHtml).join("")}</ul>`;
        };
        const renderFoot = () => {
            if (state.phase === "loading") { slots.foot.innerHTML = `<div class="ao-foot-sk-row">${bar("8rem", "12px")}</div>`; return; }
            if (state.phase === "error" || (!state.list.length && !filtered())) { slots.foot.innerHTML = ""; return; }
            const active = state.counts ? ` · ${num(state.counts.active)} đang chạy` : "";
            const pager = state.meta.totalPages > 1 ? `<div class="ao-foot-nav">${pagerHtml(state.meta.page, state.meta.totalPages)}</div>` : "";
            slots.foot.innerHTML = `<div class="ao-foot ao-foot-flat"><p class="ao-count">${num(state.meta.total)} voucher${active}</p>${pager}</div>`;
        };
        const renderAll = () => { renderTabs(); renderBody(); renderFoot(); };

        // ---------- gọi API ----------
        const listUrl = () => {
            const params = new URLSearchParams({ page: String(state.page), pageSize: String(PAGE_SIZE), status: state.tab === "ALL" ? "all" : state.tab });
            if (state.q.trim()) params.set("q", state.q.trim());
            return `/api/admin/vouchers?${params}`;
        };
        const loadCounts = async () => {
            const keys = TABS.map((k) => (k === "ALL" ? "all" : k));
            const results = await Promise.allSettled(keys.map((k) => apiCall(`/api/admin/vouchers?status=${k}&page=1&pageSize=1`, { method: "GET" })));
            if (results.some((r) => r.status !== "fulfilled")) return null;
            const counts = {};
            TABS.forEach((k, i) => { counts[k] = Number(results[i].value?.meta?.total) || 0; });
            return counts;
        };
        const loadList = async () => {
            const payload = await apiCall(listUrl(), { method: "GET" });
            return { list: Array.isArray(payload?.data) ? payload.data : [], meta: payload?.meta || { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 } };
        };
        // mode: "full" (lần đầu, thử lại: khung chờ), "list" (đổi lọc: giữ dòng cũ), "silent" (sau khi ghi: tải cả đếm, không đổi khung)
        const load = async (mode = "full") => {
            const mine = ++seq;
            if (mode === "full") { state.phase = "loading"; state.error = null; renderAll(); }
            else { state.fetching = true; slots.body.classList.toggle("is-fetching", state.phase === "ready"); }
            try {
                const [data, counts] = await Promise.all([loadList(), mode === "list" ? Promise.resolve(state.counts) : loadCounts()]);
                if (mine !== seq) return;
                state.list = data.list;
                state.meta = data.meta;
                state.page = data.meta.page || state.page;
                state.counts = counts;
                state.now = Date.now();
                state.phase = "ready";
                state.fetching = false;
                renderAll();
                if (mode === "list") live(`${num(data.meta.total)} voucher`);
            } catch (error) {
                if (mine !== seq) return;
                state.fetching = false;
                if (mode === "full" || state.phase !== "ready") {
                    state.phase = "error";
                    state.error = error;
                    state.counts = null;
                    renderAll();
                } else {
                    renderBody();
                    toast("Không tải lại được danh sách voucher.", "error");
                }
            }
        };
        const onFilterChange = () => { state.page = 1; renderTabs(); load("list"); };

        // ---------- công tắc Bật ----------
        const toggleEnabled = async (id, next, input) => {
            const v = state.list.find((x) => x.id === id);
            if (!v || state.busy.has(id)) return;
            state.busy.add(id);
            input.disabled = true;
            live(next ? `Đang bật voucher ${v.code}` : `Đang tắt voucher ${v.code}`);
            try {
                const payload = await apiCall(`/api/admin/vouchers/${id}`, { method: "PUT", body: { isEnabled: next } });
                if (payload?.data) state.list = state.list.map((x) => (x.id === id ? payload.data : x));
                state.busy.delete(id);
                renderBody();
                const msg = next ? `Đã bật voucher ${v.code}` : `Đã tắt voucher ${v.code}`;
                toast(msg, "success");
                live(msg);
                refreshCounts();
                refocusToggle(id);
            } catch (error) {
                state.busy.delete(id);
                renderBody();
                const info = apiError(error);
                const msg = info.status === 404 ? `Voucher ${v.code} không còn tồn tại. Danh sách đã được tải lại.` : !info.status ? "Mất kết nối tới máy chủ. Thử lại sau." : `Không ${next ? "bật" : "tắt"} được voucher ${v.code}. Thử lại sau.`;
                toast(msg, "error");
                live(msg);
                if (info.status === 404) load("silent");
                else refocusToggle(id);
            }
        };
        const refocusToggle = (id) => {
            const nodes = [...slots.body.querySelectorAll(`[data-role="toggle"][data-id="${id}"]`)];
            const node = nodes.find((n) => n.offsetParent !== null) || nodes[0];
            node?.focus({ preventScroll: true });
        };
        const refreshCounts = async () => {
            const counts = await loadCounts();
            if (counts) { state.counts = counts; renderTabs(); renderFoot(); }
        };

        // ---------- form tạo / sửa (modal) ----------
        const field = ({ name, label, hint = "", type = "text", value = "", extra = "", lock = false, suffix = "", mono = false, area = false, wrap = "" }) => {
            const id = `av-f-${name}`;
            const input = area
                ? `<textarea id="${id}" name="${name}" rows="2" maxlength="200" class="av-input av-textarea" aria-describedby="${id}-msg" ${extra}>${esc(value)}</textarea>`
                : `<input id="${id}" name="${name}" type="${type}" value="${esc(value)}" class="av-input ${mono ? "av-mono" : ""} ${suffix || lock ? "av-pr" : ""}" aria-describedby="${id}-msg" ${lock ? "disabled" : ""} ${extra}>`;
            const end = lock ? ic("lock", "ao-i4 av-input-end") : suffix ? `<span class="av-input-end av-suffix">${suffix}</span>` : "";
            return `<div class="av-field ${wrap}" data-field="${name}"><label for="${id}" class="av-label">${label}</label><div class="av-control">${input}${end}</div><p class="av-msg" id="${id}-msg" data-hint="${esc(hint)}">${esc(hint)}</p></div>`;
        };
        const typeCard = ({ value, checked, disabled, title, desc }) => `<label class="av-typecard"><input type="radio" name="type" value="${value}" class="av-radio" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><span class="av-typecard-text"><span class="av-typecard-title">${title}</span><span class="av-typecard-desc">${desc}</span></span></label>`;
        const checkRow = ({ name, label, desc, checked }) => `<label class="av-checkrow"><span class="av-checkbox"><input type="checkbox" name="${name}" class="av-checkbox-input" ${checked ? "checked" : ""}>${ic("check", "ao-i3 av-checkbox-tick")}</span><span class="av-checkrow-text"><span class="av-checkrow-label">${label}</span><span class="av-checkrow-desc">${desc}</span></span></label>`;

        const formHtml = (spec) => {
            const v = spec.v;
            const isNew = spec.mode === "new";
            const locked = !isNew && isLocked(v);
            const d = v || { code: "", description: "", type: "PERCENT", percent: "", maxDiscount: "", startsAt: "", endsAt: "", quantity: "", isEnabled: true, isListed: true };
            const free = d.type === "FREE_SHIPPING";
            const lockMsg = locked ? `Đã có ${num(v.redeemedCount)} lượt dùng. Loại, phần trăm và mức tối đa không sửa được nữa vì các đơn đã lưu theo mức này. Muốn đổi, hãy tạo voucher mới.` : "";
            const banner = locked ? `<div role="note" class="av-banner">${ic("lock", "ao-i5 ao-muted av-banner-ic")}<p>${lockMsg}</p></div>` : "";
            const del = isNew ? "" : `<section class="av-sec av-sec-top"><h3 class="av-h3">Xoá voucher</h3>${locked
                ? `<div class="av-del"><p class="av-del-text">${ic("lock", "ao-i4 ao-shrink av-del-ic")}<span>Không xoá được vì voucher đã dùng cho ${num(v.redeemedCount)} đơn hàng và các đơn còn lưu mã này. Muốn ngừng dùng, bỏ chọn <b>Cho phép sử dụng</b> ở trên.</span></p><button type="button" class="ao-btn ao-btn-danger" disabled>Xoá voucher</button></div>`
                : `<div class="av-del"><p class="av-del-text">Voucher chưa có đơn nào dùng nên xoá được. Việc xoá được ghi vào nhật ký.</p><button type="button" class="ao-btn ao-btn-danger" data-role="delete">Xoá voucher</button></div>`}</section>`;
            return `<div class="av-alert" role="alert" data-role="alert" hidden></div>
                ${banner}
                <section class="av-sec">
                    ${field({ name: "code", label: "Mã voucher", value: d.code, mono: true, hint: "3 đến 20 chữ cái hoặc số, không phân biệt hoa thường.", extra: 'maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"' })}
                    ${field({ name: "desc", label: "Mô tả", value: d.description, area: true, hint: "Khách thấy dòng này trong danh sách chọn mã. Nên nói rõ giảm gì." })}
                </section>
                <section class="av-sec">
                    <h3 class="av-h3">Ưu đãi</h3>
                    <fieldset class="av-types"><legend class="ao-sr">Loại voucher</legend>
                        ${typeCard({ value: "PERCENT", checked: !free, disabled: locked, title: "Giảm theo phần trăm", desc: "Tính trên tạm tính của đơn." })}
                        ${typeCard({ value: "FREE_SHIPPING", checked: free, disabled: locked, title: "Miễn phí vận chuyển", desc: "Giảm đúng bằng phí vận chuyển." })}
                    </fieldset>
                    <div class="av-if-pct">
                        <div class="av-grid2">
                            ${field({ name: "percent", label: "Phần trăm giảm", type: "number", value: d.percent ?? "", suffix: "%", lock: locked, hint: locked ? "Đã khoá." : "Số nguyên từ 1 đến 100.", extra: 'inputmode="numeric" min="1" max="100"' })}
                            ${field({ name: "max", label: "Giảm tối đa", type: "number", value: d.maxDiscount ?? "", suffix: locked ? "" : "₫", lock: locked, hint: locked ? "Đã khoá." : "Từ 1.000₫ đến 500.000₫.", extra: 'inputmode="numeric" min="1000" max="500000"' })}
                        </div>
                        <p class="av-example" data-role="example" aria-live="polite"></p>
                    </div>
                    <p class="av-if-free av-note">Voucher giảm đúng phí vận chuyển của đơn, không quá 500.000₫. Một đơn chỉ dùng được một voucher loại này.</p>
                </section>
                <section class="av-sec">
                    <h3 class="av-h3">Thời gian áp dụng</h3>
                    <div class="av-grid2">
                        ${field({ name: "start", label: "Bắt đầu", type: "datetime-local", value: toLocalInput(d.startsAt), hint: isNew ? "Để trống thì áp dụng ngay khi tạo." : "" })}
                        ${field({ name: "end", label: "Kết thúc", type: "datetime-local", value: toLocalInput(d.endsAt), hint: "Phải sau ngày bắt đầu." })}
                    </div>
                </section>
                <section class="av-sec">
                    <h3 class="av-h3">Số lượng và hiển thị</h3>
                    ${field({ name: "qty", label: "Số lượt dùng tối đa", type: "number", value: d.quantity, wrap: "av-field-narrow", hint: isNew ? "Mỗi đơn dùng một lượt. Hết lượt thì mã tự ngừng." : `Chỉ tăng được, không thấp hơn ${num(v.redeemedCount)} (số đã dùng).`, extra: `inputmode="numeric" min="${isNew ? 1 : Math.max(1, v.redeemedCount)}"` })}
                    <div class="av-checks">
                        ${checkRow({ name: "listed", label: "Hiển thị trong danh sách mã của khách", desc: "Tắt thì mã ẩn, chỉ khách nhập đúng mã mới dùng được.", checked: d.isListed })}
                        ${checkRow({ name: "enabled", label: "Cho phép sử dụng", desc: "Bỏ chọn để tạm dừng. Đơn đã dùng mã vẫn giữ nguyên.", checked: d.isEnabled })}
                    </div>
                </section>${del}`;
        };

        const modalHtml = (spec) => {
            const v = spec.v;
            const isNew = spec.mode === "new";
            const title = isNew ? "Tạo voucher" : "Sửa voucher";
            const sub = isNew
                ? "Khách nhập mã khi thanh toán. Mỗi voucher giảm tối đa 500.000₫ cho một đơn."
                : `<span class="av-sub-code">${esc(v.code)}</span> · ${esc(STATUS_LABEL[v.status].toLowerCase())} · đã dùng ${num(v.redeemedCount)} trên ${num(v.quantity)} lượt`;
            return `<div class="av-modal" data-role="modal">
                <div class="av-modal-scrim"></div>
                <div class="av-modal-box" role="dialog" aria-modal="true" aria-labelledby="av-m-title" aria-describedby="av-m-sub">
                    <header class="av-mhead"><div class="av-mhead-main"><h2 id="av-m-title">${title}</h2><p id="av-m-sub">${sub}</p></div>
                        <button type="button" class="ao-icon-btn av-close" data-role="close-form" aria-label="Đóng">${ic("x")}</button></header>
                    <form class="av-mbody" id="av-form" novalidate data-type="${v && v.type === "FREE_SHIPPING" ? "FREE_SHIPPING" : "PERCENT"}">${formHtml(spec)}</form>
                    <footer class="av-mfoot"><button type="button" class="ao-btn ao-btn-secondary" data-role="close-form">Huỷ</button>
                        <button type="submit" form="av-form" class="ao-btn ao-btn-primary" data-role="submit">${isNew ? "Tạo voucher" : "Lưu thay đổi"}</button></footer>
                </div></div>`;
        };

        const fieldEl = (form, name) => form.querySelector(`[data-field="${name}"]`);
        const clearErrors = (form) => {
            form.querySelectorAll("[data-field]").forEach((wrap) => {
                wrap.classList.remove("has-error");
                wrap.querySelector(".av-input")?.removeAttribute("aria-invalid");
                const msg = wrap.querySelector(".av-msg");
                msg.textContent = msg.dataset.hint;
                msg.classList.remove("is-error");
            });
            const alert = form.querySelector('[data-role="alert"]');
            alert.hidden = true;
            alert.textContent = "";
        };
        const setError = (form, name, message) => {
            const wrap = fieldEl(form, name);
            if (!wrap) return false;
            wrap.classList.add("has-error");
            wrap.querySelector(".av-input")?.setAttribute("aria-invalid", "true");
            const msg = wrap.querySelector(".av-msg");
            msg.textContent = message;
            msg.classList.add("is-error");
            return true;
        };
        const showAlert = (form, message) => {
            const alert = form.querySelector('[data-role="alert"]');
            alert.textContent = message;
            alert.hidden = false;
            form.scrollTop = 0;
        };
        const focusFirstError = (form) => {
            const first = form.querySelector(".has-error .av-input");
            if (first) { first.focus(); first.scrollIntoView({ block: "center" }); }
        };
        const updateExample = (form) => {
            const el = form.querySelector('[data-role="example"]');
            if (form.dataset.type === "FREE_SHIPPING") { el.textContent = ""; return; }
            const percent = Number(form.elements.percent.value);
            const max = Number(form.elements.max.value);
            if (!Number.isInteger(percent) || percent < 1 || percent > 100 || !Number.isInteger(max) || max < MIN_MAX_DISCOUNT || max > MAX_DISCOUNT) { el.textContent = ""; return; }
            const raw = Math.floor((5000000 * percent) / 100);
            const cut = Math.min(raw, max);
            el.textContent = `Ví dụ: đơn tạm tính ${vnd(5000000)} được giảm ${vnd(cut)}${cut < raw ? " (chạm mức tối đa)" : ""}.`;
        };

        const readForm = (form, spec) => {
            const locked = spec.mode === "edit" && isLocked(spec.v);
            const e = form.elements;
            return {
                code: e.code.value.trim().toUpperCase(),
                description: e.desc.value.trim(),
                type: locked ? spec.v.type : e.type.value,
                percent: e.percent.value.trim(),
                max: e.max.value.trim(),
                start: e.start.value,
                end: e.end.value,
                qty: e.qty.value.trim(),
                listed: e.listed.checked,
                enabled: e.enabled.checked,
                locked,
            };
        };
        const isWhole = (s) => /^\d+$/.test(s);
        const validate = (values, spec) => {
            const errors = {};
            if (!/^[A-Z0-9]{3,20}$/.test(values.code)) errors.code = "Mã gồm 3 đến 20 chữ cái hoặc số, không dấu và không khoảng trắng.";
            if (!values.description) errors.desc = "Nhập mô tả để khách biết mã giảm gì.";
            else if (values.description.length > 200) errors.desc = "Mô tả tối đa 200 ký tự.";
            if (values.type === "PERCENT" && !values.locked) {
                if (!isWhole(values.percent) || Number(values.percent) < 1 || Number(values.percent) > 100) errors.percent = "Phần trăm từ 1 đến 100.";
                if (!isWhole(values.max) || Number(values.max) < MIN_MAX_DISCOUNT || Number(values.max) > MAX_DISCOUNT) errors.max = "Mức tối đa từ 1.000₫ đến 500.000₫.";
            }
            const startMs = values.start ? new Date(values.start).getTime() : null;
            const endMs = values.end ? new Date(values.end).getTime() : null;
            if (spec.mode === "edit" && !values.start) errors.start = "Chọn thời gian bắt đầu.";
            else if (values.start && Number.isNaN(startMs)) errors.start = "Thời gian bắt đầu không hợp lệ.";
            if (!values.end) errors.end = "Chọn thời gian kết thúc.";
            else if (Number.isNaN(endMs)) errors.end = "Thời gian kết thúc không hợp lệ.";
            else if (!errors.start && startMs !== null && endMs <= startMs) errors.end = "Ngày kết thúc phải sau ngày bắt đầu.";
            else if (startMs === null && endMs <= Date.now()) errors.end = "Ngày kết thúc phải sau ngày bắt đầu.";
            const used = spec.mode === "edit" ? spec.v.redeemedCount : 0;
            if (!isWhole(values.qty) || Number(values.qty) < 1) errors.qty = "Nhập số lượt dùng, ít nhất 1.";
            else if (Number(values.qty) > MAX_QUANTITY) errors.qty = `Tối đa ${num(MAX_QUANTITY)} lượt.`;
            else if (Number(values.qty) < used) errors.qty = `Không thấp hơn ${num(used)} (số đã dùng).`;
            return errors;
        };
        const toPayload = (values, spec) => {
            const body = {
                code: values.code,
                description: values.description,
                startsAt: new Date(values.start || Date.now()).toISOString(),
                endsAt: new Date(values.end).toISOString(),
                quantity: Number(values.qty),
                isListed: values.listed,
                isEnabled: values.enabled,
            };
            if (!values.locked) {
                body.type = values.type;
                if (values.type === "PERCENT") { body.percent = Number(values.percent); body.maxDiscount = Number(values.max); }
            }
            return body;
        };

        const setBusy = (busy) => {
            if (!formState) return;
            const { el } = formState;
            formState.busy = busy;
            const submit = el.querySelector('[data-role="submit"]');
            submit.disabled = busy;
            submit.textContent = busy ? "Đang lưu…" : formState.spec.mode === "new" ? "Tạo voucher" : "Lưu thay đổi";
            el.querySelectorAll('[data-role="close-form"]').forEach((b) => { b.disabled = busy; });
            el.querySelector(".av-modal-box").setAttribute("aria-busy", String(busy));
        };

        const afterWrite = (id) => {
            closeForm({ restore: false });
            load("silent").then(() => {
                const btns = id ? [...slots.body.querySelectorAll(`[data-role="edit"][data-id="${id}"]`)] : [];
                (btns.find((b) => b.offsetParent !== null) || createBtn).focus({ preventScroll: true });
            });
        };

        const submitForm = async () => {
            if (!formState || formState.busy) return;
            const { el, spec } = formState;
            const form = el.querySelector("form");
            clearErrors(form);
            const values = readForm(form, spec);
            const errors = validate(values, spec);
            const names = Object.keys(errors);
            if (names.length) {
                names.forEach((name) => setError(form, name, errors[name]));
                showAlert(form, names.length === 1 ? "Có 1 ô cần sửa trước khi lưu." : `Có ${names.length} ô cần sửa trước khi lưu.`);
                focusFirstError(form);
                return;
            }
            setBusy(true);
            const isNew = spec.mode === "new";
            try {
                const payload = await apiCall(isNew ? "/api/admin/vouchers" : `/api/admin/vouchers/${spec.v.id}`, { method: isNew ? "POST" : "PUT", body: toPayload(values, spec) });
                const saved = payload?.data;
                const msg = isNew ? `Đã tạo voucher ${saved ? saved.code : values.code}` : `Đã lưu voucher ${saved ? saved.code : values.code}`;
                toast(msg, "success");
                live(msg);
                setBusy(false);
                afterWrite(saved ? saved.id : spec.v?.id);
            } catch (error) {
                setBusy(false);
                handleSaveError(form, spec, error);
            }
        };

        const handleSaveError = async (form, spec, error) => {
            const info = apiError(error);
            if (info.code === "VALIDATION_FAILED" && info.details.length) {
                const rest = [];
                info.details.forEach((d) => { const name = FIELD_OF[d.field]; if (!name || !setError(form, name, d.message)) rest.push(d.message); });
                showAlert(form, rest.length ? rest.join(" ") : "Kiểm tra lại các ô được đánh dấu.");
                focusFirstError(form);
            } else if (info.code === "VOUCHER_CODE_TAKEN") {
                setError(form, "code", "Mã này đã tồn tại. Hãy chọn mã khác.");
                showAlert(form, info.message || "Mã voucher đã tồn tại.");
                focusFirstError(form);
            } else if (info.code === "VOUCHER_QUANTITY_TOO_LOW") {
                setError(form, "qty", info.message || "Số lượng thấp hơn số lượt đã dùng.");
                showAlert(form, info.message || "Số lượng thấp hơn số lượt đã dùng.");
                focusFirstError(form);
            } else if (info.code === "VOUCHER_LOCKED") {
                showAlert(form, info.message || "Voucher đã được sử dụng nên không thể đổi loại, phần trăm hoặc mức giảm tối đa.");
                await reopenFresh(spec.v.id);
            } else if (info.status === 404) {
                showAlert(form, "Voucher này không còn tồn tại. Danh sách sẽ được tải lại khi đóng.");
                load("silent");
            } else {
                showAlert(form, !info.status ? "Mất kết nối tới máy chủ. Thử lại sau." : "Không lưu được voucher. Thử lại sau ít phút.");
            }
            live("Không lưu được voucher");
        };

        // Nạp lại một voucher và vẽ lại form với trạng thái khoá mới nhất
        const reopenFresh = async (id, notice = "") => {
            if (!formState) return;
            try {
                const payload = await apiCall(`/api/admin/vouchers/${id}`, { method: "GET" });
                if (!payload?.data || !formState) return;
                const { el, opener } = formState;
                const keepAlert = notice || el.querySelector('[data-role="alert"]').textContent;
                const next = { mode: "edit", v: payload.data };
                state.list = state.list.map((x) => (x.id === id ? payload.data : x));
                formState.spec = next;
                const box = el.querySelector(".av-modal-box");
                box.querySelector("#av-m-sub").innerHTML = `<span class="av-sub-code">${esc(next.v.code)}</span> · ${esc(STATUS_LABEL[next.v.status].toLowerCase())} · đã dùng ${num(next.v.redeemedCount)} trên ${num(next.v.quantity)} lượt`;
                const form = box.querySelector("form");
                form.dataset.type = next.v.type === "FREE_SHIPPING" ? "FREE_SHIPPING" : "PERCENT";
                form.innerHTML = formHtml(next);
                updateExample(form);
                if (keepAlert) showAlert(form, keepAlert);
                formState.opener = opener;
                renderBody();
            } catch (_) { /* giữ form hiện tại */ }
        };

        const openForm = (spec, opener) => {
            if (formState) return;
            const wrap = document.createElement("div");
            wrap.innerHTML = modalHtml(spec);
            const el = wrap.firstElementChild;
            root.appendChild(el);
            formState = { el, spec, opener: opener || createBtn, busy: false };
            lockScroll(true);
            slots.page.setAttribute("inert", "");
            const form = el.querySelector("form");
            updateExample(form);
            form.addEventListener("submit", (e) => { e.preventDefault(); submitForm(); });
            form.addEventListener("input", (e) => {
                const name = e.target.name;
                if (name === "percent" || name === "max") updateExample(form);
                const wrapField = e.target.closest("[data-field]");
                if (wrapField && wrapField.classList.contains("has-error")) {
                    wrapField.classList.remove("has-error");
                    e.target.removeAttribute("aria-invalid");
                    const msg = wrapField.querySelector(".av-msg");
                    msg.textContent = msg.dataset.hint;
                    msg.classList.remove("is-error");
                }
            });
            form.addEventListener("change", (e) => {
                if (e.target.name === "type") { form.dataset.type = e.target.value; updateExample(form); }
            });
            el.addEventListener("click", (e) => {
                const t = e.target.closest("[data-role]");
                if (!t) return;
                if (t.dataset.role === "close-form" && !formState.busy) closeForm();
                else if (t.dataset.role === "delete") openConfirm(t);
            });
            el.addEventListener("keydown", (e) => { if (!confirmState) trapTab(e, el.querySelector(".av-modal-box")); });
            requestAnimationFrame(() => {
                el.setAttribute("data-open", "");
                const first = spec.mode === "new" ? form.elements.code : (form.elements.desc);
                first.focus({ preventScroll: true });
            });
        };
        const closeForm = ({ restore = true } = {}) => {
            if (!formState) return;
            const { el, opener } = formState;
            formState = null;
            el.removeAttribute("data-open");
            slots.page.removeAttribute("inert");
            lockScroll(false);
            if (restore) {
                const back = opener && document.contains(opener) && opener.offsetParent !== null ? opener : createBtn;
                back.focus({ preventScroll: true });
            }
            setTimeout(() => el.remove(), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150);
        };

        // ---------- hộp xác nhận xoá (overlay.md: hộp xác nhận) ----------
        const openConfirm = (opener) => {
            if (!formState || confirmState) return;
            const v = formState.spec.v;
            const uid = `av-confirm-${Math.random().toString(36).slice(2, 7)}`;
            const el = document.createElement("div");
            el.className = "ao-modal av-confirm";
            el.innerHTML = `<div class="ao-modal-scrim"></div>
                <div class="ao-modal-box" role="alertdialog" aria-modal="true" aria-labelledby="${uid}-t" aria-describedby="${uid}-d">
                    <div class="ao-modal-head">
                        <div class="ao-modal-icon">${ic("trash-2", "ao-i5 ao-text-danger")}</div>
                        <h2 id="${uid}-t">Xoá voucher này?</h2>
                        <div class="ao-modal-desc"><p id="${uid}-d"><span class="ao-mono ao-strong">${esc(v.code)}</span> sẽ bị xoá vĩnh viễn và không dùng được nữa. Chưa có đơn nào dùng mã này.</p></div>
                    </div>
                    <div class="ao-modal-actions">
                        <button type="button" class="ao-btn ao-btn-secondary" data-role="keep">Giữ voucher</button>
                        <button type="button" class="ao-btn ao-btn-danger" data-role="confirm">Xoá voucher</button>
                    </div></div>`;
            root.appendChild(el);
            const keep = el.querySelector('[data-role="keep"]');
            const confirm = el.querySelector('[data-role="confirm"]');
            let busy = false;
            const close = (focusBack = true) => {
                el.removeAttribute("data-open");
                confirmState = null;
                if (focusBack) {
                    const back = opener && document.contains(opener) && !opener.disabled ? opener : formState?.el.querySelector(".av-modal-box");
                    back?.focus?.({ preventScroll: true });
                }
                setTimeout(() => el.remove(), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120);
            };
            confirmState = { el, close, cancel() { if (!busy) close(); } };
            keep.addEventListener("click", () => confirmState?.cancel());
            confirm.addEventListener("click", async () => {
                if (busy) return;
                busy = true; keep.disabled = true; confirm.disabled = true; confirm.textContent = "Đang xoá…";
                try {
                    await apiCall(`/api/admin/vouchers/${v.id}`, { method: "DELETE" });
                    const msg = `Đã xoá voucher ${v.code}`;
                    toast(msg, "success");
                    live(msg);
                    close(false);
                    afterWrite(null);
                } catch (error) {
                    busy = false; keep.disabled = false; confirm.disabled = false; confirm.textContent = "Xoá voucher";
                    const info = apiError(error);
                    close(false);
                    if (info.code === "VOUCHER_IN_USE") {
                        toast(`Voucher ${v.code} vừa có đơn dùng nên không xoá được. Chỉ có thể tắt.`, "error");
                        await reopenFresh(v.id, info.message || "Voucher đã được sử dụng trong đơn hàng nên không thể xoá, chỉ có thể vô hiệu hoá.");
                        formState?.el.querySelector(".av-modal-box")?.focus?.();
                    } else if (info.status === 404) {
                        toast(`Voucher ${v.code} không còn tồn tại.`, "error");
                        afterWrite(null);
                    } else {
                        toast(!info.status ? "Mất kết nối tới máy chủ. Thử lại sau." : "Không xoá được voucher. Thử lại sau.", "error");
                        formState?.el.querySelector('[data-role="delete"]')?.focus();
                    }
                }
            });
            el.addEventListener("keydown", (e) => {
                if (e.key !== "Tab") return;
                const f = [keep, confirm].filter((b) => !b.disabled);
                if (!f.length) { e.preventDefault(); return; }
                const i = f.indexOf(document.activeElement);
                if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
                else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
            });
            requestAnimationFrame(() => { el.setAttribute("data-open", ""); keep.focus(); });
        };

        // ---------- sự kiện ----------
        searchInput.addEventListener("input", () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { state.q = searchInput.value; onFilterChange(); }, 250);
        });
        slots.tabs.addEventListener("click", (e) => {
            const b = e.target.closest("[data-tab]");
            if (!b || b.dataset.tab === state.tab) return;
            state.tab = b.dataset.tab;
            onFilterChange();
            slots.tabs.querySelector(`[data-tab="${state.tab}"]`)?.focus();
        });
        slots.tabs.addEventListener("keydown", (e) => {
            const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
            if (!e.target.closest("[data-tab]") || !(e.key in keys)) return;
            e.preventDefault();
            state.tab = TABS[(TABS.indexOf(state.tab) + keys[e.key] + TABS.length) % TABS.length];
            onFilterChange();
            const tab = slots.tabs.querySelector(`[data-tab="${state.tab}"]`);
            tab?.focus();
            tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        const clearFilter = () => { state.tab = "ALL"; state.q = ""; searchInput.value = ""; onFilterChange(); };
        createBtn.addEventListener("click", () => openForm({ mode: "new" }, createBtn));
        rootEl.addEventListener("click", (e) => {
            const t = e.target.closest("[data-role]");
            if (!t || t.closest(".av-modal")) return;
            const role = t.dataset.role;
            if (role === "edit") { const v = state.list.find((x) => x.id === Number(t.dataset.id)); if (v) openForm({ mode: "edit", v }, t); }
            else if (role === "create" && t !== createBtn) openForm({ mode: "new" }, t);
            else if (role === "retry") load("full");
            else if (role === "clear-filter") clearFilter();
        });
        rootEl.addEventListener("change", (e) => {
            const t = e.target.closest('[data-role="toggle"]');
            if (t) toggleEnabled(Number(t.dataset.id), t.checked, t);
        });
        slots.foot.addEventListener("click", (e) => {
            const b = e.target.closest("[data-page]");
            if (!b || b.disabled) return;
            state.page = Number(b.dataset.page);
            load("list");
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (confirmState) { e.preventDefault(); confirmState.cancel(); return; }
            if (Kit.closeOpenSelect(true)) { e.preventDefault(); return; }
            if (formState && !formState.busy) { e.preventDefault(); closeForm(); }
        });

        instance.activate = () => { if (state.phase !== "loading" && !formState) load("silent"); };
        renderAll();
        load("full");
    };

    const instance = { mount, activate: () => {} };
    window.AdminVouchers = instance;
})();
