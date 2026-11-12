/* ===== ADMIN: TỔNG QUAN (dashboard đơn giản) =====
 * Nguồn dữ liệu: GET /api/admin/dashboard/summary (tổng user, user mới 7 ngày, số đơn, doanh thu, top 5 sản phẩm bán chạy),
 * GET /api/orders?status=PENDING&pageSize=50 (đơn chờ xử lý, một trang), GET /api/admin/products?status=active&pageSize=48 (tồn kho, lặp trang).
 * Không tải toàn bộ đơn về trình duyệt. Tải lại mỗi lần mở màn Tổng quan ('admin:view') và khi nhận 'admin:orders-changed'.
 *
 * Định nghĩa số liệu (GLOSSARY: Revenue):
 *  - Số đơn          = đơn không bị hủy (mọi thời gian).
 *  - Doanh thu       = tổng tiền đơn đã thanh toán hoặc đã giao, không tính đơn hủy.
 *  - Người dùng mới  = khách hàng đăng ký trong 7 ngày gần nhất.
 *  - Top 5           = 5 sản phẩm có tổng số lượng bán cao nhất trên các đơn tính doanh thu.
 *  - Đơn chờ xử lý   = orderStatus === PENDING; sắp theo thời gian chờ giảm dần. "Chờ quá 24 giờ" = chờ >= 24 giờ.
 *  - Sắp hết / hết hàng = tổng tồn của sản phẩm đang bán <= 5 (hết hàng = 0, sắp hết = 1..5).
 */
