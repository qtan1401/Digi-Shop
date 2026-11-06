/* NodeShop admin: màn Đơn hàng, phương án C (danh sách bên trái, chi tiết bên phải).
 * Hợp đồng với khung admin:
 *   AdminOrders.mount(rootEl, { api, toast, initialOrderId })  gọi một lần, vẽ cả màn vào rootEl
 *   AdminOrders.select(orderId)                                 chọn đơn khi hash đổi
 * api(url, options) = DigiAuth.api (ném Error có .code/.status); toast(message, 'success'|'error'|'info').
 * Mọi thay đổi đơn bắn 'admin:orders-changed' { detail: { orders } } trên document.
 * Dữ liệu: GET /api/orders (lọc, sắp xếp, phân trang làm phía client), PATCH /api/orders/:id/status|payment-status.
 */
(() => {
    "use strict";

    const PAGE_SIZE = 10;
    const XL = "(min-width: 1280px)";
    const ORDER_STATUS = { PENDING: "Chờ xử lý", PROCESSING: "Đang chuẩn bị", SHIPPED: "Đang giao", DELIVERED: "Đã giao", CANCELLED: "Đã huỷ" };
    const PAY_STATUS = { UNPAID: "Chưa thanh toán", PAID: "Đã thanh toán", REFUNDED: "Đã hoàn tiền" };
    const NEXT_LABEL = { PENDING: "Xác nhận đơn", PROCESSING: "Giao cho vận chuyển", SHIPPED: "Đánh dấu đã giao" };
    // Khớp ORDER_STATUS_TRANSITIONS ở src/services/order.service.js (bỏ đích trùng chính nó).
    const NEXT_STATUS = { PENDING: "PROCESSING", PROCESSING: "SHIPPED", SHIPPED: "DELIVERED" };
    const METHOD = { MOMO: "MoMo", VNPAY: "VNPay", COD: "COD" };
    const STEPS = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"];
    const TABS = ["ALL", "PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
    const TONE = { PENDING: ["w", "circle-ellipsis"], PROCESSING: ["n", "circle-dot"], SHIPPED: ["n", "circle-arrow-right"], DELIVERED: ["s", "circle-check"], CANCELLED: ["e", "circle-x"] };
    const PAY_TONE = { UNPAID: ["n", "circle"], PAID: ["s", "circle-check"], REFUNDED: ["n", "undo-2"] };
    const SORTS = [["newest", "Mới nhất"], ["oldest", "Cũ nhất"], ["total-desc", "Tổng tiền cao nhất"], ["total-asc", "Tổng tiền thấp nhất"]];
    const tabLabel = (k) => (k === "ALL" ? "Tất cả" : ORDER_STATUS[k]);
    const canCancel = (s) => s === "PENDING" || s === "PROCESSING";

    const Kit = window.AdminKit;
    if (!Kit) return;
    // ---------- tiện ích ----------
    const { esc, vnd, ic, createSelect } = Kit;
    const pad = (n) => String(n).padStart(2, "0");

    const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    const hoursAgo = (h) => (h < 1 ? "vừa xong" : h < 24 ? `${h} giờ trước` : `${Math.floor(h / 24)} ngày ${h % 24} giờ trước`);
    const stamp = (d) => {
        const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const dm = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
        return { short: `${hm} · ${dm}`, full: `${hm} · ${dm}/${d.getFullYear()}`, iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hm}` };
    };
    const formatPhone = (p) => (/^\d{10}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p);
    const mediaXl = window.matchMedia(XL);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const toView = (raw, now) => {
        const c = raw.customer || {};
        const created = new Date(raw.createdAt);
        const items = (raw.items || []).map((it) => ({
            name: it.name || "",
            variant: it.options && typeof it.options === "object" ? Object.values(it.options).filter(Boolean).join(" · ") : "",
            qty: Number(it.quantity) || 0,
            price: Number(it.unitPrice) || 0,
            image: it.image || "",
        }));
        const sum = items.reduce((s, it) => s + it.price * it.qty, 0);
        const vouchers = Array.isArray(raw.vouchers) ? raw.vouchers.map((v) => ({ code: String(v.code || ""), type: v.type, percent: v.percent ?? null, amount: Number(v.amount) || 0 })) : [];
        return {
            id: raw.id, name: c.name || "", phone: c.phone || "", address: c.address || "", note: c.note || "",
            items, total: Number(raw.totalPrice) || 0, qty: items.reduce((s, it) => s + it.qty, 0),
            subtotal: raw.subtotal === undefined || raw.subtotal === null ? sum : Number(raw.subtotal) || 0,
            shipping: Number(raw.shippingFee) || 0, discount: Number(raw.discount) || 0, vouchers,
            method: METHOD[raw.paymentMethod] || raw.paymentMethod || "",
            status: raw.orderStatus, pay: raw.paymentStatus, created,
            age: Math.max(0, Math.floor((now - created.getTime()) / 36e5)),
            hay: fold(`${raw.id} ${c.name || ""}`), digits: String(c.phone || "").replace(/\D/g, ""),
        };
    };

    // ---------- mảnh HTML ----------
    const { badge } = Kit;
    const stBadge = (s) => badge(TONE[s]?.[0] || "n", esc(ORDER_STATUS[s] || s), TONE[s]?.[1] || "circle");
    const payBadge = (p) => badge(PAY_TONE[p]?.[0] || "n", esc(PAY_STATUS[p] || p), PAY_TONE[p]?.[1] || "circle");
    const { bar } = Kit;

    const waitHtml = (v) => {
        const w = stamp(v.created);
        const attrs = `datetime="${w.iso}" title="Đặt lúc ${w.full}"`;
        if (v.status === "PENDING") {
            const text = v.age < 1 ? "Chờ dưới 1 giờ" : `Chờ ${v.age} giờ`;
            return v.age >= 24
                ? `<time ${attrs} class="ao-wait ao-wait-late">${ic("clock", "ao-i3")}${text}</time>`
                : `<time ${attrs} class="ao-wait">${text}</time>`;
        }
        return `<time ${attrs} class="ao-wait ao-wait-muted">${hoursAgo(v.age)}</time>`;
    };

    // ---------- màn hình ----------
    const mount = (rootEl, options = {}) => {
        const apiCall = options.api || ((url, opts) => window.DigiAuth.api(url, opts));
        const toast = typeof options.toast === "function" ? options.toast : () => {};
        const state = {
            phase: "loading", error: null, orders: [], now: Date.now(),
            tab: "ALL", pay: "ALL", sort: "newest", q: "", page: 1,
            selectedId: null, panelOpen: false, busy: new Map(), pendingSelect: options.initialOrderId || null,
        };
        let confirmState = null;
        let lastTrigger = null;
        let scrollLocked = false;

        rootEl.innerHTML = `
            <div class="ao">
                <div class="ao-grid">
                    <section class="ao-list" aria-label="Danh sách đơn hàng">
                        <div class="ao-chips-block"><div class="ao-fade ao-fade-x scrollbar-clean"><div class="ao-chips" role="radiogroup" aria-label="Lọc theo trạng thái" data-slot="chips"></div></div></div>
                        <div class="ao-tools">
                            <label class="ao-search"><span class="ao-sr">Tìm đơn hàng</span><input type="search" class="ao-input" placeholder="Tìm theo mã đơn, tên khách, SĐT" autocomplete="off" data-role="search"></label>
                            <div class="ao-filters" data-slot="filters"></div>
                        </div>
                        <div data-slot="list"></div>
                        <div data-slot="foot"></div>
                    </section>
                    <div class="ao-right">
                        <div class="ao-detail" data-slot="detail" hidden>
                            <div class="ao-scrim" data-role="close"></div>
                            <aside class="ao-aside" tabindex="-1" data-slot="aside"></aside>
                        </div>
                        <div data-slot="ph"></div>
                    </div>
                </div>
                <p class="ao-sr" role="status" aria-live="polite" data-slot="live"></p>
            </div>`;
        const $ = (sel) => rootEl.querySelector(`[data-slot="${sel}"]`);
        const slots = { chips: $("chips"), filters: $("filters"), list: $("list"), foot: $("foot"), detail: $("detail"), aside: $("aside"), ph: $("ph"), live: $("live") };
        const searchInput = rootEl.querySelector('[data-role="search"]');
        const listSection = rootEl.querySelector(".ao-list");

        // ---- bộ lọc có select tự vẽ ----
        const countAll = (fn) => state.orders.filter(fn).length;
        const known = () => state.phase === "ready";
        const paySelect = createSelect({
            label: "Lọc theo thanh toán", size: "filter", wrap: "",
            getValueHtml: (v) => (v === "ALL"
                ? '<span class="ao-muted">Thanh toán<span class="ao-sm-only">:</span></span><span class="ao-sm-only"> Tất cả</span>'
                : `<span class="ao-muted">Thanh toán:</span> ${esc(PAY_STATUS[v])}`),
            getGroups: (v) => [[{ value: "ALL", html: "Tất cả", hint: known() ? state.orders.length : "" }, ...Object.keys(PAY_STATUS).map((k) => ({ value: k, html: PAY_STATUS[k], hint: known() ? countAll((o) => o.paymentStatus === k) : "" }))]],
            onSelect: (v) => { state.pay = v; paySelect.setValue(v); onFilterChange(); },
        });
        const sortSelect = createSelect({
            label: "Sắp xếp", size: "filter", edge: "right",
            getValueHtml: (v) => `<span class="ao-sort-val">${ic("arrow-down-wide-narrow", "ao-i4 ao-muted")}${esc(SORTS.find((s) => s[0] === v)[1])}</span>`,
            getGroups: () => [SORTS.map(([value, html]) => ({ value, html }))],
            onSelect: (v) => { state.sort = v; sortSelect.setValue(v); onFilterChange(); },
        });
        slots.filters.append(paySelect.el, sortSelect.el);
        paySelect.setValue("ALL");
        sortSelect.setValue("newest");

        // ---- dữ liệu dẫn xuất ----
        const views = () => state.orders.map((o) => toView(o, state.now));
        const filtered = () => {
            const q = fold(state.q.trim());
            const qd = state.q.replace(/\D/g, "");
            let list = views().filter((v) => (state.tab === "ALL" || v.status === state.tab) && (state.pay === "ALL" || v.pay === state.pay)
                && (!q || v.hay.includes(q) || (qd.length >= 3 && v.digits.includes(qd))));
            const by = { newest: (a, b) => b.created - a.created, oldest: (a, b) => a.created - b.created, "total-desc": (a, b) => b.total - a.total, "total-asc": (a, b) => a.total - b.total }[state.sort];
            list = list.sort(by);
            return list;
        };
        const pageOf = (list) => {
            const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
            state.page = Math.min(Math.max(1, state.page), pages);
            return { pages, rows: list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE), total: list.length };
        };
        const byId = (id) => state.orders.find((o) => o.id === id);
        const live = (msg) => { slots.live.textContent = ""; if (msg) setTimeout(() => { slots.live.textContent = msg; }, 20); };

        // ---- vẽ: chip trạng thái ----
        const renderChips = () => {
            slots.chips.innerHTML = TABS.map((k) => {
                const on = k === state.tab;
                const n = k === "ALL" ? state.orders.length : countAll((o) => o.orderStatus === k);
                const count = state.phase === "ready" ? `<span class="ao-chip-n">${n}</span>`
                    : state.phase === "loading" ? '<span class="ao-chip-sk"></span>' : "";
                return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-tab="${k}" class="ao-chip">${tabLabel(k)}${count}</button>`;
            }).join("");
        };

        // ---- vẽ: danh sách ----
        const skItem = (k) => `<li class="ao-sk-item"><div class="ao-sk ao-sk-img"></div><div class="ao-item-body">
            <div class="ao-sk-row">${bar(["8rem", "7rem", "9rem"][k % 3], "12px")}${bar("5rem", "12px")}</div>
            <div class="ao-sk-row" style="margin-top:10px">${bar("7rem", "12px")}${bar("4rem", "12px")}</div>
            <div class="ao-sk-row" style="margin-top:12px;justify-content:flex-start;gap:6px">${bar("6rem", "24px")}${bar("7rem", "24px")}</div></div></li>`;
        const emptyText = () => {
            const parts = [];
            if (state.tab !== "ALL") parts.push(tabLabel(state.tab).toLowerCase());
            if (state.pay !== "ALL") parts.push(PAY_STATUS[state.pay].toLowerCase());
            if (state.q.trim()) parts.push(`khớp “${esc(state.q.trim())}”`);
            return `Không có đơn nào ${parts.join(" ")}`.trim();
        };
        const itemHtml = (v) => {
            const img = v.items[0]?.image;
            const sel = v.id === state.selectedId;
            return `<li><button type="button" class="ao-item" data-id="${esc(v.id)}" ${sel ? 'aria-current="true"' : ""}>
                ${img ? `<img src="${esc(img)}" alt="" class="ao-thumb ao-thumb-40">` : '<span class="ao-thumb-40-blank"></span>'}
                <span class="ao-item-body">
                    <span class="ao-r1"><span class="ao-cust">${esc(v.name)}</span><span class="ao-total">${vnd(v.total)}</span></span>
                    <span class="ao-r2"><span class="ao-id">${esc(v.id)}</span><span class="ao-r2-wait">${waitHtml(v)}</span></span>
                    <span class="ao-r3">${stBadge(v.status)}${payBadge(v.pay)}</span>
                </span></button></li>`;
        };
        const renderList = () => {
            if (state.phase === "loading") {
                slots.list.innerHTML = `<div data-block="5"><ul class="ao-items" aria-busy="true">${Array.from({ length: 8 }, (_, k) => skItem(k)).join("")}</ul><span class="ao-sr" role="status">Đang tải danh sách đơn hàng</span></div>`;
                return;
            }
            if (state.phase === "error") {
                const net = !state.error?.status;
                slots.list.innerHTML = `<div class="ao-block-top"><div role="alert" class="ao-err"><div><p class="ao-err-title">Không tải được danh sách đơn hàng</p><p class="ao-err-msg">${net ? "Mất kết nối tới máy chủ" : "Máy chủ gặp lỗi, thử lại sau ít phút"}</p></div>
                    <button type="button" class="ao-btn ao-btn-outline" data-role="retry">${ic("rotate-cw", "ao-i4 ao-shrink")}Thử lại</button></div></div>`;
                return;
            }
            if (!state.orders.length) {
                slots.list.innerHTML = '<div class="ao-block-top"><p class="ao-empty">Chưa có đơn hàng nào.</p></div>';
                return;
            }
            const { rows } = pageOf(filtered());
            if (!rows.length) {
                slots.list.innerHTML = `<div class="ao-block-top"><p class="ao-empty">${emptyText()}. <button type="button" class="ao-linkbtn" data-role="clear-filter">Xoá lọc</button></p></div>`;
                return;
            }
            slots.list.innerHTML = `<ul class="ao-items">${rows.map(itemHtml).join("")}</ul>`;
        };

        // ---- vẽ: chân danh sách ----
        const pagerHtml = (page, pages) => {
            const arrow = (dir, dis) => `<button type="button" class="ao-pg-arrow" data-page="${dir === "left" ? page - 1 : page + 1}" aria-label="Trang ${dir === "left" ? "trước" : "sau"}" ${dis ? "disabled" : ""}>${ic(`chevron-${dir}`, "ao-i4")}</button>`;
            const mid = pages <= 5
                ? Array.from({ length: pages }, (_, k) => k + 1).map((n) => `<button type="button" data-page="${n}" ${n === page ? 'aria-current="page"' : ""} class="ao-pg-num ${n === page ? "is-on" : ""}">${n}</button>`).join("")
                : `<span class="ao-pg-of">${page} / ${pages}</span>`;
            return `<nav aria-label="Phân trang" class="ao-pager">${arrow("left", page === 1)}${mid}${arrow("right", page === pages)}</nav>`;
        };
        const renderFoot = () => {
            if (state.phase === "loading") {
                slots.foot.innerHTML = `<div class="ao-foot ao-foot-sk">${bar("8rem", "12px")}${bar("5rem", "12px")}</div>`;
                return;
            }
            if (state.phase !== "ready" || !state.orders.length) { slots.foot.innerHTML = ""; return; }
            const { pages, total } = pageOf(filtered());
            if (!total) { slots.foot.innerHTML = ""; return; }
            const from = (state.page - 1) * PAGE_SIZE + 1;
            const to = Math.min(total, state.page * PAGE_SIZE);
            slots.foot.innerHTML = `<div class="ao-foot"><p class="ao-count">${from} tới ${to} trong ${total} đơn</p><div class="ao-foot-nav">${pagerHtml(state.page, pages)}</div></div>`;
        };

        // ---- vẽ: chi tiết ----
        const dlRow = (k, v, centered = false) => `<div class="ao-dl-row ${centered ? "is-center" : ""}"><dt>${k}</dt><dd>${v}</dd></div>`;
        const itemRow = (it) => `<li class="ao-line">
            ${it.image ? `<img src="${esc(it.image)}" alt="" class="ao-thumb ao-thumb-48">` : ""}
            <div class="ao-line-main"><p class="ao-line-name">${esc(it.name)}</p>${it.variant ? `<p class="ao-line-variant">${esc(it.variant)}</p>` : ""}</div>
            <div class="ao-line-price"><p class="ao-line-sum">${vnd(it.qty * it.price)}</p>${it.qty > 1 ? `<p class="ao-line-unit">${it.qty} × ${vnd(it.price)}</p>` : ""}</div></li>`;
        const payValue = (p) => `<span class="ao-payval">${ic(PAY_TONE[p]?.[1] || "circle", `ao-i4 ao-text-${PAY_TONE[p]?.[0] || "n"}`)}${esc(PAY_STATUS[p] || p)}</span>`;
        const stepper = (v) => {
            if (v.status === "CANCELLED") return `<p class="ao-cancelled">${ic("circle-x", "ao-i4 ao-shrink")}Đơn đã huỷ, không còn bước tiếp theo.</p>`;
            const cur = STEPS.indexOf(v.status);
            const done = v.status === "DELIVERED";
            const wide = STEPS.map((s, k) => {
                const isDone = k < cur || (done && k === cur);
                const isCur = k === cur && !done;
                const circle = isDone ? `<span class="ao-step-c is-done">${ic("check", "ao-i4")}</span>`
                    : isCur ? `<span class="ao-step-c is-cur">${k + 1}</span>` : `<span class="ao-step-c is-todo">${k + 1}</span>`;
                const label = k === cur ? "is-cur" : k < cur ? "is-past" : "";
                return `<li ${isCur || (done && k === cur) ? 'aria-current="step"' : ""} class="ao-step ${k < 3 ? "is-grow" : ""}"><div class="ao-step-top">${circle}${k < 3 ? `<span class="ao-step-line ${k < cur ? "is-done" : ""}"></span>` : ""}</div><span class="ao-step-l ${label}">${ORDER_STATUS[s]}</span></li>`;
            }).join("");
            const seg = STEPS.map((s, k) => `<span class="ao-seg ${done || k < cur ? "is-done" : k === cur ? "is-cur" : ""}"></span>`).join("");
            return `<div class="ao-stepper"><ol class="ao-steps" aria-label="Tiến trình đơn">${wide}</ol><div class="ao-steps-m"><p class="ao-steps-n">Bước ${cur + 1} / 4</p><div class="ao-segs" aria-hidden="true">${seg}</div></div></div>`;
        };
        // Phần giá (donhang-giamgia A): tạm tính + phí ship − từng voucher = tổng cộng
        const bkRow = (k, val, muted = false) => `<div class="ao-bk-row"><dt class="${muted ? "ao-muted" : ""}">${k}</dt><dd>${val}</dd></div>`;
        const voucherSub = (vc) => (vc.type === "FREE_SHIPPING" ? "Miễn phí vận chuyển" : `Giảm ${vc.percent ?? 0}%`);
        const priceHtml = (v) => {
            let discountRows;
            if (v.vouchers.length) {
                discountRows = v.vouchers.map((vc) => `<div class="ao-bk-row ao-bk-voucher"><dt><span class="ao-codetag">${ic(vc.type === "FREE_SHIPPING" ? "truck" : "ticket-percent", "ao-i3 ao-muted")}<span class="ao-codetag-text">${esc(vc.code)}</span></span><span class="ao-bk-sub">${voucherSub(vc)}</span></dt><dd class="ao-bk-minus">−${vnd(vc.amount)}</dd></div>`).join("");
            } else if (v.discount > 0) {
                discountRows = bkRow("Giảm giá", `−${vnd(v.discount)}`);
            } else {
                discountRows = bkRow("Voucher", "Không dùng", true);
            }
            return `<dl class="ao-bk" aria-label="Chi tiết giá">
                ${bkRow(`Tạm tính&nbsp;· ${v.qty}&nbsp;sản&nbsp;phẩm`, vnd(v.subtotal))}
                ${bkRow("Phí vận chuyển", vnd(v.shipping))}
                ${discountRows}</dl>
                <div class="ao-totalrow"><p class="ao-totalrow-l">Tổng cộng</p><p class="ao-totalrow-v">${vnd(v.total)}</p></div>`;
        };
        const detailHtml = (v) => {
            const w = stamp(v.created);
            const busy = state.busy.get(v.id);
            const next = NEXT_STATUS[v.status];
            const foot = next ? `<div class="ao-actions">
                ${canCancel(v.status) ? `<button type="button" class="ao-btn ao-btn-danger" data-role="cancel" ${busy ? "disabled" : ""}>Huỷ đơn</button>` : ""}
                <button type="button" class="ao-btn ao-btn-primary ao-push" data-role="next" ${busy ? "disabled" : ""}>${busy && busy.kind === "status" ? "Đang lưu…" : NEXT_LABEL[v.status]}</button></div>` : "";
            return `<div class="ao-head">
                    <div class="ao-head-main">
                        <div class="ao-head-title"><h2>Đơn <span class="ao-mono">${esc(v.id)}</span></h2><button type="button" class="ao-icon-btn ao-icon-32" data-role="copy" aria-label="Sao chép mã đơn" title="Sao chép mã đơn">${ic("copy")}</button></div>
                        <div class="ao-head-meta"><span class="ao-head-badge">${stBadge(v.status)}</span><span class="ao-muted-14">Đặt lúc <time datetime="${w.iso}">${w.short}</time></span>${v.status === "PENDING" ? `<span class="ao-14">${waitHtml(v)}</span>` : ""}</div>
                    </div>
                    <button type="button" class="ao-icon-btn ao-close" data-role="close" aria-label="Đóng">${ic("x")}</button>
                </div>
                <div class="ao-body" data-role="body">
                    <section>${stepper(v)}</section>
                    <section class="ao-sec"><h3 class="ao-h3">Khách hàng</h3><dl class="ao-dl">
                        ${dlRow("Họ tên", esc(v.name))}
                        ${dlRow("Điện thoại", `<a href="tel:${esc(v.phone.replace(/\s/g, ""))}" class="ao-tel">${esc(formatPhone(v.phone))}</a>`)}
                        ${dlRow("Địa chỉ", esc(v.address))}
                        ${dlRow("Ghi chú", v.note ? esc(v.note) : '<span class="ao-muted ao-normal">—</span>')}</dl></section>
                    <section class="ao-sec"><h3 class="ao-h3">Sản phẩm</h3><ul class="ao-lines">${v.items.map(itemRow).join("")}</ul></section>
                    <section class="ao-sec"><h3 class="ao-h3">Thanh toán</h3>${priceHtml(v)}
                        <dl class="ao-dl ao-dl-pay">
                        ${dlRow("Phương thức", esc(v.method))}
                        <div class="ao-dl-row is-center"><dt>Trạng thái</dt><dd class="ao-dd-plain" data-slot="pay-select"></dd></div></dl></section>
                </div>${foot}`;
        };
        let paySel = null;
        let pendingFocus = null;
        const renderDetail = () => {
            const v = state.phase === "ready" ? views().find((x) => x.id === state.selectedId) : null;
            const active = document.activeElement;
            const sameOrder = v && slots.aside.dataset.order === v.id;
            const keepRole = pendingFocus || (sameOrder && active && slots.aside.contains(active) ? (active === slots.aside ? "aside" : active.dataset.role) : null);
            const keepScroll = sameOrder ? (slots.aside.querySelector('[data-role="body"]')?.scrollTop || 0) : 0;
            // phần giữ chỗ (xl): khung chờ, gợi ý
            if (v) {
                slots.ph.innerHTML = "";
                slots.detail.hidden = false;
                slots.aside.setAttribute("aria-label", `Chi tiết đơn ${v.id}`);
                slots.aside.innerHTML = detailHtml(v);
                const busy = state.busy.get(v.id);
                paySel = createSelect({
                    label: "Đổi trạng thái thanh toán", size: "lg", up: true, wrap: "ao-sel-pay",
                    getValueHtml: (p) => (busy && busy.kind === "pay" ? `<span class="ao-payval">${esc(PAY_STATUS[busy.to])} · Đang lưu…</span>` : payValue(p)),
                    getGroups: (p) => [Object.keys(PAY_STATUS).map((k) => ({ value: k, html: PAY_STATUS[k] }))],
                    onSelect: (p) => changePayment(v.id, p),
                });
                paySel.trigger.dataset.role = "pay";
                paySel.setValue(v.pay);
                paySel.setDisabled(Boolean(busy));
                slots.aside.querySelector('[data-slot="pay-select"]').append(paySel.el);
                slots.aside.dataset.order = v.id;
                const body = slots.aside.querySelector('[data-role="body"]');
                if (body && keepScroll) body.scrollTop = keepScroll;
                if (keepRole) {
                    const again = keepRole === "aside" ? null : slots.aside.querySelector(`[data-role="${keepRole}"]:not([disabled])`);
                    if (again || !busy) { (again || slots.aside).focus({ preventScroll: true }); pendingFocus = null; }
                }
                syncDialogRole();
            } else {
                slots.detail.hidden = true;
                slots.aside.innerHTML = "";
                paySel = null;
                if (state.phase === "loading") {
                    slots.ph.innerHTML = `<div aria-busy="true" class="ao-ph ao-ph-sk">
                        <div class="ao-ph-sk-head">${bar("16rem", "20px")}<div style="display:flex;gap:12px;margin-top:12px">${bar("7rem", "24px")}${bar("8rem", "16px")}</div></div>
                        <div class="ao-ph-sk-body"><div style="display:flex;align-items:center;gap:8px">${bar("32px", "32px")}${bar("100%", "2px", "ao-grow")}${bar("32px", "32px")}${bar("100%", "2px", "ao-grow")}${bar("32px", "32px")}${bar("100%", "2px", "ao-grow")}${bar("32px", "32px")}</div>
                            <div class="ao-ph-sk-sec">${bar("6rem", "12px")}${bar("60%", "12px")}${bar("40%", "12px")}${bar("50%", "12px")}</div>
                            <div class="ao-ph-sk-sec">${bar("5rem", "12px")}<div style="display:flex;align-items:center;gap:12px">${bar("48px", "48px", "ao-r8")}<div style="flex:1;display:flex;flex-direction:column;gap:8px">${bar("50%", "12px")}${bar("33%", "12px")}</div></div></div></div>
                        <span class="ao-sr" role="status">Đang tải chi tiết đơn</span></div>`;
                } else {
                    slots.ph.innerHTML = '<div class="ao-ph ao-ph-hint"><p>Chọn một đơn ở bên trái để xem chi tiết.</p></div>';
                }
            }
            syncPanel();
        };
        const syncDialogRole = () => {
            const modal = !mediaXl.matches;
            slots.aside.setAttribute("role", modal ? "dialog" : "region");
            if (modal) slots.aside.setAttribute("aria-modal", "true"); else slots.aside.removeAttribute("aria-modal");
        };

        const renderAll = () => { renderChips(); renderList(); renderFoot(); renderDetail(); };

        // ---- panel trượt (dưới 1280) ----
        const lockScroll = (on) => {
            if (on === scrollLocked) return;
            scrollLocked = on;
            document.documentElement.style.overflow = on ? "hidden" : "";
        };
        const syncPanel = () => {
            const open = state.panelOpen && !mediaXl.matches && Boolean(state.selectedId);
            slots.detail.toggleAttribute("data-open", open && !slots.detail.hidden);
            listSection.toggleAttribute("inert", open);
            lockScroll(open);
        };
        const openPanel = (trigger) => {
            if (mediaXl.matches) return;
            lastTrigger = trigger || null;
            state.panelOpen = true;
            syncPanel();
            requestAnimationFrame(() => slots.aside.focus({ preventScroll: true }));
        };
        const closePanel = () => {
            if (!state.panelOpen) return;
            state.panelOpen = false;
            syncPanel();
            const target = (lastTrigger && document.contains(lastTrigger) && lastTrigger) || slots.list.querySelector(`.ao-item[data-id="${CSS.escape(state.selectedId || "")}"]`) || slots.list.querySelector(".ao-item");
            target?.focus({ preventScroll: true });
        };

        // ---- chọn đơn ----
        const writeHash = (id) => {
            try { history.replaceState(history.state, "", `${location.pathname}${location.search}#/don-hang/${encodeURIComponent(id)}`); } catch (_) { /* môi trường không cho đổi hash */ }
        };
        const selectOrder = (id, { open = true, hash = true, trigger = null } = {}) => {
            if (!byId(id)) return false;
            state.selectedId = id;
            if (hash) writeHash(id);
            renderList();
            renderDetail();
            if (open) openPanel(trigger);
            return true;
        };
        // Từ 1280 luôn có một đơn đang xem khi danh sách không rỗng (như wireframe); dưới 1280 để panel đóng.
        const ensureSelection = () => {
            if (state.phase !== "ready") return;
            const { rows } = pageOf(filtered());
            if (!mediaXl.matches) {
                if (state.selectedId && !rows.some((v) => v.id === state.selectedId) && !state.panelOpen) state.selectedId = null;
                return;
            }
            if (!rows.length) { state.selectedId = null; return; }
            if (!rows.some((v) => v.id === state.selectedId)) state.selectedId = rows[0].id;
        };
        const onFilterChange = () => {
            state.page = 1;
            ensureSelection();
            renderChips();
            renderList();
            renderFoot();
            renderDetail();
        };
        const revealSelected = () => {
            const v = views().find((x) => x.id === state.selectedId);
            if (!v) return;
            const list = filtered();
            const idx = list.findIndex((x) => x.id === v.id);
            if (idx < 0) {
                state.tab = "ALL"; state.pay = "ALL"; state.q = ""; searchInput.value = "";
                paySelect.setValue("ALL");
                const all = filtered();
                state.page = Math.floor(all.findIndex((x) => x.id === v.id) / PAGE_SIZE) + 1;
            } else state.page = Math.floor(idx / PAGE_SIZE) + 1;
        };
        const applyPendingSelect = () => {
            const id = state.pendingSelect;
            state.pendingSelect = null;
            if (id && byId(id)) {
                state.selectedId = id;
                revealSelected();
                state.panelOpen = !mediaXl.matches;
            }
        };

        // ---- gọi API ----
        const emitChanged = () => document.dispatchEvent(new CustomEvent("admin:orders-changed", { detail: { orders: state.orders } }));
        const load = async () => {
            state.phase = "loading";
            state.error = null;
            renderAll();
            syncPanel();
            try {
                const payload = await apiCall(loadUrl, { method: "GET" });
                const list = Array.isArray(payload?.data) ? payload.data : [];
                state.orders = list;
                state.now = Date.now();
                state.phase = "ready";
                applyPendingSelect();
                if (!state.pendingSelect) ensureSelection();
                renderAll();
                syncPanel();
                if (state.panelOpen) requestAnimationFrame(() => slots.aside.focus({ preventScroll: true }));
                emitChanged();
            } catch (error) {
                state.phase = "error";
                state.error = error;
                renderAll();
                syncPanel();
            }
        };
        const failMessage = (error, what) => {
            if (error?.code === "INVALID_ORDER_TRANSITION") return "Đơn không thể chuyển sang bước này vì trạng thái hiện tại đã thay đổi. Danh sách đã được tải lại.";
            if (error?.code === "ORDER_NOT_FOUND") return "Không tìm thấy đơn hàng này.";
            if (!error?.status) return "Mất kết nối tới máy chủ. Thử lại sau.";
            return `Không ${what} được. Thử lại sau.`;
        };
        const replaceOrder = (next) => {
            const i = state.orders.findIndex((o) => o.id === next.id);
            if (i >= 0) state.orders[i] = next; else state.orders.unshift(next);
        };
        const silentReload = async () => {
            try {
                const payload = await apiCall(loadUrl, { method: "GET" });
                if (Array.isArray(payload?.data)) { state.orders = payload.data; state.now = Date.now(); }
            } catch (_) { /* giữ dữ liệu cũ */ }
        };
        const patch = async (id, kind, status) => {
            const url = `/api/orders/${encodeURIComponent(id)}/${kind === "pay" ? "payment-status" : "status"}`;
            const focused = document.activeElement;
            if (!confirmState && focused && slots.aside.contains(focused) && focused.dataset.role) pendingFocus = focused.dataset.role;
            state.busy.set(id, { kind, to: status });
            live(kind === "pay" ? "Đang lưu trạng thái thanh toán" : "Đang lưu trạng thái đơn");
            renderDetail();
            if (confirmState) confirmState.setBusy(true);
            try {
                const payload = await apiCall(url, { method: "PATCH", body: { status } });
                if (payload?.data?.id) replaceOrder(payload.data); else await silentReload();
                state.now = Date.now();
                state.busy.delete(id);
                renderChips(); renderList(); renderFoot(); renderDetail();
                emitChanged();
                return true;
            } catch (error) {
                state.busy.delete(id);
                if (error?.code === "INVALID_ORDER_TRANSITION") await silentReload();
                renderChips(); renderList(); renderFoot(); renderDetail();
                if (error?.code === "INVALID_ORDER_TRANSITION") emitChanged();
                const msg = failMessage(error, kind === "pay" ? "đổi trạng thái thanh toán" : "cập nhật đơn hàng");
                toast(msg, "error");
                live(msg);
                return false;
            }
        };
        const advance = async (id) => {
            const order = byId(id);
            const next = order && NEXT_STATUS[order.orderStatus];
            if (!next) return;
            if (await patch(id, "status", next)) {
                const msg = `Đã chuyển đơn ${id} sang ${ORDER_STATUS[next]}`;
                toast(msg, "success");
                live(msg);
            }
        };
        const changePayment = async (id, status) => {
            if (await patch(id, "pay", status)) {
                const msg = `Đã đổi thanh toán đơn ${id} sang ${PAY_STATUS[status]}`;
                toast(msg, "success");
                live(msg);
            }
        };

        // ---- hộp xác nhận huỷ đơn (overlay.md: hộp xác nhận) ----
        const openConfirm = (id, opener) => {
            const v = views().find((x) => x.id === id);
            if (!v || confirmState) return;
            const uid = `ao-confirm-${Math.random().toString(36).slice(2, 7)}`;
            const el = document.createElement("div");
            el.className = "ao-modal";
            el.innerHTML = `<div class="ao-modal-scrim"></div>
                <div class="ao-modal-box" role="alertdialog" aria-modal="true" aria-labelledby="${uid}-t" aria-describedby="${uid}-d">
                    <div class="ao-modal-head">
                        <div class="ao-modal-icon">${ic("package-x", "ao-i5 ao-text-danger")}</div>
                        <h2 id="${uid}-t">Huỷ đơn này?</h2>
                        <div class="ao-modal-desc"><p id="${uid}-d"><span class="ao-mono ao-strong">${esc(v.id)}</span> của <span class="ao-strong">${esc(v.name)}</span> sẽ chuyển sang Đã huỷ và không mở lại được.</p></div>
                    </div>
                    <div class="ao-modal-actions">
                        <button type="button" class="ao-btn ao-btn-secondary" data-role="keep">Giữ đơn</button>
                        <button type="button" class="ao-btn ao-btn-danger" data-role="confirm">Huỷ đơn</button>
                    </div></div>`;
            rootEl.querySelector(".ao").appendChild(el);
            const keep = el.querySelector('[data-role="keep"]');
            const confirm = el.querySelector('[data-role="confirm"]');
            let busy = false;
            const close = () => {
                el.removeAttribute("data-open");
                confirmState = null;
                const back = opener && document.contains(opener) ? opener : slots.aside;
                back.focus?.({ preventScroll: true });
                setTimeout(() => el.remove(), reduceMotion.matches ? 0 : 120);
            };
            confirmState = {
                el,
                cancel() { if (!busy) close(); },
                setBusy(b) { busy = b; keep.disabled = b; confirm.disabled = b; confirm.textContent = b ? "Đang lưu…" : "Huỷ đơn"; },
                done: close,
            };
            keep.addEventListener("click", () => confirmState?.cancel());
            confirm.addEventListener("click", async () => {
                if (busy) return;
                const ok = await patch(id, "status", "CANCELLED");
                if (ok) {
                    const msg = `Đã huỷ đơn ${id}`;
                    toast(msg, "success");
                    live(msg);
                    confirmState?.done();
                } else {
                    const cur = byId(id);
                    if (!cur || !canCancel(cur.orderStatus)) confirmState?.done(); else confirmState?.setBusy(false);
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

        // ---- sự kiện ----
        searchInput.addEventListener("input", () => { state.q = searchInput.value; onFilterChange(); });
        slots.chips.addEventListener("click", (e) => {
            const b = e.target.closest("[data-tab]");
            if (!b || b.dataset.tab === state.tab) return;
            state.tab = b.dataset.tab;
            onFilterChange();
        });
        slots.chips.addEventListener("keydown", (e) => {
            const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
            if (!(e.key in keys)) return;
            e.preventDefault();
            const i = TABS.indexOf(state.tab);
            state.tab = TABS[(i + keys[e.key] + TABS.length) % TABS.length];
            onFilterChange();
            const chip = slots.chips.querySelector(`[data-tab="${state.tab}"]`);
            chip?.focus();
            chip?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        slots.list.addEventListener("click", (e) => {
            const item = e.target.closest(".ao-item");
            if (item) { selectOrder(item.dataset.id, { trigger: item }); return; }
            if (e.target.closest('[data-role="retry"]')) { load(); return; }
            if (e.target.closest('[data-role="clear-filter"]')) {
                state.tab = "ALL"; state.pay = "ALL"; state.q = ""; searchInput.value = "";
                paySelect.setValue("ALL");
                onFilterChange();
            }
        });
        slots.foot.addEventListener("click", (e) => {
            const b = e.target.closest("[data-page]");
            if (!b || b.disabled) return;
            state.page = Number(b.dataset.page);
            ensureSelection();
            renderList(); renderFoot(); renderDetail();
        });
        slots.detail.addEventListener("click", (e) => {
            const t = e.target.closest("[data-role]");
            if (!t) return;
            const role = t.dataset.role;
            if (role === "close") closePanel();
            else if (role === "next") advance(state.selectedId);
            else if (role === "cancel") openConfirm(state.selectedId, t);
            else if (role === "copy") copyId(state.selectedId);
        });
        const copyId = async (id) => {
            try {
                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(id);
                else {
                    const ta = document.createElement("textarea");
                    ta.value = id; ta.style.position = "fixed"; ta.style.opacity = "0";
                    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
                }
                toast("Đã sao chép mã đơn", "success");
            } catch (_) { toast("Không sao chép được mã đơn", "error"); }
        };
        slots.aside.addEventListener("keydown", (e) => {
            if (e.key !== "Tab" || mediaXl.matches || !state.panelOpen || confirmState) return;
            const f = [...slots.aside.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')].filter((n) => n.offsetParent !== null);
            if (!f.length) return;
            const i = f.indexOf(document.activeElement);
            if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
            else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (confirmState) { e.preventDefault(); confirmState.cancel(); return; }
            if (Kit.closeOpenSelect(true)) { e.preventDefault(); return; }
            if (state.panelOpen && !mediaXl.matches) { e.preventDefault(); closePanel(); }
        });
        // pointerdown ngoài select: kit tự đóng (một lần cho cả trang).
        rootEl.addEventListener("error", (e) => { if (e.target?.tagName === "IMG") e.target.style.visibility = "hidden"; }, true);
        mediaXl.addEventListener("change", () => {
            if (mediaXl.matches) { state.panelOpen = false; ensureSelection(); renderList(); }
            syncDialogRole();
            syncPanel();
            renderDetail();
        });

        const loadUrl = "/api/orders";

        instance.select = (id) => {
            if (state.phase !== "ready") { state.pendingSelect = id; return; }
            if (!byId(id)) return;
            state.selectedId = id;
            revealSelected();
            renderChips(); renderList(); renderFoot(); renderDetail();
            openPanel(null);
        };
        load();
    };

    const instance = { mount, select: () => {} };
    window.AdminOrders = instance;
})();
