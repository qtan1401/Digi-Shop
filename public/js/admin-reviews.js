/* NodeShop admin: màn Đánh giá (kiểm duyệt), phương án A (bảng, ẩn / hiện lại ngay tại dòng).
 * Hợp đồng với khung admin:
 *   AdminReviews.mount(rootEl, { api, toast })   gọi một lần, vẽ cả màn vào rootEl
 *   AdminReviews.activate()                      mở lại màn: tải lại danh sách âm thầm
 * Dữ liệu: GET /api/admin/reviews?page&pageSize&productId&hidden=all|visible|hidden&q,
 *          PATCH /api/admin/reviews/:id { isHidden }, GET /api/admin/products (tên + ảnh cho bộ lọc sản phẩm).
 * Dùng bộ mảnh chung window.AdminKit và class `.ao-*` (admin-orders.css); riêng màn này là `.ar-*` (admin-reviews.css).
 */
(() => {
    "use strict";
    const Kit = window.AdminKit;
    if (!Kit) return;
    const { esc, ic, bar, badge, pagerHtml, createSelect } = Kit;

    const PAGE_SIZE = 10;
    const TABS = [["ALL", "Tất cả", "all"], ["VISIBLE", "Đang hiển thị", "visible"], ["HIDDEN", "Đã ẩn", "hidden"]];
    const tabLabel = (k) => TABS.find((t) => t[0] === k)[1];
    const tabParam = (k) => TABS.find((t) => t[0] === k)[2];
    const EDIT_GAP_MS = 60000;

    const pad = (n) => String(n).padStart(2, "0");
    const num = (n) => Number(n || 0).toLocaleString("vi-VN");
    const dmy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const apiError = (error) => ({ code: error && error.code, status: error && error.status });

    const starsHtml = (n, size = "ao-i4") => (n == null
        ? '<span class="ar-nostar">Không chấm sao</span>'
        : `<span class="ar-stars" role="img" aria-label="${n} trên 5 sao">${[1, 2, 3, 4, 5].map((i) => `<span class="ar-star ${i <= n ? "is-on" : ""}">${ic("star", size)}</span>`).join("")}</span>`);
    const chipHtml = (hidden) => (hidden ? badge("n", "Đã ẩn", "eye-off") : badge("s", "Hiển thị", "eye"));

    const mount = (rootEl, options = {}) => {
        const apiCall = options.api || ((url, opts) => window.DigiAuth.api(url, opts));
        const toast = typeof options.toast === "function" ? options.toast : () => {};
        const state = {
            phase: "loading", error: null, list: [], meta: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 },
            counts: null, tab: "ALL", pid: "ALL", q: "", page: 1, fetching: false,
            products: [], busy: new Set(), expanded: new Set(),
        };
        let seq = 0;
        let searchTimer = null;
        let measureTimer = null;

        rootEl.innerHTML = `
            <div class="ao ar">
                <div class="ao-stack">
                    <div class="ao-tabs-block" data-slot="tabs"></div>
                    <div class="ao-toolbar">
                        <label class="ao-search"><span class="ao-sr">Tìm đánh giá</span><input type="search" class="ao-input" placeholder="Tìm theo tên người viết hoặc nội dung" autocomplete="off" data-role="search"></label>
                        <div data-slot="product"></div>
                    </div>
                    <section class="ao-card ar-card" aria-label="Danh sách đánh giá">
                        <div data-slot="body"></div>
                        <div data-slot="foot"></div>
                    </section>
                </div>
                <p class="ao-sr" role="status" aria-live="polite" data-slot="live"></p>
            </div>`;
        const $ = (name) => rootEl.querySelector(`[data-slot="${name}"]`);
        const slots = { tabs: $("tabs"), product: $("product"), body: $("body"), foot: $("foot"), live: $("live") };
        const searchInput = rootEl.querySelector('[data-role="search"]');
        const live = (msg) => { slots.live.textContent = ""; if (msg) setTimeout(() => { slots.live.textContent = msg; }, 20); };

        // ---------- tên / ảnh sản phẩm ----------
        const productOf = (id) => state.products.find((p) => String(p.id) === String(id));
        const nameOf = (r) => r.productName || (productOf(r.productId) && productOf(r.productId).name) || `Sản phẩm #${r.productId}`;
        const userOf = (r) => r.username || "Khách hàng";
        const thumbHtml = (r, cls = "") => {
            const p = productOf(r.productId);
            return p && p.image ? `<img class="ar-thumb ${cls}" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="ar-thumb ar-thumb-blank ${cls}" aria-hidden="true"></span>`;
        };

        // ---------- bộ lọc ----------
        const countOf = (k) => (state.counts ? state.counts[k] : undefined);
        const statusSelect = createSelect({
            label: "Lọc theo hiển thị", size: "lg",
            getValueHtml: (v) => `<span class="ao-muted">Hiển thị:</span> ${tabLabel(v)}${countOf(v) !== undefined ? ` · ${num(countOf(v))}` : ""}`,
            getGroups: () => [TABS.map(([k, label]) => ({ value: k, html: label, hint: countOf(k) !== undefined ? num(countOf(k)) : "" }))],
            onSelect: (v) => { state.tab = v; onFilterChange(); },
        });
        const productSelect = createSelect({
            label: "Lọc theo sản phẩm", size: "lg", scroll: true,
            getValueHtml: (v) => (v === "ALL" ? '<span class="ao-muted">Sản phẩm:</span> Tất cả' : `<span class="ao-muted">Sản phẩm:</span> ${esc((productOf(v) && productOf(v).name) || `#${v}`)}`),
            getGroups: () => [[{ value: "ALL", html: "Tất cả sản phẩm" }, ...state.products.map((p) => ({ value: String(p.id), html: esc(p.name) }))]],
            onSelect: (v) => { state.pid = v; onFilterChange(); },
        });
        slots.product.append(productSelect.el);
        productSelect.setValue("ALL");

        const renderTabs = () => {
            const countHtml = (k) => (state.counts ? `<span class="tab-count">${num(state.counts[k])}</span>` : state.phase === "loading" ? '<span class="ao-tab-sk"></span>' : "");
            slots.tabs.innerHTML = `<div class="ao-tabs-wide"><div class="ao-fade ao-fade-x scrollbar-clean"><div class="status-tabs" role="tablist" aria-label="Lọc theo hiển thị">${TABS.map(([k, label]) => {
                const on = k === state.tab;
                return `<button type="button" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${k}" class="status-tab ${on ? "is-active" : ""}">${label}${countHtml(k)}</button>`;
            }).join("")}</div></div></div><div class="ao-tabs-narrow" data-slot="tabs-select"></div>`;
            slots.tabs.querySelector('[data-slot="tabs-select"]').append(statusSelect.el);
            statusSelect.setValue(state.tab);
        };

        // ---------- bảng ----------
        const commentHtml = (r) => {
            if (r.comment == null || r.comment === "") return '<span class="ar-nocomment">Không có bình luận</span>';
            const open = state.expanded.has(r.id);
            return `<div class="ar-comment ${open ? "is-open" : ""}" data-id="${r.id}"><p class="ar-text">${esc(r.comment)}</p>
                <button type="button" class="ar-more" data-role="more" data-id="${r.id}" aria-expanded="${open}" ${open ? "" : "hidden"}>${open ? "Thu gọn" : "Xem thêm"}</button></div>`;
        };
        const editedHtml = (r) => (new Date(r.updatedAt) - new Date(r.createdAt) > EDIT_GAP_MS ? `<span class="ar-edited" title="Sửa lúc ${dmy(new Date(r.updatedAt))} ${hm(new Date(r.updatedAt))}">· đã sửa</span>` : "");
        const noteHtml = (r) => (r.isHidden ? '<p class="ar-note">Không tính vào điểm trung bình</p>' : "");
        const actionBtn = (r, touch = false) => {
            const busy = state.busy.has(r.id);
            return `<button type="button" class="ao-btn-sm ${touch ? "ao-btn-touch" : ""}" data-role="toggle-hidden" data-id="${r.id}" ${busy ? "disabled" : ""} aria-label="${r.isHidden ? "Hiện lại" : "Ẩn"} đánh giá của ${esc(userOf(r))}">${r.isHidden ? "Hiện lại" : "Ẩn"}</button>`;
        };
        const THEAD = `<thead><tr>
            <th scope="col" class="ao-th ao-th-sticky ar-th-prod">Sản phẩm</th>
            <th scope="col" class="ao-th ar-th-user">Người đánh giá</th>
            <th scope="col" class="ao-th ar-th-text">Nội dung</th>
            <th scope="col" class="ao-th ar-th-date">Ngày</th>
            <th scope="col" class="ao-th ar-th-vis">Hiển thị</th>
            <th scope="col" class="ao-th ao-th-end ar-th-act"><span class="ao-sr">Ẩn hoặc hiện lại</span></th></tr></thead>`;
        const rowHtml = (r) => {
            const d = new Date(r.createdAt);
            return `<tr class="ao-tr ar-row ${r.isHidden ? "is-hidden" : ""}" data-row="${r.id}">
                <td class="ao-td ao-td-sticky ar-td-prod"><div class="ar-prod">${thumbHtml(r, "ar-thumb-36")}<p class="ar-prod-name" title="${esc(nameOf(r))}">${esc(nameOf(r))}</p></div></td>
                <td class="ao-td"><p class="ar-user" title="${esc(userOf(r))}">${esc(userOf(r))}</p><div class="ar-stars-row">${starsHtml(r.rating, "ao-i3")}</div></td>
                <td class="ao-td ar-td-text">${commentHtml(r)}</td>
                <td class="ao-td ar-nowrap"><p class="ar-date"><time datetime="${esc(r.createdAt)}">${dmy(d)}</time></p><p class="ar-time">${hm(d)} ${editedHtml(r)}</p></td>
                <td class="ao-td"><div data-chip>${chipHtml(r.isHidden)}</div>${noteHtml(r)}</td>
                <td class="ao-td ao-td-end ar-td-act">${actionBtn(r)}</td></tr>`;
        };
        const cardHtml = (r) => {
            const d = new Date(r.createdAt);
            return `<li class="ar-card-item ${r.isHidden ? "is-hidden" : ""}" data-row="${r.id}">
                <div class="ar-card-head">${thumbHtml(r, "ar-thumb-36")}<div class="ar-card-who"><p class="ar-prod-name">${esc(nameOf(r))}</p>
                    <p class="ar-card-meta"><span class="ar-card-user">${esc(userOf(r))}</span><time datetime="${esc(r.createdAt)}">${dmy(d)}</time>${editedHtml(r)}</p></div></div>
                <div>${starsHtml(r.rating, "ao-i3")}</div>
                <div>${commentHtml(r)}</div>
                <div class="ar-card-foot"><div>${chipHtml(r.isHidden)}${noteHtml(r)}</div>${actionBtn(r, true)}</div></li>`;
        };
        const skRow = (k) => `<tr><td class="ao-td ao-td-sticky"><div class="ar-prod">${bar("36px", "36px", "ar-sk-sq")}<div class="ar-sk-col">${bar("9rem", "12px")}${bar("6rem", "12px")}</div></div></td>
            <td class="ao-td">${bar(["6rem", "8rem", "7rem"][k % 3], "12px")}<div class="ar-sk-gap">${bar("5rem", "12px")}</div></td>
            <td class="ao-td"><div class="ar-sk-col">${bar("100%", "12px")}${bar("66%", "12px")}</div></td>
            <td class="ao-td">${bar("5rem", "12px")}<div class="ar-sk-gap">${bar("2.5rem", "12px")}</div></td>
            <td class="ao-td">${bar("6rem", "24px")}</td><td class="ao-td ao-td-end"><div class="ar-sk-end">${bar("4rem", "32px", "ar-sk-sq")}</div></td></tr>`;
        const skCard = () => `<li class="ar-card-item" aria-hidden="true"><div class="ar-card-head">${bar("36px", "36px", "ar-sk-sq")}<div class="ar-sk-col">${bar("10rem", "12px")}${bar("7rem", "12px")}</div></div>${bar("6rem", "12px")}${bar("100%", "12px")}<div class="ar-card-foot">${bar("6rem", "24px")}${bar("5rem", "40px", "ar-sk-sq")}</div></li>`;

        const filtered = () => state.tab !== "ALL" || state.pid !== "ALL" || state.q.trim() !== "";
        const emptyHtml = () => {
            if (!filtered()) {
                return `<div class="ao-empty-block"><div><p class="ao-empty-title">Chưa có đánh giá nào</p><p class="ao-empty-desc">Khách chỉ đánh giá được sản phẩm sau khi đơn đã giao. Đánh giá đầu tiên sẽ hiện ở đây để bạn xem và kiểm duyệt.</p></div></div>`;
            }
            const p = state.pid !== "ALL" ? productOf(state.pid) : null;
            const q = state.q.trim();
            const what = state.tab === "HIDDEN" ? "đánh giá nào bị ẩn" : state.tab === "VISIBLE" ? "đánh giá nào đang hiển thị" : "đánh giá nào";
            const sentence = p ? `${esc(p.name)} chưa có ${what}${q ? ` chứa “${esc(q)}”` : ""}.`
                : `Chưa có ${what}${q ? ` chứa “${esc(q)}”` : ""}.`;
            return `<div class="ao-empty-block"><div><p class="ao-empty-title">Không có đánh giá nào khớp</p><p class="ao-empty-desc">${sentence}</p></div><button type="button" class="ao-linkbtn" data-role="clear-filter">Xoá lọc</button></div>`;
        };
        const errorHtml = () => {
            const net = !state.error || !state.error.status;
            return `<div role="alert" class="ao-err"><div><p class="ao-err-title">Không tải được danh sách đánh giá</p><p class="ao-err-msg">${net ? "Mất kết nối tới máy chủ" : "Máy chủ gặp lỗi, thử lại sau ít phút"}</p></div>
                <button type="button" class="ao-btn ao-btn-outline" data-role="retry">${ic("rotate-cw", "ao-i4 ao-shrink")}Thử lại</button></div>`;
        };
        const renderBody = () => {
            slots.body.classList.toggle("is-fetching", state.fetching && state.phase === "ready");
            if (state.phase === "loading") {
                slots.body.innerHTML = `<div aria-busy="true"><div class="ao-table-wrap"><table class="ao-table ar-table">${THEAD}<tbody>${Array.from({ length: 8 }, (_, k) => skRow(k)).join("")}</tbody></table></div>
                    <ul class="ao-cards">${Array.from({ length: 5 }, skCard).join("")}</ul><span class="ao-sr" role="status">Đang tải danh sách đánh giá</span></div>`;
                return;
            }
            if (state.phase === "error") {
                slots.body.innerHTML = `<div class="ao-table-wrap"><table class="ao-table ar-table">${THEAD}</table></div><div class="ao-err-top">${errorHtml()}</div>`;
                return;
            }
            if (!state.list.length) {
                slots.body.innerHTML = `<div class="ao-table-wrap"><table class="ao-table ar-table">${THEAD}</table></div><div class="ao-err-top">${emptyHtml()}</div>`;
                return;
            }
            slots.body.innerHTML = `<div class="ao-table-wrap ao-fade-r"><table class="ao-table ar-table">${THEAD}<tbody>${state.list.map(rowHtml).join("")}</tbody></table></div>
                <ul class="ao-cards">${state.list.map(cardHtml).join("")}</ul>`;
            measure();
        };
        const renderFoot = () => {
            if (state.phase === "loading") { slots.foot.innerHTML = `<div class="ao-foot-sk-row">${bar("10rem", "12px")}${bar("6rem", "12px")}</div>`; return; }
            if (state.phase === "error" || !state.list.length) { slots.foot.innerHTML = ""; return; }
            const { page, pageSize, total, totalPages } = state.meta;
            const from = (page - 1) * pageSize + 1;
            const to = Math.min(total, page * pageSize);
            slots.foot.innerHTML = `<div class="ao-foot ao-foot-flat"><p class="ao-count"><span class="ao-sm-only">${num(from)} tới ${num(to)} trong </span>${num(total)} đánh giá</p>${totalPages > 1 ? `<div class="ao-foot-nav">${pagerHtml(page, totalPages)}</div>` : ""}</div>`;
        };
        const renderAll = () => { renderTabs(); renderBody(); renderFoot(); };

        // Chỉ hiện "Xem thêm" khi bình luận thật sự bị kẹp
        const measure = () => {
            slots.body.querySelectorAll(".ar-comment").forEach((box) => {
                const btn = box.querySelector(".ar-more");
                if (!btn) return;
                if (box.classList.contains("is-open")) { btn.hidden = false; return; }
                const p = box.querySelector(".ar-text");
                btn.hidden = p.scrollHeight <= p.clientHeight + 1;
            });
        };
        window.addEventListener("resize", () => { clearTimeout(measureTimer); measureTimer = setTimeout(measure, 120); });

        // ---------- gọi API ----------
        const listUrl = () => {
            const params = new URLSearchParams({ page: String(state.page), pageSize: String(PAGE_SIZE), hidden: tabParam(state.tab) });
            if (state.pid !== "ALL") params.set("productId", state.pid);
            if (state.q.trim()) params.set("q", state.q.trim());
            return `/api/admin/reviews?${params}`;
        };
        const loadCounts = async () => {
            const results = await Promise.allSettled(TABS.map(([, , p]) => apiCall(`/api/admin/reviews?hidden=${p}&page=1&pageSize=1`, { method: "GET" })));
            if (results.some((r) => r.status !== "fulfilled")) return null;
            const counts = {};
            TABS.forEach(([k], i) => { counts[k] = Number(results[i].value?.meta?.total) || 0; });
            return counts;
        };
        const loadProducts = async () => {
            try {
                const all = [];
                let page = 1;
                let pages = 1;
                do {
                    const payload = await apiCall(`/api/admin/products?status=all&page=${page}&pageSize=48`, { method: "GET" });
                    (payload?.data || []).forEach((p) => all.push({ id: p.id, name: String(p.name || `Sản phẩm #${p.id}`), image: p.image || "" }));
                    pages = Number(payload?.meta?.totalPages) || 1;
                    page += 1;
                } while (page <= pages && page <= 10);
                all.sort((a, b) => a.name.localeCompare(b.name, "vi"));
                state.products = all;
                productSelect.refresh();
                productSelect.setValue(state.pid);
                if (state.phase === "ready") { renderBody(); }
            } catch (_) { /* bộ lọc sản phẩm chỉ còn "Tất cả"; thumbnail để trống */ }
        };
        // mode: "full" (lần đầu, thử lại), "list" (đổi lọc: giữ dòng cũ), "silent" (sau khi ghi / mở lại màn)
        const load = async (mode = "full") => {
            const mine = ++seq;
            if (mode === "full") { state.phase = "loading"; state.error = null; renderAll(); }
            else { state.fetching = true; slots.body.classList.toggle("is-fetching", state.phase === "ready"); }
            try {
                const [payload, counts] = await Promise.all([apiCall(listUrl(), { method: "GET" }), mode === "list" ? Promise.resolve(state.counts) : loadCounts()]);
                if (mine !== seq) return;
                state.list = Array.isArray(payload?.data) ? payload.data : [];
                state.meta = payload?.meta || { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 };
                state.page = state.meta.page || state.page;
                state.counts = counts;
                state.phase = "ready";
                state.fetching = false;
                renderAll();
                if (mode === "list") live(`${num(state.meta.total)} đánh giá`);
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
                    toast("Không tải lại được danh sách đánh giá.", "error");
                }
            }
        };
        const onFilterChange = () => {
            state.page = 1;
            renderTabs();
            productSelect.setValue(state.pid);
            load("list");
        };

        // ---------- ẩn / hiện lại (có hiệu lực ngay, đảo lại được) ----------
        const refocusAction = (id) => {
            const nodes = [...slots.body.querySelectorAll(`[data-role="toggle-hidden"][data-id="${id}"]`)];
            (nodes.find((n) => n.offsetParent !== null) || nodes[0])?.focus({ preventScroll: true });
        };
        const toggleHidden = async (id) => {
            const review = state.list.find((x) => x.id === id);
            if (!review || state.busy.has(id)) return;
            const next = !review.isHidden;
            state.busy.add(id);
            renderBody();
            refocusAction(id);
            live(next ? "Đang ẩn đánh giá" : "Đang hiện lại đánh giá");
            try {
                const payload = await apiCall(`/api/admin/reviews/${id}`, { method: "PATCH", body: { isHidden: next } });
                state.busy.delete(id);
                state.list = state.list.map((x) => (x.id === id ? { ...x, ...(payload?.data || {}), isHidden: payload?.data ? Boolean(payload.data.isHidden) : next } : x));
                if (state.counts) {
                    const delta = next ? 1 : -1;
                    state.counts = { ...state.counts, HIDDEN: Math.max(0, state.counts.HIDDEN + delta), VISIBLE: Math.max(0, state.counts.VISIBLE - delta) };
                }
                renderTabs();
                renderBody();
                refocusAction(id);
                const msg = next ? `Đã ẩn đánh giá của ${userOf(review)}. Không tính vào điểm trung bình nữa.` : `Đã hiện lại đánh giá của ${userOf(review)}.`;
                toast(msg, "success");
                live(msg);
            } catch (error) {
                state.busy.delete(id);
                renderBody();
                const info = apiError(error);
                const msg = info.status === 404 ? "Đánh giá này không còn tồn tại. Danh sách đã được tải lại." : !info.status ? "Mất kết nối tới máy chủ. Thử lại sau." : `Không ${next ? "ẩn" : "hiện lại"} được đánh giá. Thử lại sau.`;
                toast(msg, "error");
                live(msg);
                if (info.status === 404) load("silent"); else refocusAction(id);
            }
        };

        const clearFilter = () => {
            state.tab = "ALL"; state.pid = "ALL"; state.q = ""; searchInput.value = "";
            onFilterChange();
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
            const order = TABS.map((t) => t[0]);
            state.tab = order[(order.indexOf(state.tab) + keys[e.key] + order.length) % order.length];
            onFilterChange();
            const tab = slots.tabs.querySelector(`[data-tab="${state.tab}"]`);
            tab?.focus();
            tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        slots.body.addEventListener("click", (e) => {
            const t = e.target.closest("[data-role]");
            if (!t) return;
            const role = t.dataset.role;
            const id = Number(t.dataset.id);
            if (role === "toggle-hidden") toggleHidden(id);
            else if (role === "more") {
                const open = !state.expanded.has(id);
                if (open) state.expanded.add(id); else state.expanded.delete(id);
                slots.body.querySelectorAll(`.ar-comment[data-id="${id}"]`).forEach((box) => {
                    box.classList.toggle("is-open", open);
                    const b = box.querySelector(".ar-more");
                    b.textContent = open ? "Thu gọn" : "Xem thêm";
                    b.setAttribute("aria-expanded", String(open));
                });
                measure();
            } else if (role === "retry") load("full");
            else if (role === "clear-filter") clearFilter();
        });
        slots.foot.addEventListener("click", (e) => {
            const b = e.target.closest("[data-page]");
            if (!b || b.disabled) return;
            state.page = Number(b.dataset.page);
            load("list");
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (Kit.closeOpenSelect(true)) e.preventDefault();
        });
        rootEl.addEventListener("error", (e) => { if (e.target?.tagName === "IMG") e.target.style.visibility = "hidden"; }, true);

        instance.activate = () => { if (state.phase !== "loading") load("silent"); if (!state.products.length) loadProducts(); };
        renderAll();
        load("full");
        loadProducts();
    };

    const instance = { mount, activate: () => {} };
    window.AdminReviews = instance;
})();
