/* ===== ADMIN: TỔNG QUAN (wireframe tongquan.js, phương án A) =====
 * Nguồn dữ liệu: GET /api/orders, GET /api/admin/products?status=active&pageSize=48 (lặp trang), GET /api/admin/audit-logs.
 * Tải lại mỗi lần mở màn Tổng quan ('admin:view') và khi nhận 'admin:orders-changed'.
 *
 * Định nghĩa số liệu:
 *  - Đơn chờ xử lý        = orderStatus === PENDING; sắp theo thời gian chờ giảm dần. "Chờ quá 24 giờ" = chờ >= 24 giờ.
 *  - Đã thanh toán, chưa giao = paymentStatus === PAID và orderStatus ∈ {PENDING, PROCESSING}.
 *  - Sắp hết / hết hàng   = tổng tồn của sản phẩm đang bán <= 5 (hết hàng = 0, sắp hết = 1..5).
 *  - Doanh thu hôm nay    = tổng totalPrice đơn tạo trong ngày (giờ địa phương trình duyệt), PAID và không CANCELLED. So với hôm qua cùng cách tính.
 *  - Đơn mỗi ngày         = số đơn (mọi trạng thái) tạo trong từng ngày địa phương, 7 ngày kết thúc hôm nay.
 */
(() => {
    "use strict";
    const UI = window.AdminUI;
    if (!UI) return;

    const root = document.getElementById("overview-root");
    if (!root) return;

    const esc = UI.escapeHtml;
    const HOUR = 3600e3;
    const DAY = 86400e3;

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
    const two = (value) => String(value).padStart(2, "0");
    const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const waitText = (hours) => (hours >= 48 ? `Chờ ${Math.floor(hours / 24)} ngày` : hours < 1 ? "Chờ dưới 1 giờ" : `Chờ ${hours} giờ`);

    /* ---------- Tính số liệu ---------- */
    const compute = ({ orders, products, logs }) => {
        const now = new Date();
        const today = startOfDay(now);
        const yesterday = new Date(today.getTime() - DAY);
        const withAge = orders.map((order) => {
            const created = new Date(order.createdAt);
            return { ...order, _created: created, _age: Math.max(0, Math.floor((now - created) / HOUR)), _total: Number(order.totalPrice) || 0 };
        });
        const byAge = (a, b) => b._age - a._age;
        const pending = withAge.filter((order) => order.orderStatus === "PENDING").sort(byAge);
        const paidOpen = withAge.filter((order) => order.paymentStatus === "PAID" && (order.orderStatus === "PENDING" || order.orderStatus === "PROCESSING"));
        const preparing = paidOpen.filter((order) => order.orderStatus === "PROCESSING");
        const low = products.filter((product) => Number(product.stock) <= 5).sort((a, b) => Number(a.stock) - Number(b.stock));
        const sameDay = (order, day) => startOfDay(order._created).getTime() === day.getTime();
        const earned = (day) => withAge.filter((order) => sameDay(order, day) && order.paymentStatus === "PAID" && order.orderStatus !== "CANCELLED").reduce((sum, order) => sum + order._total, 0);
        const revenueToday = earned(today);
        const revenueYesterday = earned(yesterday);
        const days = Array.from({ length: 7 }, (_, index) => {
            const day = new Date(today.getTime() - (6 - index) * DAY);
            return { label: `${two(day.getDate())}/${two(day.getMonth() + 1)}`, n: withAge.filter((order) => sameDay(order, day)).length };
        });
        return {
            now, today, logs: logs.slice(0, 5),
            orders: withAge, pending, paidOpen, preparing, low,
            late: pending.filter((order) => order._age >= 24).length,
            few: low.filter((product) => Number(product.stock) > 0).length,
            out: low.filter((product) => Number(product.stock) <= 0).length,
            paidPending: paidOpen.length - preparing.length,
            revenueToday, revenueYesterday,
            pct: revenueYesterday > 0 ? Math.round(((revenueToday - revenueYesterday) / revenueYesterday) * 100) : null,
            ordersToday: days[6].n, ordersYesterday: days[5].n, days
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

    const revenueSub = (c) => {
        if (c.pct === null) return `<span class="ov-cmp">${c.revenueToday > 0 ? "Hôm qua chưa có doanh thu" : "Chưa có doanh thu so với hôm qua"}</span>`;
        const up = c.pct >= 0;
        return `<span class="ov-cmp">${icon(up ? "trending-up" : "trending-down", `icon--14 ${up ? "ov-cmp__up" : "ov-cmp__down"}`)}<span class="ov-cmp__pct tabular ${up ? "ov-cmp__up" : "ov-cmp__down"}">${Math.abs(c.pct)}%</span> so với hôm qua</span>`;
    };

    const statsBlock = (c) => `
        <div class="ov-stats">
            ${statCell({ label: "Đơn chờ xử lý", value: c.pending.length, sub: `<span class="ov-late">${icon("triangle-alert", "icon--14")}${c.late} chờ quá 24 giờ</span>` })}
            ${statCell({ label: "Đã thanh toán, chưa giao", value: c.paidOpen.length, sub: `${c.paidPending} chờ xác nhận · ${c.preparing.length} đang chuẩn bị` })}
            ${statCell({ label: "Sắp hết / hết hàng", value: c.low.length, sub: `${c.few} sắp hết · ${c.out} hết hàng` })}
            ${statCell({ label: "Doanh thu hôm nay", value: mil(c.revenueToday), unit: "tr ₫", title: `Hôm nay ${vnd(c.revenueToday)} · hôm qua ${vnd(c.revenueYesterday)}`, sub: revenueSub(c) })}
        </div>`;

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

    const listBlock = (c) => `
        <section class="card ov-list" aria-labelledby="ov-need-title">
            <header class="ov-card-head ov-card-head--list"><h2 id="ov-need-title">Cần xử lý</h2></header>
            <div class="ov-list__body">
                ${groupHead("Đơn chờ xử lý", c.pending.length, "#/don-hang", "Tất cả đơn")}
                <ul class="ov-rows">${c.pending.map(orderRow).join("")}</ul>
                ${groupHead("Sắp hết hàng", c.low.length, "#/san-pham", "Tất cả sản phẩm")}
                <ul class="ov-rows">${c.low.map(stockRow).join("")}</ul>
            </div>
        </section>`;

    const chartBlock = (c) => {
        const peak = Math.max(...c.days.map((day) => day.n));
        const last = c.days.length - 1;
        const cols = c.days.map((day, index) => `
            <div class="ov-col">
                <div class="ov-col__gap" style="flex-grow:${peak - day.n}"></div>
                <p class="ov-col__n tabular">${day.n}</p>
                <div class="ov-col__bar${index === last ? " is-today" : ""}" style="flex-grow:${day.n}"></div>
            </div>`).join("");
        const axis = c.days.map((day, index) => (index === last
            ? "<p class=\"ov-axis__today\">Hôm nay</p>"
            : `<p class="ov-axis__day tabular">${day.label}</p>`)).join("");
        return `
        <section class="card ov-chart" aria-labelledby="ov-chart-title">
            <header class="ov-card-head">
                <h2 id="ov-chart-title">Đơn mỗi ngày</h2>
                <p class="ov-card-head__sub">7 ngày gần nhất · hôm nay ${c.ordersToday} đơn, hôm qua ${c.ordersYesterday}</p>
            </header>
            <div role="img" aria-label="Đơn mỗi ngày, 7 ngày gần nhất: ${c.days.map((day) => `${day.label} ${day.n}`).join(", ")}" class="ov-cols">${cols}</div>
            <div class="ov-axis">${axis}</div>
        </section>`;
    };

    /* ---------- Hoạt động từ audit log ---------- */
    const VERB = { CREATE: "đã tạo", UPDATE: "đã sửa", SOFT_DELETE: "đã xoá", DELETE: "đã xoá", RESTORE: "đã khôi phục", DISABLE: "đã tắt", ENABLE: "đã bật", HIDE: "đã ẩn", UNHIDE: "đã hiện lại" };
    const NOUN = { product: "sản phẩm", variant: "phiên bản", user: "tài khoản", account: "tài khoản", order: "đơn hàng", voucher: "voucher", review: "đánh giá" };
    const entityTarget = (log) => {
        const id = String(log.entityId ?? "");
        return /^\d+$/.test(id) ? `#${id}` : id;
    };
    const describe = (log) => {
        const action = String(log.action || "").toUpperCase();
        const entity = String(log.entity || "").toLowerCase();
        let what;
        let target = entityTarget(log);
        if (action === "CREATE_ADMIN") {
            what = "đã tạo tài khoản Admin";
            const created = log.changes && log.changes.username && log.changes.username.new;
            if (created) target = String(created);
        } else {
            what = `${VERB[action] || `đã ${action.toLowerCase().replace(/_/g, " ")}`} ${NOUN[entity] || entity}`.trim();
        }
        const removed = action === "SOFT_DELETE" || action === "DELETE";
        let href = "";
        if (!removed && target) {
            if (entity === "product" || entity === "variant") href = "#/san-pham";
            else if (entity === "voucher") href = "#/voucher";
            else if (entity === "review") href = "#/danh-gia";
            else if (entity === "user" || entity === "account") href = "#/tai-khoan";
            else if (entity === "order") href = `#/don-hang/${encodeURIComponent(log.entityId)}`;
        }
        return { what, target, href };
    };
    const timeLabel = (iso, today) => {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "";
        const diff = Math.round((today - startOfDay(date)) / DAY);
        if (diff <= 0) return `${two(date.getHours())}:${two(date.getMinutes())}`;
        if (diff === 1) return "Hôm qua";
        const base = `${two(date.getDate())}/${two(date.getMonth() + 1)}`;
        return date.getFullYear() === today.getFullYear() ? base : `${base}/${date.getFullYear()}`;
    };
    const activityBlock = (c) => `
        <section class="card ov-activity" aria-labelledby="ov-activity-title">
            <header class="ov-card-head"><h2 id="ov-activity-title">Hoạt động gần đây</h2></header>
            <ul class="ov-feed">
                ${c.logs.map((log) => {
                    const who = String(log.actor || "admin");
                    const { what, target, href } = describe(log);
                    const targetHtml = !target ? "" : href ? `<a class="ov-feed__target" href="${href}">${esc(target)}</a>` : `<span class="ov-feed__plain">${esc(target)}</span>`;
                    return `
                <li class="ov-feed__item">
                    ${UI.avatarHtml(who)}
                    <div class="ov-feed__text">
                        <p class="ov-feed__line"><span class="ov-feed__who">${esc(who)}</span> ${esc(what)} ${targetHtml}</p>
                        <p class="ov-feed__at">${esc(timeLabel(log.timestamp, c.today))}</p>
                    </div>
                </li>`;
                }).join("") || "<li class=\"ov-feed__empty\">Chưa có hoạt động nào.</li>"}
            </ul>
        </section>`;

    const dataView = (c) => `
        <div class="ov">
            <div>${statsBlock(c)}</div>
            <div class="ov-grid">
                ${listBlock(c)}
                <div class="ov-side">
                    ${chartBlock(c)}
                    ${activityBlock(c)}
                </div>
            </div>
        </div>`;

    /* ---------- Đang tải ---------- */
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
            <div><div class="ov-stats">${statSkel()}${statSkel()}${statSkel()}${statSkel()}</div></div>
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
                        <header class="ov-card-head"><h2>Đơn mỗi ngày</h2></header>
                        <div class="ov-cols ov-cols--sk">${[40, 85, 55, 100, 25, 55, 70].map((height) => `<div class="ov-col ov-col--sk"><div class="sk ov-col__bar" style="height:${height * 1.5}px;border-radius:6px 6px 0 0"></div></div>`).join("")}</div>
                        <div class="ov-axis ov-axis--sk">${Array.from({ length: 7 }, () => `<div class="ov-axis__sk">${sk("28px", "12px")}</div>`).join("")}</div>
                    </section>
                    <section class="card ov-activity">
                        <header class="ov-card-head"><h2>Hoạt động gần đây</h2></header>
                        <ul class="ov-feed">${Array.from({ length: 5 }, (_, i) => `<li class="ov-feed__item">${sk("32px", "32px", "ov-sk-square")}<div class="ov-feed__text ov-feed__text--sk">${sk(["80%", "60%", "66.666%", "75%", "50%"][i], "12px")}${sk("48px", "12px")}</div></li>`).join("")}</ul>
                    </section>
                </div>
            </div>
        </div>`;

    /* ---------- Rỗng / lỗi: một khối thay cả lưới ---------- */
    const emptyView = () => `
        <section class="card ov-empty" aria-labelledby="ov-empty-title">
            <h2 id="ov-empty-title">Chưa có đơn hàng nào</h2>
            <p>Số liệu, đơn chờ xử lý và hoạt động sẽ hiện ở đây sau đơn đầu tiên. Trong lúc chờ, kiểm tra sản phẩm đã đủ hàng để bán.</p>
            <a class="ab ab--primary" href="#/san-pham">Xem sản phẩm</a>
        </section>`;
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
            const [ordersPayload, products, logsPayload] = await Promise.all([
                UI.api("/api/orders"),
                fetchProducts(),
                UI.api("/api/admin/audit-logs")
            ]);
            if (mine !== token) return;
            const orders = unwrap(ordersPayload);
            if (window.AdminShell) window.AdminShell.setPendingCount(window.AdminShell.countPending(orders));
            hasData = true;
            render(orders.length ? dataView(compute({ orders, products, logs: unwrap(logsPayload) })) : emptyView());
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
