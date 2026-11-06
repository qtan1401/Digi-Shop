// ===== MY-ORDERS.JS =====
// Trang "Đơn hàng của tôi" (lichsu-donhang B): lọc theo trạng thái, danh sách bên trái, chi tiết bên phải
// (dưới 1024px là hai màn nối bằng nút quay lại). Trạng thái nằm trên URL: ?loc= (lọc), ?trang= (trang), ?don= (đơn đang xem).
// Cần: catalog-renderer.js (escapeHtml, renderPagination), ui-icons.js, auth.js (DigiAuth).

(function () {
    "use strict";
    const root = document.querySelector("[data-mo]");
    if (!root) return;
    const R = window.CatalogRenderer;
    const { escapeHtml } = R;
    const icon = (name, cls) => window.UiIcons.icon(name, cls);
    const PAGE_SIZE = 10;

    // Cùng chữ với admin-orders.js
    const ORDER_STATUS = { PENDING: "Chờ xử lý", PROCESSING: "Đang chuẩn bị", SHIPPED: "Đang giao", DELIVERED: "Đã giao", CANCELLED: "Đã huỷ" };
    const PAY_STATUS = { UNPAID: "Chưa thanh toán", PAID: "Đã thanh toán", REFUNDED: "Đã hoàn tiền" };
    const ST_TONE = { PENDING: ["w", "circle-ellipsis"], PROCESSING: ["n", "circle-dot"], SHIPPED: ["n", "circle-arrow-right"], DELIVERED: ["s", "circle-check"], CANCELLED: ["e", "circle-x"] };
    const PAY_TONE = { UNPAID: ["n", "circle"], PAID: ["s", "circle-check"], REFUNDED: ["n", "undo-2"] };
    const STEPS = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"];
    const TABS = [["all", "Tất cả"], ...Object.entries(ORDER_STATUS)];

    const el = {
        head: root.querySelector("[data-mo-head]"),
        title: root.querySelector("#mo-title"),
        gate: root.querySelector("[data-mo-gate]"),
        body: root.querySelector("[data-mo-body]"),
        chips: root.querySelector("[data-mo-chips]"),
        grid: root.querySelector("[data-mo-grid]"),
        listCard: root.querySelector("[data-mo-list-card]"),
        list: root.querySelector("[data-mo-list]"),
        pager: root.querySelector("[data-mo-pager]"),
        right: root.querySelector("[data-mo-right]"),
        live: root.querySelector("[data-mo-live]")
    };
    const desktopQuery = window.matchMedia("(min-width: 1024px)");

    const st = {
        auth: "checking", // checking | guest | admin | user
        url: { tab: "all", page: 1, don: "" },
        list: { status: "loading", key: "", ver: 0, data: [], meta: null },
        detail: { status: "idle", id: "", data: null },
        desktop: desktopQuery.matches,
        focus: "", // detail | row | list: việc đưa focus còn chờ dữ liệu về
        lastDon: ""
    };
    let listSeq = 0;
    let detailSeq = 0;
    const rendered = { listVer: -1, listMode: "", chips: "", detail: "" };

    // ---------- định dạng ----------
    const pad = (n) => String(n).padStart(2, "0");
    const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
    const fmtDateTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const money = (n) => `${Number(n || 0).toLocaleString("vi-VN")}₫`;
    const e = escapeHtml;
    const methodLabel = (raw) => {
        const value = String(raw || "");
        const upper = value.toUpperCase();
        if (upper === "MOMO") return "MoMo";
        if (upper === "VNPAY") return "VNPay";
        if (upper === "COD" || /\(COD\)/.test(upper)) return "Khi nhận hàng";
        return value;
    };
    const isCod = (raw) => methodLabel(raw) === "Khi nhận hàng";
    // Chưa thanh toán qua cổng online mới đáng chú ý (hổ phách); COD chưa trả là bình thường (xám).
    const payTone = (o) => (o.paymentStatus === "UNPAID" && !isCod(o.paymentMethod) ? "w" : (PAY_TONE[o.paymentStatus] || ["n"])[0]);
    const optionText = (options) => (options && typeof options === "object" ? Object.values(options).filter((v) => v !== null && v !== "").join(" · ") : "");
    const tabLabel = (tab) => (TABS.find(([key]) => key === tab) || [, tab])[1];

    // ---------- URL ----------
    const parseSearch = (search) => {
        const q = new URLSearchParams(search);
        const loc = q.get("loc");
        const page = q.get("trang") || "";
        return { tab: Object.hasOwn(ORDER_STATUS, loc || "") ? loc : "all", page: /^[1-9]\d{0,5}$/.test(page) ? Number(page) : 1, don: (q.get("don") || "").trim().slice(0, 64) };
    };
    const buildUrl = ({ tab, page, don }) => {
        const q = new URLSearchParams();
        if (tab && tab !== "all") q.set("loc", tab);
        if (page > 1) q.set("trang", String(page));
        if (don) q.set("don", don);
        const qs = q.toString();
        return `${location.pathname}${qs ? `?${qs}` : ""}`;
    };
    const hrefOf = (patch) => e(buildUrl({ ...st.url, ...patch }));

    const announce = (text) => { el.live.textContent = ""; el.live.textContent = text; };

    // ---------- mảnh giao diện dùng chung ----------
    const badge = (tone, label, name) => `<span class="mo-badge mo-tone-${tone}">${icon(name)}${e(label)}</span>`;
    const stBadge = (s) => badge((ST_TONE[s] || ["n"])[0], ORDER_STATUS[s] || s, (ST_TONE[s] || [, "circle"])[1]);
    const payBadge = (o) => badge(payTone(o), PAY_STATUS[o.paymentStatus] || o.paymentStatus, (PAY_TONE[o.paymentStatus] || [, "circle"])[1]);
    const bar = (cls) => `<span class="skeleton mo-sk ${cls}"></span>`;

    // Ảnh nhỏ của một dòng; thiếu ảnh hay sản phẩm không còn bán thì còn khung đứt + icon
    const thumb = (image, size, gone) => (image && !gone
        ? `<img src="${e(image)}" alt="" class="mo-thumb mo-thumb--${size}" loading="lazy">`
        : `<span class="mo-thumb mo-thumb--${size} mo-thumb--gone"${gone ? ' title="Sản phẩm không còn trong cửa hàng"' : ""}>${icon("image-off")}</span>`);

    const stateBlock = ({ title, text, action, error, gap }) => `<div class="mo-state${gap ? " mo-state--tight" : ""}"${error ? ' role="alert"' : ""}><div><p class="mo-state__title${error ? " mo-state__title--error" : ""}">${title}</p>${text ? `<p class="mo-state__text">${text}</p>` : ""}</div>${action || ""}</div>`;
    const retryButton = (action) => `<button type="button" class="ui-btn ui-btn--outline" data-mo-action="${action}">${icon("rotate-cw")}Thử lại</button>`;

    // ---------- chip lọc (khối 3) ----------
    const renderChips = () => {
        const show = st.auth === "user" && !(st.list.status === "error" && !st.list.meta) && !(st.list.status === "ready" && st.list.meta?.counts.all === 0);
        if (!show) { el.chips.innerHTML = ""; rendered.chips = ""; return; }
        const counts = st.list.meta?.counts;
        const sig = counts ? JSON.stringify(counts) : "none";
        if (rendered.chips !== sig) {
            const active = document.activeElement;
            const focusTab = el.chips.contains(active) ? active.dataset.moTab : "";
            el.chips.innerHTML = `<div class="mo-fade"><div class="mo-chips" role="radiogroup" aria-label="Lọc theo trạng thái">${TABS.map(([key, label]) => `<button type="button" role="radio" aria-checked="false" class="mo-chip" data-mo-tab="${key}">${label}${counts ? `<span class="mo-chip__n">${counts[key] ?? 0}</span>` : ""}</button>`).join("")}</div></div>`;
            rendered.chips = sig;
            if (focusTab) el.chips.querySelector(`[data-mo-tab="${focusTab}"]`)?.focus();
        }
        el.chips.querySelectorAll("[data-mo-tab]").forEach((chip) => {
            const on = chip.dataset.moTab === st.url.tab;
            chip.setAttribute("aria-checked", String(on));
            chip.tabIndex = on ? 0 : -1;
        });
    };

    // ---------- danh sách (khối 4, 5) ----------
    const rowSkeleton = () => `<li class="mo-row mo-row--sk">${bar("mo-sk--thumb")}<div class="mo-row__sk-mid">${bar("mo-sk--l1")}${bar("mo-sk--l2")}${bar("mo-sk--l3")}</div><div class="mo-row__sk-end">${bar("mo-sk--r1")}${bar("mo-sk--r2")}</div></li>`;

    const rowHtml = (o) => {
        const items = Array.isArray(o.items) ? o.items : [];
        const first = items[0] || {};
        const cancelled = o.orderStatus === "CANCELLED";
        const unpaidish = o.paymentStatus !== "PAID";
        const vouchers = Number(o.voucherCount) || 0;
        const payText = unpaidish ? ` · <span class="mo-nowrap${payTone(o) === "w" ? " mo-warn" : ""}">${e(PAY_STATUS[o.paymentStatus] || o.paymentStatus)}</span>` : "";
        const shown = items.slice(0, 3);
        return `<li><a class="mo-row" href="${hrefOf({ don: o.id })}" data-mo-nav="row" data-id="${e(o.id)}">
            <span class="mo-row__grid">
                <span class="mo-row__id" title="${e(o.id)}">${e(o.id)}</span>
                <span class="mo-row__badge">${stBadge(o.orderStatus)}</span>
                <span class="mo-thumbs">${shown.map((it, k) => `<span class="mo-thumbs__i" style="z-index:${3 - k}">${thumb(it.image, "sm")}</span>`).join("")}</span>
                <span class="mo-row__name" title="${e(first.name || "")}">${e(first.name || "")}</span>
                <span class="mo-row__meta"><span class="mo-row__meta-a">${fmtDate(o.createdAt)} · ${Number(o.lineCount) || items.length} sản phẩm</span><span class="mo-row__meta-b"><span class="mo-row__sep"> · </span>${e(methodLabel(o.paymentMethod))}${vouchers ? ` · ${vouchers} voucher` : ""}${payText}</span></span>
                <span class="mo-row__total tabular${cancelled ? " is-cancelled" : ""}">${money(o.totalPrice)}</span>
            </span></a></li>`;
    };

    const markSelected = () => {
        el.list.querySelectorAll("a[data-id]").forEach((a) => {
            if (a.dataset.id === st.detail.id) a.setAttribute("aria-current", "true");
            else a.removeAttribute("aria-current");
        });
    };

    const renderList = () => {
        const { status, data, meta, ver } = st.list;
        const mode = st.auth !== "user" || status === "loading" ? "loading" : status === "error" ? "error" : !meta || meta.counts.all === 0 ? "empty" : !data.length ? "filter" : "rows";
        if (rendered.listVer !== ver || rendered.listMode !== mode) {
            const active = document.activeElement;
            const refocus = el.list.contains(active) && active.dataset?.id ? active.dataset.id : "";
            if (mode === "loading") el.list.innerHTML = `<ul class="mo-rows" aria-busy="true">${[0, 1, 2, 3].map(rowSkeleton).join("")}</ul>`;
            else if (mode === "error") el.list.innerHTML = stateBlock({ title: "Không tải được danh sách đơn hàng", text: "Kiểm tra kết nối mạng rồi thử lại.", action: retryButton("retry-list"), error: true, gap: true });
            else if (mode === "empty") el.list.innerHTML = stateBlock({ title: "Bạn chưa có đơn hàng nào", text: "Đơn bạn đặt sẽ hiện ở đây để theo dõi giao hàng và đánh giá sản phẩm.", action: '<a href="/" class="ui-btn ui-btn--primary">Mua sắm ngay</a>' });
            else if (mode === "filter") el.list.innerHTML = `<p class="mo-filter-empty">Bạn chưa có đơn nào ở trạng thái <strong>${e(tabLabel(st.url.tab))}</strong>. <a href="${hrefOf({ tab: "all", page: 1 })}" data-mo-nav="all">Xem tất cả đơn</a></p>`;
            else el.list.innerHTML = `<ul class="mo-rows">${data.map(rowHtml).join("")}</ul>`;
            rendered.listVer = ver;
            rendered.listMode = mode;
            if (refocus) el.list.querySelector(`a[data-id="${CSS.escape(refocus)}"]`)?.focus();
        }
        markSelected();
        el.list.toggleAttribute("aria-busy", mode === "loading");
    };

    const renderPager = () => {
        const { status, data, meta } = st.list;
        if (st.auth !== "user" || status !== "ready" || !meta || !data.length) { el.pager.innerHTML = ""; return; }
        el.pager.innerHTML = meta.totalPages <= 1
            ? `<p class="catalog-pagination__count">${Number(meta.total).toLocaleString("vi-VN")} đơn hàng</p>`
            : R.renderPagination({ page: meta.page, totalPages: meta.totalPages, total: meta.total, pageSize: meta.pageSize, ariaLabel: "Phân trang đơn hàng", noun: "đơn hàng", hrefForPage: (n) => buildUrl({ ...st.url, page: n }) });
    };

    // ---------- chi tiết (khối 6-9) ----------
    const stepper = (o) => {
        const vouchers = Array.isArray(o.vouchers) ? o.vouchers : [];
        if (o.orderStatus === "CANCELLED") {
            const refund = o.paymentStatus === "REFUNDED" ? `Đã hoàn ${money(o.totalPrice)} về ${e(methodLabel(o.paymentMethod))}.` : "";
            const voucherText = vouchers.length ? `${vouchers.length > 1 ? "Các voucher" : "Voucher"} ${vouchers.map((v) => e(v.code)).join(", ")} đã được hoàn lại để bạn dùng cho đơn khác.` : "";
            const sub = [refund, voucherText].filter(Boolean).join(" ");
            return `<div class="mo-cancelled"><p class="mo-cancelled__t">${icon("circle-x")}Đơn đã huỷ ngày ${fmtDate(o.cancelledAt || o.updatedAt)}</p>${sub ? `<p class="mo-cancelled__s">${sub}</p>` : ""}</div>`;
        }
        const cur = Math.max(0, STEPS.indexOf(o.orderStatus));
        const done = o.orderStatus === "DELIVERED";
        const wide = STEPS.map((s, k) => {
            const isDone = k < cur || (done && k === cur);
            const isCur = k === cur && !done;
            const circle = isDone ? `<span class="mo-step__c is-done">${icon("check")}</span>` : `<span class="mo-step__c ${isCur ? "is-cur" : "is-todo"}">${k + 1}</span>`;
            const label = k === cur ? "is-cur" : k < cur ? "is-past" : "";
            return `<li ${k === cur ? 'aria-current="step"' : ""} class="mo-step${k < 3 ? " is-grow" : ""}"><div class="mo-step__top">${circle}${k < 3 ? `<span class="mo-step__line${k < cur ? " is-done" : ""}"></span>` : ""}</div><span class="mo-step__l ${label}">${ORDER_STATUS[s]}</span></li>`;
        }).join("");
        const seg = STEPS.map((s, k) => `<span class="mo-seg${done || k < cur ? " is-done" : k === cur ? " is-cur" : ""}"></span>`).join("");
        return `<div class="mo-stepper"><ol class="mo-steps" aria-label="Tiến trình đơn">${wide}</ol><div class="mo-steps-m"><p class="mo-steps-n">Bước ${cur + 1} / 4 · ${ORDER_STATUS[o.orderStatus]}</p><div class="mo-segs" aria-hidden="true">${seg}</div></div></div>`;
    };

    // Đơn MoMo/VNPay chưa trả: nói rõ phiên thanh toán còn hạn hay đã hết, theo lần thử gần nhất.
    const unpaidNotice = (o) => {
        const method = e(methodLabel(o.paymentMethod));
        const attempt = o.paymentAttempt;
        if (attempt?.status === "PENDING") {
            return { title: "Đang chờ thanh toán", text: `Phiên thanh toán ${method} còn hiệu lực đến ${fmtDateTime(attempt.expiresAt)}. Cửa hàng xử lý đơn sau khi nhận được tiền.` };
        }
        if (attempt?.status === "EXPIRED") {
            return { title: "Phiên thanh toán đã hết hạn", text: `Phiên thanh toán ${method} đã hết hạn lúc ${fmtDateTime(attempt.expiresAt)} mà chưa nhận được tiền, nên cửa hàng chưa xử lý đơn này.` };
        }
        if (attempt?.status === "FAILED") {
            return { title: "Thanh toán không thành công", text: `Lần thanh toán ${method} gần nhất không thành công, nên cửa hàng chưa xử lý đơn này.` };
        }
        return { title: "Đơn chưa được thanh toán", text: `Thanh toán qua ${method} chưa hoàn tất nên cửa hàng chưa xử lý đơn này.` };
    };

    const progressBlock = (o) => {
        const notice = o.orderStatus === "PENDING" && o.paymentStatus === "UNPAID" && !isCod(o.paymentMethod) ? unpaidNotice(o) : null;
        return `<section class="mo-sec" aria-label="Trạng thái đơn">
            ${stepper(o)}
            ${notice ? `<div role="status" class="mo-alert">${icon("circle-alert")}<div><p class="mo-alert__t">${notice.title}</p><p>${notice.text}</p></div></div>` : ""}
            <dl class="mo-meta">
                <div><dt>Đặt lúc</dt><dd class="tabular">${fmtDateTime(o.createdAt)}</dd></div>
                <div><dt>Thanh toán</dt><dd class="mo-meta__pay">${payBadge(o)}<span>${e(methodLabel(o.paymentMethod))}</span></dd></div>
            </dl>
        </section>`;
    };

    // Hành động theo từng sản phẩm, chỉ ở đơn đã giao
    const reviewActions = (o, item, index) => {
        if (o.orderStatus !== "DELIVERED") return "";
        if (!item.productAvailable || !item.productId) {
            const id = `mo-gone-${index}`;
            return `<div class="mo-item__act"><button type="button" class="ui-btn ui-btn--outline mo-review" disabled aria-describedby="${id}">${icon("star")}Đánh giá</button><span id="${id}" class="mo-item__hint">Sản phẩm không còn bán nên chưa thể đánh giá.</span></div>`;
        }
        const href = `/product_info.html?id=${encodeURIComponent(item.productId)}#danh-gia`;
        if (item.review?.exists) return `<div class="mo-item__act"><a href="${href}" class="ui-btn ui-btn--outline mo-review">${icon("pencil")}Sửa đánh giá</a><span class="mo-item__hint mo-item__hint--done">${icon("circle-check")}Bạn đã đánh giá</span></div>`;
        return `<div class="mo-item__act"><a href="${href}" class="ui-btn ui-btn--outline mo-review">${icon("star")}Đánh giá</a></div>`;
    };

    const itemsBlock = (o) => {
        const lines = Array.isArray(o.items) ? o.items : [];
        const waiting = ["PENDING", "PROCESSING", "SHIPPED"].includes(o.orderStatus);
        return `<section class="mo-sec" aria-label="Sản phẩm trong đơn">
            <h3 class="mo-h3">Sản phẩm <span>(${lines.length})</span></h3>
            ${waiting ? '<p class="mo-hint">Bạn đánh giá được sản phẩm sau khi đơn được giao.</p>' : ""}
            <ul class="mo-items">${lines.map((item, index) => `<li class="mo-item">
                <div class="mo-item__main">
                    ${thumb(item.image, "lg", item.productAvailable === false)}
                    <div class="mo-item__txt"><p class="mo-item__name" title="${e(item.name)}">${e(item.name)}</p><p class="mo-item__opt">${[e(optionText(item.options)), `SL ${Number(item.quantity) || 0}${item.quantity > 1 ? ` · ${money(item.unitPrice)}/sản phẩm` : ""}`].filter(Boolean).join(" · ")}</p></div>
                    <p class="mo-item__sum tabular">${money(item.lineTotal)}</p>
                </div>
                ${reviewActions(o, item, index)}
            </li>`).join("")}</ul>
        </section>`;
    };

    const voucherLabel = (v) => (v.type === "FREE_SHIPPING" ? "Miễn phí vận chuyển" : v.percent ? `Giảm ${v.percent}%` : "");
    const totalsBlock = (o) => {
        const vouchers = Array.isArray(o.vouchers) ? o.vouchers : [];
        const row = (a, b) => `<div><dt>${a}</dt><dd class="tabular">${b}</dd></div>`;
        const voucherRows = vouchers.map((v) => row(`<span class="mo-vc"><span class="mo-vc__code">${icon("ticket")}<span>${e(v.code)}</span></span><span class="mo-vc__note">${e(voucherLabel(v))}</span></span>`, `<span class="mo-pos">−${money(v.amount)}</span>`)).join("");
        const loose = !vouchers.length && Number(o.discount) > 0 ? row("Giảm giá", `<span class="mo-pos">−${money(o.discount)}</span>`) : "";
        return `<section class="mo-sec" aria-label="Tổng tiền">
            <h3 class="mo-h3">Tổng tiền</h3>
            <dl class="mo-sum">${row("Tạm tính", money(o.subtotal))}${row("Phí vận chuyển", money(o.shippingFee))}${voucherRows}${loose}
                <div class="mo-sum__total"><dt>Tổng cộng</dt><dd class="tabular${o.orderStatus === "CANCELLED" ? " is-cancelled" : ""}">${money(o.totalPrice)}</dd></div>
            </dl>
        </section>`;
    };

    const deliveryBlock = (o) => {
        const c = o.customer || {};
        const kv = (k, v) => `<div class="mo-kv"><dt>${k}</dt><dd>${v}</dd></div>`;
        const tel = String(c.phone || "").replace(/[^\d+]/g, "");
        return `<section class="mo-sec" aria-label="Giao hàng">
            <h3 class="mo-h3">Giao hàng</h3>
            <dl class="mo-kvs">${kv("Người nhận", e(c.name))}${kv("Số điện thoại", tel ? `<a href="tel:${e(tel)}">${e(c.phone)}</a>` : e(c.phone))}${kv("Địa chỉ", e(c.address))}${c.note ? kv("Ghi chú", `<span class="mo-kv__note">${e(c.note)}</span>`) : ""}</dl>
        </section>`;
    };

    const detailCard = (o) => `<article class="mo-card mo-detail" aria-labelledby="mo-detail-title">
        <header class="mo-detail__head">
            <h2 id="mo-detail-title" tabindex="-1" data-mo-focus>Đơn <span class="mo-mono">${e(o.id)}</span></h2>
            <div class="mo-detail__meta">${stBadge(o.orderStatus)}<span>Đặt lúc ${fmtDateTime(o.createdAt)}</span></div>
        </header>
        <div class="mo-detail__body">
            ${progressBlock(o)}<hr class="mo-rule">${itemsBlock(o)}<hr class="mo-rule">
            <div class="mo-lower">${totalsBlock(o)}<div class="mo-lower__end">${deliveryBlock(o)}</div></div>
        </div>
    </article>`;

    const detailSkeleton = () => `<div class="mo-card mo-detail mo-detail--sk" tabindex="-1" data-mo-focus aria-label="Đang tải chi tiết đơn hàng"><div class="mo-detail__body" aria-busy="true">
        <div class="mo-sk-steps">${bar("mo-sk--dot")}${bar("mo-sk--ln")}${bar("mo-sk--dot")}${bar("mo-sk--ln")}${bar("mo-sk--dot")}${bar("mo-sk--ln")}${bar("mo-sk--dot")}</div>
        <div class="mo-sk-sec">${bar("mo-sk--s1")}<div class="mo-sk-line">${bar("mo-sk--img")}<div class="mo-sk-col">${bar("mo-sk--m1")}${bar("mo-sk--m2")}</div>${bar("mo-sk--m3")}</div></div>
        <div class="mo-sk-sec">${bar("mo-sk--s2")}${bar("mo-sk--s3")}${bar("mo-sk--s4")}${bar("mo-sk--s5")}</div></div></div>`;

    const listUrl = () => hrefOf({ don: "" });
    const backLink = () => `<div class="mo-back-wrap"><a class="mo-back" href="${listUrl()}" data-mo-nav="back">${icon("chevron-left")}Đơn hàng của tôi</a></div>`;

    const renderDetail = () => {
        const d = st.detail;
        let inner = "";
        const waiting = !st.url.don && st.desktop && (st.auth === "checking" || (st.auth === "user" && st.list.status === "loading"));
        if (st.auth === "checking" && st.url.don) inner = detailSkeleton();
        else if (waiting || d.status === "loading") inner = detailSkeleton();
        else if (d.status === "ready") inner = detailCard(d.data);
        else if (d.status === "notfound") inner = `<div class="mo-card" data-mo-focus tabindex="-1" role="alert">${`<div class="mo-state mo-state--page"><p class="mo-state__code">404</p><h2 class="mo-state__h">Không tìm thấy đơn hàng</h2><p class="mo-state__text">Đơn này không tồn tại hoặc không thuộc tài khoản của bạn.</p><a href="${listUrl()}" class="ui-btn ui-btn--primary" data-mo-nav="back">Về danh sách đơn hàng</a></div>`}</div>`;
        else if (d.status === "error") inner = `<div class="mo-card" data-mo-focus tabindex="-1">${stateBlock({ title: "Không tải được chi tiết đơn hàng", text: "Kiểm tra kết nối mạng rồi thử lại.", action: retryButton("retry-detail"), error: true, gap: true })}</div>`;
        const html = inner ? `${backLink()}${inner}` : "";
        el.right.hidden = !html;
        el.grid.classList.toggle("mo-grid--solo", !html);
        if (rendered.detail !== html) { el.right.innerHTML = html; rendered.detail = html; }
    };

    // ---------- cổng: khách / quản trị ----------
    const renderGate = () => {
        const gated = st.auth === "guest" || st.auth === "admin";
        el.gate.hidden = !gated;
        el.body.hidden = gated;
        if (!gated) return;
        el.gate.innerHTML = st.auth === "guest"
            ? `<div class="mo-state mo-state--page"><h2 class="mo-state__h" id="mo-gate-title">Đăng nhập để xem đơn hàng</h2><p class="mo-state__text">Đơn bạn đã đặt sẽ hiện ở đây sau khi đăng nhập.</p><a href="${e(window.DigiAuth?.loginUrl?.() || "/auth.html?tab=login")}" class="ui-btn ui-btn--primary">Đăng nhập</a></div>`
            : `<div class="mo-state mo-state--page"><h2 class="mo-state__h" id="mo-gate-title">Tài khoản quản trị không có đơn mua hàng</h2><p class="mo-state__text">Đơn của khách được quản lý tại trang quản trị.</p><a href="/admin.html" class="ui-btn ui-btn--primary">Về quản trị</a></div>`;
    };

    // ---------- focus ----------
    const applyFocus = () => {
        if (!st.focus || st.auth !== "user") return;
        if (st.focus === "detail") {
            if (st.desktop) { st.focus = ""; return; }
            const target = el.right.querySelector("[data-mo-focus]");
            if (target) target.focus();
            if (st.detail.status !== "loading") st.focus = "";
        } else if (st.focus === "row") {
            if (st.desktop) { st.focus = ""; return; }
            if (st.list.status === "loading") return;
            const row = st.lastDon ? el.list.querySelector(`a[data-id="${CSS.escape(st.lastDon)}"]`) : null;
            (row || el.title).focus();
            st.focus = "";
        } else if (st.focus === "list") {
            if (st.list.status === "loading") return;
            el.listCard.focus({ preventScroll: true });
            if (el.listCard.getBoundingClientRect().top < 60) el.listCard.scrollIntoView({ block: "start" });
            st.focus = "";
        }
    };

    const renderLive = () => {
        if (st.auth !== "user") return;
        const { status, data, meta } = st.list;
        if (status === "loading") announce("Đang tải danh sách đơn hàng…");
        else if (status === "error") announce("Không tải được danh sách đơn hàng.");
        else if (meta && meta.counts.all === 0) announce("Bạn chưa có đơn hàng nào.");
        else if (meta && !data.length) announce(`Không có đơn nào ở trạng thái ${tabLabel(st.url.tab)}.`);
        else if (meta) announce(`${tabLabel(st.url.tab)}: ${data.length} đơn trên trang ${meta.page} / ${meta.totalPages}, tổng ${meta.total} đơn hàng.`);
    };

    const renderAll = () => {
        root.dataset.auth = st.auth;
        root.dataset.view = st.url.don ? "detail" : "list";
        renderGate();
        if (st.auth === "guest" || st.auth === "admin") return;
        renderChips();
        renderList();
        renderPager();
        renderDetail();
        applyFocus();
    };

    // ---------- tải dữ liệu ----------
    const authFailure = (error) => {
        if (error?.status === 401) st.auth = "guest";
        else if (error?.status === 403) st.auth = "admin";
        else return false;
        renderAll();
        return true;
    };

    const loadList = async () => {
        const { tab, page } = st.url;
        const seq = ++listSeq;
        st.list = { ...st.list, status: "loading", key: `${tab}|${page}`, ver: st.list.ver + 1 };
        renderAll();
        renderLive();
        try {
            const payload = await window.DigiAuth.api(`/api/orders/mine?page=${page}&pageSize=${PAGE_SIZE}&status=${tab === "all" ? "all" : tab}`);
            if (seq !== listSeq) return;
            const meta = payload.meta;
            const data = Array.isArray(payload.data) ? payload.data : [];
            if (meta.page !== st.url.page) { st.url = { ...st.url, page: meta.page }; history.replaceState(history.state, "", buildUrl(st.url)); }
            st.list = { status: "ready", key: `${st.url.tab}|${meta.page}`, ver: st.list.ver + 1, data, meta };
        } catch (error) {
            if (seq !== listSeq) return;
            if (authFailure(error)) return;
            st.list = { ...st.list, status: "error", ver: st.list.ver + 1, data: [] };
        }
        syncDetail();
        renderAll();
        renderLive();
    };

    const loadDetail = async (id) => {
        const seq = ++detailSeq;
        st.detail = { status: "loading", id, data: null };
        renderAll();
        try {
            const payload = await window.DigiAuth.api(`/api/orders/${encodeURIComponent(id)}`);
            if (seq !== detailSeq) return;
            st.detail = { status: "ready", id, data: payload.data };
            announce(`Đã tải chi tiết đơn ${payload.data.id}.`);
        } catch (error) {
            if (seq !== detailSeq) return;
            if (authFailure(error)) return;
            if (error?.status === 404 || error?.status === 400) { st.detail = { status: "notfound", id, data: null }; announce("Không tìm thấy đơn hàng."); }
            else { st.detail = { status: "error", id, data: null }; announce("Không tải được chi tiết đơn hàng."); }
        }
        renderAll();
    };

    // Đơn cần hiện ở khung chi tiết: ?don=, hoặc ở màn rộng thì đơn đầu danh sách
    const wantedDetail = () => {
        if (st.url.don) return st.url.don;
        if (st.desktop && st.list.status === "ready" && st.list.data.length) return st.list.data[0].id;
        return "";
    };
    const syncDetail = () => {
        const id = wantedDetail();
        if (id === st.detail.id) return;
        if (!id) { detailSeq += 1; st.detail = { status: "idle", id: "", data: null }; return; }
        loadDetail(id);
    };

    const sync = () => {
        if (st.auth !== "user") { renderAll(); return; }
        if (st.url.don) st.lastDon = st.url.don;
        const key = `${st.url.tab}|${st.url.page}`;
        if (st.list.key !== key) loadList();
        else { syncDetail(); renderAll(); }
    };

    // ---------- điều hướng ----------
    const go = (target, { replace = false, focus = "", fromList = false } = {}) => {
        const url = buildUrl(target);
        st.url = target;
        st.focus = focus;
        if (url !== location.pathname + location.search) history[replace ? "replaceState" : "pushState"]({ moFromList: fromList }, "", url);
        sync();
        if (focus === "detail" && st.desktop) {
            const top = el.right.getBoundingClientRect().top;
            if (top < 56) el.right.scrollIntoView({ block: "start" });
        }
    };

    root.addEventListener("click", (event) => {
        if (event.defaultPrevented) return;
        const action = event.target.closest("[data-mo-action]");
        if (action) {
            if (action.dataset.moAction === "retry-list") { st.list.key = ""; sync(); }
            else if (action.dataset.moAction === "retry-detail") loadDetail(st.detail.id);
            return;
        }
        const tab = event.target.closest("[data-mo-tab]");
        if (tab) { go({ ...st.url, tab: tab.dataset.moTab, page: 1 }, { focus: "" }); return; }
        const link = event.target.closest("a[data-mo-nav], .catalog-pagination a[href]");
        if (!link || !root.contains(link) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const target = parseSearch(new URL(link.href, location.href).search);
        const kind = link.dataset.moNav || "page";
        if (kind === "row") go(target, { focus: "detail", fromList: true });
        else if (kind === "back") {
            if (history.state?.moFromList) { st.focus = "row"; history.back(); }
            else go(target, { replace: true, focus: "row" });
        } else if (kind === "all") go(target, { focus: "list" });
        else go(target, { focus: "list" });
    });

    // Nhóm chip là radiogroup: mũi tên, Home, End đổi lựa chọn; Tab chỉ dừng ở chip đang chọn
    el.chips.addEventListener("keydown", (event) => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in keys) && event.key !== "Home" && event.key !== "End") return;
        const chips = [...el.chips.querySelectorAll("[data-mo-tab]")];
        const at = chips.indexOf(document.activeElement);
        if (at < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? chips.length - 1 : (at + keys[event.key] + chips.length) % chips.length;
        go({ ...st.url, tab: chips[next].dataset.moTab, page: 1 });
        el.chips.querySelector(`[data-mo-tab="${chips[next].dataset.moTab}"]`)?.focus();
    });

    window.addEventListener("popstate", () => {
        const prev = st.url;
        st.url = parseSearch(location.search);
        st.focus = prev.don && !st.url.don ? "row" : "";
        sync();
    });

    desktopQuery.addEventListener("change", (event) => {
        st.desktop = event.matches;
        if (st.auth === "user") { syncDetail(); renderAll(); }
    });

    // Ảnh hỏng: thay bằng khung đứt
    root.addEventListener("error", (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !img.classList.contains("mo-thumb")) return;
        const size = img.classList.contains("mo-thumb--lg") ? "lg" : "sm";
        img.outerHTML = `<span class="mo-thumb mo-thumb--${size} mo-thumb--gone">${icon("image-off")}</span>`;
    }, true);

    // ---------- khởi động ----------
    const init = async () => {
        st.url = parseSearch(location.search);
        st.lastDon = st.url.don;
        history.replaceState(history.state || { moFromList: false }, "", buildUrl(st.url));
        renderAll();
        let session = { authenticated: false };
        try { session = (await window.DigiAuth.ready) || session; } catch (_) { /* coi như khách */ }
        st.auth = !session.authenticated ? "guest" : session.user?.role === "admin" ? "admin" : "user";
        if (st.auth === "user") sync();
        else renderAll();
    };
    init();
})();