(() => {
    "use strict";
    const UI = window.AdminUI;
    if (!UI) return;

    const root = document.getElementById("overview-root");
    if (!root) return;

    const esc = UI.escapeHtml;
    const HOUR = 3600e3;

    /* ---------- Icon (lucide) ---------- */
    const ICONS = {
        "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/><path d=\"M12 9v4\"/><path d=\"M12 17h.01\"/>",
        "trending-up": "<polyline points=\"22 7 13.5 15.5 8.5 10.5 2 17\"/><polyline points=\"16 7 22 7 22 13\"/>",
        "trending-down": "<polyline points=\"22 17 13.5 8.5 8.5 13.5 2 7\"/><polyline points=\"16 17 22 17 22 11\"/>",
        "chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
        "rotate-cw": "<path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/>"
    };
    const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

    /* ---------- Định dạng ---------- */
    const vnd = (value) => Number(value || 0).toLocaleString("vi-VN") + "₫";
    const mil = (value) => (Number(value || 0) / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
    const num = (value) => Number(value || 0).toLocaleString("vi-VN");
    const waitText = (hours) => (hours >= 48 ? `Chờ ${Math.floor(hours / 24)} ngày` : hours < 1 ? "Chờ dưới 1 giờ" : `Chờ ${hours} giờ`);

    /* ---------- Số liệu dẫn xuất ---------- */
    const compute = ({ summary, pendingOrders, products }) => {
        const now = Date.now();
        const pending = pendingOrders
            .map((order) => ({ ...order, _age: Math.max(0, Math.floor((now - new Date(order.createdAt)) / HOUR)), _total: Number(order.totalPrice) || 0 }))
            .sort((a, b) => b._age - a._age);
        const low = products.filter((product) => Number(product.stock) <= 5).sort((a, b) => Number(a.stock) - Number(b.stock));
        return {
            summary, pending, low,
            late: pending.filter((order) => order._age >= 24).length,
            few: low.filter((product) => Number(product.stock) > 0).length,
            out: low.filter((product) => Number(product.stock) <= 0).length
        };
    };

    /* ---------- Thành phần dùng chung ---------- */
    const badge = (tone, text) => `<span class="badge badge--${tone}"><span class="badge__dot"></span>${text}</span>`;
    const payBadge = (order) => (order.paymentStatus === "PAID"
        ? badge("success", "Đã thanh toán")
        : order.paymentStatus === "REFUNDED" ? badge("neutral", "Đã hoàn tiền") : badge("neutral", "Chưa thanh toán"));
    const wait = (order) => (order.orderStatus === "PENDING" && order._age >= 24
        ? `<span class="wait wait--late tabular" title="Chờ quá 24 giờ">${icon("triangle-alert", "icon--14")}${waitText(order._age)}</span>`
        : `<span class="wait tabular">${waitText(order._age)}</span>`);
    const stockBadge = (product) => (Number(product.stock) <= 0 ? badge("error", "Hết hàng") : badge("warning", `Còn ${Number(product.stock)}`));
    const sk = (width, height, extra = "") => `<div class="sk ${extra}" style="width:${width};height:${height}"></div>`;


    /* ---------- Khối ---------- */
    const statCell = ({ label, value, unit = "", sub, title = "" }) => `
        <div class="ov-stat"${title ? ` title="${esc(title)}"` : ""}>
            <p class="ov-stat__label">${label}</p>
            <p class="ov-stat__value tabular">${value}${unit ? `<span class="ov-stat__unit">${unit}</span>` : ""}</p>
            <div class="ov-stat__sub">${sub}</div>
        </div>`;

    const statsBlock = (c) => {
        const s = c.summary;
        return `
        <div class="ov-stats ov-stats--5">
            ${statCell({ label: "Tổng người dùng", value: num(s.totalUsers), sub: "Tài khoản khách hàng" })}
            ${statCell({ label: "Người dùng mới", value: num(s.newUsers), sub: "Trong 7 ngày gần nhất" })}
            ${statCell({ label: "Số đơn", value: num(s.orders), sub: `<span class="${c.late ? "ov-late" : ""}">${num(s.pendingOrders)} chờ xử lý</span> · không tính đơn hủy` })}
            ${statCell({ label: "Doanh thu", value: mil(s.revenue), unit: "tr ₫", title: vnd(s.revenue), sub: "Đơn đã thanh toán hoặc đã giao" })}
            ${statCell({ label: "Sắp hết / hết hàng", value: c.low.length, sub: `${c.few} sắp hết · ${c.out} hết hàng` })}
        </div>`;
    };

    const orderRow = (order) => `
        <li>
            <a class="ov-order" href="#/don-hang/${encodeURIComponent(order.id)}">
                <div class="ov-order__main">
                    <div class="ov-order__top">
                        <p class="ov-order__id">${esc(order.id)}</p>
                        <span class="ov-order__wait-sm">${wait(order)}</span>
                    </div>
                    <p class="ov-order__who">${esc(order.customer && order.customer.name)}</p>
                </div>
                <div class="ov-order__meta">
                    <p class="ov-order__total tabular">${vnd(order._total)}</p>
                    <span class="ov-order__pay">${payBadge(order)}</span>
                    <span class="ov-order__wait">${wait(order)}</span>
                </div>
                ${icon("chevron-right", "ov-chev")}
            </a>
        </li>`;

    const stockRow = (product) => `
        <li>
            <a class="ov-stock" href="#/san-pham">
                <img class="ov-stock__img${Number(product.stock) <= 0 ? " is-out" : ""}" src="${esc(product.image || "")}" alt="" loading="lazy" onerror="this.classList.add('is-broken')">
                <div class="ov-stock__text">
                    <p class="ov-stock__name" title="${esc(product.name)}">${esc(product.name)}</p>
                    <p class="ov-stock__sub">${Number(product.variantCount) || 0} phiên bản</p>
                </div>
                ${stockBadge(product)}
                ${icon("chevron-right", "ov-chev ov-chev--always")}
            </a>
        </li>`;

    const groupHead = (label, count, href, linkText) => `
        <div class="ov-group">
            <h3>${label} · <span class="tabular">${count}</span></h3>
            <a href="${href}">${linkText}</a>
        </div>`;

    // Top 5 sản phẩm bán chạy: biểu đồ cột một màu, số lượng ghi trên đầu cột, tên dưới cột.
    const topBlock = (c) => {
        const top = c.summary.topProducts || [];
        const peak = Math.max(1, ...top.map((p) => p.quantity));
        const body = top.length
            ? `<div class="ov-top" role="img" aria-label="Top ${top.length} sản phẩm bán chạy: ${esc(top.map((p) => `${p.name} ${num(p.quantity)}`).join(", "))}">${top.map((p) => `
                <div class="ov-top__col" title="${esc(`${p.name}: ${num(p.quantity)} sản phẩm · ${vnd(p.revenue)}`)}">
                    <div class="ov-top__area"><div class="ov-top__bar" style="height:${p.quantity / peak * 100}%"><span class="ov-top__n tabular">${num(p.quantity)}</span></div></div>
                    <p class="ov-top__name">${esc(p.name)}</p>
                </div>`).join("")}</div>`
            : "<p class=\"ov-top__empty\">Chưa bán sản phẩm nào.</p>";
        return `
        <section class="card ov-chart" aria-labelledby="ov-top-title">
            <header class="ov-card-head">
                <h2 id="ov-top-title">Top 5 sản phẩm bán chạy</h2>
                <p class="ov-card-head__sub">Theo số lượng, trên đơn đã thanh toán hoặc đã giao</p>
            </header>
            ${body}
        </section>`;
    };

    const listBlock = (c) => `
        <section class="card ov-list" aria-labelledby="ov-need-title">
            <header class="ov-card-head ov-card-head--list"><h2 id="ov-need-title">Cần xử lý</h2></header>
            <div class="ov-list__body">
                ${groupHead("Đơn chờ xử lý", num(c.summary.pendingOrders), "#/don-hang", "Tất cả đơn")}
                <ul class="ov-rows">${c.pending.map(orderRow).join("") || "<li class=\"ov-feed__empty\">Không có đơn chờ xử lý.</li>"}</ul>
                ${groupHead("Sắp hết hàng", c.low.length, "#/san-pham", "Tất cả sản phẩm")}
                <ul class="ov-rows">${c.low.map(stockRow).join("") || "<li class=\"ov-feed__empty\">Không có sản phẩm sắp hết.</li>"}</ul>
            </div>
        </section>`;

    const dataView = (c) => `
        <div class="ov">
            <div>${statsBlock(c)}</div>
            <div class="ov-grid">
                ${listBlock(c)}
                <div class="ov-side">${topBlock(c)}</div>
            </div>
        </div>`;

    const SKEL_W = ["40%", "50%", "40%", "33.333%"];
    const SKEL_W2 = ["25%", "33.333%", "20%", "25%"];
    const SKEL_S = ["50%", "40%", "60%"];
    const statSkel = () => `
        <div class="ov-stat">
            <div class="ov-stat__sk" style="height:16px">${sk("96px", "12px")}</div>
            <div class="ov-stat__sk ov-stat__sk--num">${sk("64px", "24px")}</div>
            <div class="ov-stat__sk" style="height:16px">${sk("128px", "12px")}</div>
        </div>`;
    const orderSkel = (count) => `<ul class="ov-rows">${Array.from({ length: count }, (_, i) => `
        <li class="ov-order ov-order--sk">
            <div class="ov-order__main ov-order__main--sk">${sk(SKEL_W[i % 4], "12px")}${sk(SKEL_W2[i % 4], "12px")}</div>
            <div class="ov-order__meta">${sk("", "16px", "ov-sk-amount")}${sk("", "24px", "ov-sk-pay")}${sk("", "24px", "ov-sk-wait")}</div>
        </li>`).join("")}</ul>`;
    const stockSkel = (count) => `<ul class="ov-rows">${Array.from({ length: count }, (_, i) => `
        <li class="ov-stock ov-stock--sk">
            ${sk("40px", "40px", "ov-sk-square")}
            <div class="ov-stock__text ov-stock__text--sk">${sk(SKEL_S[i % 3], "12px")}${sk("25%", "12px")}</div>
            ${sk("80px", "24px", "ov-sk-shrink")}
        </li>`).join("")}</ul>`;
    const loadingView = () => `
        <div class="ov" aria-busy="true">
            <span class="sr-only" role="status">Đang tải tổng quan</span>
            <div><div class="ov-stats ov-stats--5">${statSkel()}${statSkel()}${statSkel()}${statSkel()}${statSkel()}</div></div>
            <div class="ov-grid">
                <section class="card ov-list">
                    <header class="ov-card-head ov-card-head--list"><h2>Cần xử lý</h2></header>
                    <div class="ov-list__body">
                        <div class="ov-group ov-group--sk">${sk("112px", "12px")}</div>
                        ${orderSkel(4)}
                        <div class="ov-group ov-group--sk">${sk("96px", "12px")}</div>
                        ${stockSkel(3)}
                    </div>
                </section>
                <div class="ov-side">
                    <section class="card ov-chart">
                        <header class="ov-card-head"><h2>Top 5 sản phẩm bán chạy</h2></header>
                        <div class="ov-top ov-top--sk">${[85, 70, 55, 40, 30].map((height) => `<div class="ov-top__col"><div class="ov-top__area"><div class="sk ov-top__bar" style="height:${height}%;border-radius:6px 6px 0 0"></div></div></div>`).join("")}</div>
                    </section>
                </div>
            </div>
        </div>`;

    const errorView = () => `
        <section class="card ov-error" role="alert">
            <div class="ov-error__body">
                <div>
                    <p class="ov-error__title">Không tải được tổng quan</p>
                    <p class="ov-error__text">Mất kết nối tới máy chủ</p>
                </div>
                <button type="button" class="ab ab--outline" data-ov-retry>${icon("rotate-cw")}Thử lại</button>
            </div>
        </section>`;

    /* ---------- Tải dữ liệu ---------- */
    const unwrap = (payload) => (payload && Array.isArray(payload.data) ? payload.data : []);
    const fetchProducts = async () => {
        const url = (page) => `/api/admin/products?status=active&page=${page}&pageSize=48`;
        const first = await UI.api(url(1));
        const rows = unwrap(first);
        const totalPages = Math.min(50, Math.max(1, Number(first && first.meta && first.meta.totalPages) || 1));
        if (totalPages > 1) {
            const rest = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => UI.api(url(index + 2))));
            rest.forEach((payload) => rows.push(...unwrap(payload)));
        }
        return rows;
    };


    let hasData = false;
    let token = 0;

    const render = (html) => { root.innerHTML = html; };

    const load = async () => {
        const mine = ++token;
        if (!hasData) render(loadingView());
        try {
            const [summaryPayload, pendingPayload, products] = await Promise.all([
                UI.api("/api/admin/dashboard/summary"),
                UI.api("/api/orders?status=PENDING&pageSize=50"),
                fetchProducts()
            ]);
            if (mine !== token) return;
            if (window.AdminShell) window.AdminShell.setPendingCount(summaryPayload.data.pendingOrders);
            hasData = true;
            render(dataView(compute({ summary: summaryPayload.data, pendingOrders: unwrap(pendingPayload), products })));
        } catch (error) {
            if (mine !== token) return;
            if (hasData) return;
            render(errorView());
        }
    };

    root.addEventListener("click", (event) => {
        if (event.target.closest("[data-ov-retry]")) { hasData = false; load(); }
    });
    document.addEventListener("admin:view", (event) => {
        if (event.detail.view === "tong-quan") load();
    });
    document.addEventListener("admin:orders-changed", () => {
        if (UI.view === "tong-quan") load();
    });
})();
