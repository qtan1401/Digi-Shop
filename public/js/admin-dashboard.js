/* NodeShop admin: màn Thống kê (#/thong-ke), dashboard nâng cao.
 * Hợp đồng với khung admin:
 *   AdminDashboard.mount(rootEl, { api, toast })   gọi một lần, vẽ cả màn vào rootEl
 *   AdminDashboard.activate()                      mở lại màn: tải lại âm thầm
 * Dữ liệu: GET /api/admin/dashboard/series?granularity=year|quarter|month|week&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   (gom nhóm ở SQL, giờ cửa hàng UTC+7, tuần bắt đầu thứ Hai).
 * Định nghĩa (GLOSSARY: Revenue, Profit): số đơn = đơn không bị hủy trong kỳ; doanh thu = tổng tiền đơn đã thanh toán hoặc đã giao;
 *   lợi nhuận = Σ(thành tiền − giá vốn × số lượng) − giảm giá voucher − giảm giá điểm, trên chính các đơn tính doanh thu.
 * Biểu đồ vẽ bằng div (không thư viện): một chuỗi một màu, hai chuỗi phân biệt bằng đậm nhạt, mỗi cột có số hoặc nằm trong bảng số liệu.
 */
(() => {
    "use strict";
    const UI = window.AdminUI;
    if (!UI) return;
    const esc = UI.escapeHtml;

    const PERIODS = [["year", "Năm"], ["quarter", "Quý"], ["month", "Tháng"], ["week", "Tuần"], ["custom", "Từ – đến"]];
    const GRANULARITIES = [["year", "Năm"], ["quarter", "Quý"], ["month", "Tháng"], ["week", "Tuần"]];
    // Kỳ nào thì mặc định chia cột theo gì.
    const DEFAULT_GRANULARITY = { year: "month", quarter: "week", month: "week", week: "week", custom: "month" };
    const MAX_BARS_WITH_NUMBERS = 12;
    const TYPE_LABELS = (window.CatalogTaxonomy && window.CatalogTaxonomy.DEVICE_TYPE_LABELS) || {};

    const pad = (n) => String(n).padStart(2, "0");
    const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
    const vnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")}₫`;
    const num = (n) => Number(n || 0).toLocaleString("vi-VN");
    const trim = (n) => n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
    // Số gọn cho nhãn đầu cột: 1,2 tỷ · 12,5 tr · 340 k.
    const compact = (n) => {
        const v = Number(n) || 0;
        const a = Math.abs(v);
        if (a >= 1e9) return `${trim(v / 1e9)} tỷ`;
        if (a >= 1e6) return `${trim(v / 1e6)} tr`;
        if (a >= 1e3) return `${trim(v / 1e3)} k`;
        return num(v);
    };
    const daysIn = (year, month) => new Date(year, month, 0).getDate();
    const mondayOf = (date) => { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
    const isoOf = (d) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());

    const mount = (rootEl, options = {}) => {
        const apiCall = options.api || UI.api;
        const toast = typeof options.toast === "function" ? options.toast : () => {};
        const now = new Date();
        const state = {
            period: "year", granularity: "month",
            year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1,
            month: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
            day: isoOf(now), from: iso(now.getFullYear(), 1, 1), to: isoOf(now),
            phase: "loading", error: null, data: null, fetching: false
        };
        let seq = 0;

        const years = () => { const y = now.getFullYear(); return Array.from({ length: 8 }, (_, i) => y - i); };

        /* ---------- khoảng đang chọn -> from/to ---------- */
        const range = () => {
            const { period } = state;
            if (period === "year") return { from: iso(state.year, 1, 1), to: iso(state.year, 12, 31) };
            if (period === "quarter") {
                const m0 = (state.quarter - 1) * 3 + 1;
                return { from: iso(state.year, m0, 1), to: iso(state.year, m0 + 2, daysIn(state.year, m0 + 2)) };
            }
            if (period === "month") {
                const [y, m] = state.month.split("-").map(Number);
                return { from: iso(y, m, 1), to: iso(y, m, daysIn(y, m)) };
            }
            if (period === "week") {
                const monday = mondayOf(new Date(`${state.day}T00:00:00`));
                const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
                return { from: isoOf(monday), to: isoOf(sunday) };
            }
            return { from: state.from, to: state.to };
        };
        const rangeValid = () => {
            if (state.period === "month" && !/^\d{4}-\d{2}$/.test(state.month)) return false;
            if (state.period === "week" && !state.day) return false;
            const r = range();
            return /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;
        };
        const periodLabel = () => {
            const r = range();
            const fmt = (s) => s.split("-").reverse().join("/");
            if (state.period === "year") return `Năm ${state.year}`;
            if (state.period === "quarter") return `Quý ${state.quarter}/${state.year}`;
            if (state.period === "month") return `Tháng ${Number(state.month.split("-")[1])}/${state.month.split("-")[0]}`;
            return `${fmt(r.from)} – ${fmt(r.to)}`;
        };

        /* ---------- khung ---------- */
        rootEl.innerHTML = `
            <div class="ad">
                <section class="card ad-controls" aria-label="Chọn khoảng thời gian">
                    <div class="ad-row">
                        <div class="ad-field"><span class="ad-label" id="ad-period-label">Khoảng thời gian</span>
                            <div class="status-tabs" role="radiogroup" aria-labelledby="ad-period-label" data-slot="period"></div></div>
                        <div class="ad-field" data-slot="pickers"></div>
                    </div>
                    <div class="ad-row">
                        <div class="ad-field"><span class="ad-label" id="ad-gran-label">Biểu đồ so sánh theo</span>
                            <div class="status-tabs" role="radiogroup" aria-labelledby="ad-gran-label" data-slot="granularity"></div></div>
                    </div>
                    <p class="ad-error" role="alert" data-slot="range-error" hidden></p>
                </section>
                <div data-slot="stats"></div>
                <div data-slot="charts"></div>
                <p class="sr-only" role="status" aria-live="polite" data-slot="live"></p>
                <div class="ad-tip" role="tooltip" data-slot="tip" hidden></div>
            </div>`;
        const $ = (name) => rootEl.querySelector(`[data-slot="${name}"]`);
        const slots = { period: $("period"), pickers: $("pickers"), granularity: $("granularity"), stats: $("stats"), charts: $("charts"), live: $("live"), rangeError: $("range-error") };
        const live = (msg) => { slots.live.textContent = ""; if (msg) setTimeout(() => { slots.live.textContent = msg; }, 20); };

        const radios = (items, current, attr) => items.map(([key, label]) =>
            `<button type="button" role="radio" aria-checked="${key === current}" tabindex="${key === current ? 0 : -1}" data-${attr}="${key}" class="status-tab ${key === current ? "is-active" : ""}">${label}</button>`).join("");
        const renderControls = () => {
            slots.period.innerHTML = radios(PERIODS, state.period, "period");
            slots.granularity.innerHTML = radios(GRANULARITIES, state.granularity, "gran");
            const yearSelect = (id) => `<label class="ad-pick"><span>Năm</span><select class="ad-input" id="${id}" data-pick="year">${years().map((y) => `<option value="${y}" ${y === state.year ? "selected" : ""}>${y}</option>`).join("")}</select></label>`;
            const html = {
                year: yearSelect("ad-year"),
                quarter: `${yearSelect("ad-year")}<label class="ad-pick"><span>Quý</span><select class="ad-input" data-pick="quarter">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${q === state.quarter ? "selected" : ""}>Quý ${q}</option>`).join("")}</select></label>`,
                month: `<label class="ad-pick"><span>Tháng</span><input type="month" class="ad-input" data-pick="month" value="${esc(state.month)}"></label>`,
                week: `<label class="ad-pick"><span>Một ngày trong tuần (tuần bắt đầu thứ Hai)</span><input type="date" class="ad-input" data-pick="day" value="${esc(state.day)}"></label>`,
                custom: `<label class="ad-pick"><span>Từ ngày</span><input type="date" class="ad-input" data-pick="from" value="${esc(state.from)}"></label><label class="ad-pick"><span>Đến ngày</span><input type="date" class="ad-input" data-pick="to" value="${esc(state.to)}"></label>`
            }[state.period];
            slots.pickers.innerHTML = `<div class="ad-picks">${html}</div>`;
        };

        /* ---------- ô số liệu ---------- */
        const statCell = (label, value, sub, title = "") => `
            <div class="ov-stat"${title ? ` title="${esc(title)}"` : ""}>
                <p class="ov-stat__label">${label}</p>
                <p class="ov-stat__value tabular">${value}</p>
                <div class="ov-stat__sub">${sub}</div>
            </div>`;
        const statsHtml = () => {
            if (state.phase === "loading") {
                return `<div class="ov-stats" aria-busy="true">${[0, 1, 2, 3].map(() => `<div class="ov-stat"><div class="ov-stat__sk" style="height:16px"><div class="sk" style="width:96px;height:12px"></div></div><div class="ov-stat__sk ov-stat__sk--num"><div class="sk" style="width:80px;height:24px"></div></div><div class="ov-stat__sk" style="height:16px"><div class="sk" style="width:120px;height:12px"></div></div></div>`).join("")}</div><span class="sr-only" role="status">Đang tải thống kê</span>`;
            }
            if (!state.data) return "";
            const t = state.data.totals;
            const label = esc(periodLabel());
            return `<div class="ov-stats">
                ${statCell("Số đơn", num(t.orders), `${label} · không tính đơn hủy`)}
                ${statCell("Doanh thu", `${compact(t.revenue)}<span class="ov-stat__unit">₫</span>`, `${vnd(t.revenue)} · đơn đã thanh toán hoặc đã giao`, vnd(t.revenue))}
                ${statCell("Lợi nhuận", `${compact(t.profit)}<span class="ov-stat__unit">₫</span>`, `${vnd(t.profit)} · sau giá vốn và giảm giá`, vnd(t.profit))}
                ${statCell("Sản phẩm đã bán", num(t.itemsSold), "Số lượng trên các đơn tính doanh thu")}
            </div>`;
        };

        // series: [{ key, name, tone }]; tone 0 = đậm (--chart-fill), 1 = nhạt (45%). Cột âm vẽ chiều cao 0, số thật vẫn hiện.
        // Trục dọc có vạch chia "đẹp"; khung cuộn ngang bên trong thẻ; nhãn trục ngang được thưa ra khi nhiều cột.
        const niceScale = (peak, integer) => {
            let step = peak / 4;
            const mag = Math.pow(10, Math.floor(Math.log10(step)));
            const norm = step / mag;
            step = (norm <= 1 ? 1 : norm <= 2 ? 2 : (norm <= 2.5 && !integer) ? 2.5 : norm <= 5 ? 5 : 10) * mag;
            if (integer && step < 1) step = 1;
            const n = Math.max(1, Math.ceil(peak / step - 1e-9));
            return { max: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
        };
        const columnsHtml = (buckets, series, valueOf, format, aria, tipOf) => {
            const peak = Math.max(1, ...buckets.flatMap((b) => series.map((s) => Math.max(0, Number(valueOf(b, s.key)) || 0))));
            const scale = niceScale(peak, !!format.integer);
            // Số trên đầu cột chỉ hiện với một chuỗi, ≤ 12 cột và cột đủ rộng (56px); ngược lại có trong tooltip, aria và bảng số liệu.
            const showNumbers = series.length === 1 && buckets.length <= MAX_BARS_WITH_NUMBERS;
            const focusable = buckets.length <= 24;
            const colW = showNumbers ? 56 : Math.max(36, series.length * 22 + 8);
            const labelW = Math.max(...buckets.map((b) => String(b.label).length), 1) * 6.5 + 12;
            const step = Math.max(1, Math.ceil(labelW / (colW + 8)));
            const cols = buckets.map((b, i) => {
                const bars = series.map((s) => {
                    const v = Number(valueOf(b, s.key)) || 0;
                    const pct = Math.max(0, v) / scale.max * 100;
                    return `<div class="ad-bar-wrap">
                        ${showNumbers ? `<span class="ad-bar-n tabular${v < 0 ? " is-neg" : ""}">${format.short(v)}</span>` : ""}
                        <div class="ad-bar ad-bar--${s.tone}" style="height:${pct}%"></div></div>`;
                }).join("");
                const tip = [String(b.label), ...tipOf(b)].join("\n");
                const a11y = focusable ? ` tabindex="0" role="img" aria-label="${esc(tip.replace(/\n/g, ", "))}"` : "";
                return `<div class="ad-col" style="min-width:${colW}px" data-tip="${esc(tip)}"${a11y}><div class="ad-bars">${bars}</div><p class="ad-axis-l tabular" aria-hidden="true">${i % step === 0 ? esc(b.label) : ""}</p></div>`;
            }).join("");
            const yTicks = scale.ticks.map((t) => `<span style="bottom:${t / scale.max * 100}%">${format.short(t)}</span>`).join("");
            const lines = scale.ticks.map((t) => `<i style="bottom:${t / scale.max * 100}%"></i>`).join("");
            const label = `${aria}. ${buckets.length} cột, cuộn ngang để xem hết; số liệu đầy đủ trong bảng số liệu bên dưới`;
            return `<div class="ad-plot"><div class="ad-yaxis" aria-hidden="true">${yTicks}</div>
                <div class="ad-scroll scrollbar-clean" tabindex="0" role="group" aria-label="${esc(label)}"><div class="ad-cols"><div class="ad-grid" aria-hidden="true">${lines}</div>${cols}</div></div></div>`;
        };
        const legendHtml = (series) => `<ul class="ad-legend" aria-label="Chú giải">${series.map((s) => `<li><span class="ad-dot ad-bar--${s.tone}" aria-hidden="true"></span>${esc(s.name)}</li>`).join("")}</ul>`;
        const chartCard = (id, title, sub, body) => `
            <section class="card ad-chart" aria-labelledby="${id}">
                <header class="ov-card-head"><h2 id="${id}">${title}</h2><p class="ov-card-head__sub">${sub}</p></header>
                ${body}
            </section>`;

        const typeBarsHtml = (types) => {
            if (!types.length) return '<p class="ad-empty">Chưa bán sản phẩm nào trong kỳ này.</p>';
            const total = types.reduce((s, t) => s + t.quantity, 0) || 1;
            const peak = Math.max(...types.map((t) => t.quantity)) || 1;
            return `<ul class="ad-types">${types.map((t) => `
                <li><div class="ad-type-top"><span class="ad-type-name">${esc(TYPE_LABELS[t.deviceType] || t.deviceType)}</span>
                    <span class="ad-type-val tabular">${num(t.quantity)} sản phẩm · ${trim(t.quantity / total * 100)}%</span></div>
                    <div class="ad-type-track"><div class="ad-type-fill" style="width:${t.quantity / peak * 100}%"></div></div>
                    <p class="ad-type-sub tabular">Doanh số ${vnd(t.revenue)}</p></li>`).join("")}</ul>`;
        };

        const tableHtml = (buckets, totals) => `
            <details class="card ad-table-card">
                <summary>Bảng số liệu</summary>
                <div class="ad-scroll scrollbar-clean"><table class="ad-table">
                    <thead><tr><th scope="col">Kỳ</th><th scope="col" class="num">Số đơn</th><th scope="col" class="num">Doanh thu</th><th scope="col" class="num">Lợi nhuận</th><th scope="col" class="num">Sản phẩm bán</th></tr></thead>
                    <tbody>${buckets.map((b) => `<tr><th scope="row">${esc(b.label)}</th><td class="num tabular">${num(b.orders)}</td><td class="num tabular">${vnd(b.revenue)}</td><td class="num tabular">${vnd(b.profit)}</td><td class="num tabular">${num(b.itemsSold)}</td></tr>`).join("")}</tbody>
                    <tfoot><tr><th scope="row">Tổng</th><td class="num tabular">${num(totals.orders)}</td><td class="num tabular">${vnd(totals.revenue)}</td><td class="num tabular">${vnd(totals.profit)}</td><td class="num tabular">${num(totals.itemsSold)}</td></tr></tfoot>
                </table></div>
            </details>`;

        const CMP_ROWS = [["orders", "Số đơn", num], ["revenue", "Doanh thu", vnd], ["profit", "Lợi nhuận", vnd], ["itemsSold", "Sản phẩm bán", num], ["newUsers", "Khách mới", num]];
        const dmy = (s) => String(s || "").split("-").reverse().join("/");
        // Thay đổi % có dấu; mũi tên + chữ (không chỉ màu). null = kỳ trước chưa có số để so.
        const changeHtml = (c) => {
            if (c === null || c === undefined || !Number.isFinite(Number(c))) return '<span class="ad-chg ad-chg--na">Chưa có kỳ trước</span>';
            const v = Number(c);
            if (v > 0) return `<span class="ad-chg ad-chg--up"><span aria-hidden="true">▲</span> Tăng +${trim(v)}%</span>`;
            if (v < 0) return `<span class="ad-chg ad-chg--down"><span aria-hidden="true">▼</span> Giảm −${trim(Math.abs(v))}%</span>`;
            return '<span class="ad-chg ad-chg--flat"><span aria-hidden="true">■</span> Không đổi 0%</span>';
        };
        const compareHtml = (d) => {
            const p = d.previous;
            if (!p || !p.totals) return chartCard("ad-cmp-title", "So sánh với kỳ trước", "", '<p class="ad-empty">Chưa có kỳ trước để so sánh.</p>');
            const items = CMP_ROWS.map(([key, name, fmt]) => `
                <li class="ad-cmp__item">
                    <p class="ad-cmp__name">${name}</p>
                    <p class="ad-cmp__now tabular">${fmt(d.totals[key])}</p>
                    <p class="ad-cmp__prev tabular">Kỳ trước: ${fmt(p.totals[key])}</p>
                    <p class="ad-cmp__chg">${changeHtml(p.change && p.change[key])}</p>
                </li>`).join("");
            return chartCard("ad-cmp-title", "So sánh với kỳ trước", `Kỳ này ${esc(periodLabel())} · kỳ trước ${esc(dmy(p.from))} – ${esc(dmy(p.to))}`, `<ul class="ad-cmp">${items}</ul>`);
        };

        const chartsHtml = () => {
            if (state.phase === "loading") {
                return `<div class="ad-charts" aria-busy="true">${[0, 1].map(() => `<section class="card ad-chart"><header class="ov-card-head"><div class="sk" style="width:140px;height:16px"></div></header><div class="ad-skel-cols">${[40, 70, 55, 90, 35, 60, 80, 45].map((h) => `<div class="sk" style="height:${h}%;border-radius:6px 6px 0 0"></div>`).join("")}</div></section>`).join("")}</div>`;
            }
            if (state.phase === "error") {
                const net = !state.error || !state.error.status;
                const invalid = state.error && state.error.code === "INVALID_FILTER";
                return `<section class="card ov-error" role="alert"><div class="ov-error__body"><div>
                    <p class="ov-error__title">${invalid ? "Khoảng thời gian không hợp lệ" : "Không tải được thống kê"}</p>
                    <p class="ov-error__text">${invalid ? "Chọn khoảng ngắn hơn hoặc chia cột theo chu kỳ lớn hơn." : net ? "Mất kết nối tới máy chủ" : "Máy chủ gặp lỗi, thử lại sau ít phút"}</p></div>
                    <button type="button" class="ab ab--outline" data-ad-retry>Thử lại</button></div></section>`;
            }
            const d = state.data;
            if (!d) return "";
            const buckets = Array.isArray(d.buckets) ? d.buckets : [];
            const totals = d.totals || {};
            const types = Array.isArray(d.deviceTypes) ? d.deviceTypes : [];
            const unit = { year: "năm", quarter: "quý", month: "tháng", week: "tuần" }[d.granularity] || "kỳ";
            const sub = `Theo ${unit} · ${esc(periodLabel())}`;
            const typeName = (t) => TYPE_LABELS[t] || t;
            const typeCount = (b) => Object.keys(b.deviceTypes || {}).length;
            const typeLines = (b) => Object.entries(b.deviceTypes || {}).map(([t, n]) => `${typeName(t)}: ${num(n)}`);
            const money = { short: compact, full: vnd };
            const count = (suffix) => ({ short: num, full: (v) => `${num(v)} ${suffix}`, integer: true });
            const moneySeries = [{ key: "revenue", name: "Doanh thu", tone: 0 }, { key: "profit", name: "Lợi nhuận", tone: 1 }];
            const hasNeg = buckets.some((b) => Number(b.profit) < 0);
            const hint = '<p class="ad-hint">Số cụ thể hiện khi rê chuột, chạm hoặc focus vào cột; đủ số liệu có trong bảng số liệu bên dưới.</p>'
                + (hasNeg ? '<p class="ad-hint">Kỳ lỗ: cột lợi nhuận âm vẽ chiều cao 0, số thật ở nhãn cột và bảng số liệu.</p>' : "");
            const series1 = (key, name) => [{ key, name, tone: 0 }];
            const empty = !buckets.length || (!totals.orders && !totals.revenue && !totals.itemsSold && !totals.newUsers);
            if (empty) {
                return `<div class="ad-charts">${chartCard("ad-empty-title", "Thống kê theo kỳ", sub, '<p class="ad-empty">Không có đơn hàng hay khách mới nào trong kỳ này. Thử chọn khoảng thời gian khác.</p>')}${compareHtml(d)}</div>${tableHtml(buckets, totals)}`;
            }
            return `<div class="ad-charts${buckets.length > 8 ? " ad-charts--wide" : ""}">
                ${compareHtml(d)}
                ${chartCard("ad-money-title", "Doanh thu và lợi nhuận", sub, `${legendHtml(moneySeries)}${columnsHtml(buckets, moneySeries, (b, k) => b[k], money, `Doanh thu và lợi nhuận ${sub}`, (b) => [`Doanh thu: ${vnd(b.revenue)}`, `Lợi nhuận: ${vnd(b.profit)}`])}${hint}`)}
                ${chartCard("ad-orders-title", "Số đơn", sub, columnsHtml(buckets, series1("orders", "Số đơn"), (b, k) => b[k], count("đơn"), `Số đơn ${sub}`, (b) => [`Số đơn: ${num(b.orders)}`]))}
                ${chartCard("ad-items-title", "Số sản phẩm bán", sub, columnsHtml(buckets, series1("itemsSold", "Sản phẩm bán"), (b, k) => b[k], count("sản phẩm"), `Số sản phẩm bán ${sub}`, (b) => [`Sản phẩm bán: ${num(b.itemsSold)}`]))}
                ${chartCard("ad-typecount-title", "Số loại sản phẩm bán", sub, columnsHtml(buckets, [{ key: "types", name: "Số loại sản phẩm", tone: 0 }], (b) => typeCount(b), count("loại"), `Số loại sản phẩm bán ${sub}`, (b) => [`Số loại sản phẩm: ${num(typeCount(b))}`, ...typeLines(b)]))}
                ${chartCard("ad-users-title", "Khách hàng mới", sub, columnsHtml(buckets, series1("newUsers", "Khách mới"), (b, k) => b[k], count("khách"), `Khách hàng mới ${sub}`, (b) => [`Khách mới: ${num(b.newUsers)}`]))}
                ${chartCard("ad-types-title", "Loại sản phẩm bán", `Theo loại thiết bị · ${esc(periodLabel())}`, typeBarsHtml(types))}
            </div>${tableHtml(buckets, totals)}`;
        };

        const renderResults = () => {
            slots.stats.innerHTML = statsHtml();
            slots.charts.innerHTML = chartsHtml();
            slots.charts.classList.toggle("is-fetching", state.fetching);
        };

        /* ---------- tải dữ liệu ---------- */
        const load = async ({ quiet = false } = {}) => {
            if (!rangeValid()) {
                slots.rangeError.textContent = "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.";
                slots.rangeError.hidden = false;
                seq++;
                state.data = null; state.fetching = false;
                slots.stats.innerHTML = ""; slots.charts.innerHTML = ""; slots.charts.classList.remove("is-fetching");
                return;
            }
            slots.rangeError.hidden = true;
            const mine = ++seq;
            state.error = null;
            if (!quiet || !state.data) { state.phase = "loading"; renderResults(); } else { state.fetching = true; renderResults(); }
            const r = range();
            const params = new URLSearchParams({ granularity: state.granularity, from: r.from, to: r.to });
            try {
                const payload = await apiCall(`/api/admin/dashboard/series?${params}`, { method: "GET" });
                if (mine !== seq) return;
                state.data = payload && payload.data;
                state.phase = "ready";
                state.fetching = false;
                renderResults();
                live(`Đã cập nhật thống kê ${periodLabel()}`);
            } catch (error) {
                if (mine !== seq) return;
                state.fetching = false;
                if (quiet && state.data && !(error && error.code === "INVALID_FILTER")) { renderResults(); toast("Không tải lại được thống kê. Thử lại sau.", "error"); return; }
                state.phase = "error";
                state.error = error;
                renderResults();
            }
        };

        /* ---------- sự kiện ---------- */
        slots.period.addEventListener("click", (e) => {
            const b = e.target.closest("[data-period]");
            if (!b || b.dataset.period === state.period) return;
            state.period = b.dataset.period;
            state.granularity = DEFAULT_GRANULARITY[state.period];
            renderControls();
            load({ quiet: true });
        });
        slots.granularity.addEventListener("click", (e) => {
            const b = e.target.closest("[data-gran]");
            if (!b || b.dataset.gran === state.granularity) return;
            state.granularity = b.dataset.gran;
            renderControls();
            load({ quiet: true });
        });
        // Mũi tên trái/phải đổi lựa chọn trong nhóm radio.
        const arrowNav = (container, items, attr, current, apply) => container.addEventListener("keydown", (e) => {
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (!step) return;
            e.preventDefault();
            const keys = items.map((i) => i[0]);
            const next = keys[(keys.indexOf(current()) + step + keys.length) % keys.length];
            apply(next);
            container.querySelector(`[data-${attr}="${next}"]`)?.focus();
        });
        arrowNav(slots.period, PERIODS, "period", () => state.period, (key) => { state.period = key; state.granularity = DEFAULT_GRANULARITY[key]; renderControls(); load({ quiet: true }); });
        arrowNav(slots.granularity, GRANULARITIES, "gran", () => state.granularity, (key) => { state.granularity = key; renderControls(); load({ quiet: true }); });
        slots.pickers.addEventListener("change", (e) => {
            const el = e.target.closest("[data-pick]");
            if (!el) return;
            const key = el.dataset.pick;
            if (key === "year" || key === "quarter") state[key] = Number(el.value);
            else state[key] = el.value;
            load({ quiet: true });
        });
        rootEl.addEventListener("click", (e) => { if (e.target.closest("[data-ad-retry]")) load(); });

        /* ---------- tooltip: rê chuột, chạm hoặc focus bàn phím vào một cột ---------- */
        const tipEl = $("tip");
        const hideTip = () => { tipEl.hidden = true; };
        const showTip = (el) => {
            tipEl.textContent = el.dataset.tip || "";
            tipEl.hidden = false;
            const r = el.getBoundingClientRect();
            const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
            const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), Math.max(8, window.innerWidth - w - 8));
            const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
            tipEl.style.left = `${left}px`;
            tipEl.style.top = `${top}px`;
        };
        const tipTarget = (e) => (e.target.closest ? e.target.closest("[data-tip]") : null);
        rootEl.addEventListener("pointerover", (e) => { const el = tipTarget(e); if (el) showTip(el); });
        rootEl.addEventListener("pointerout", (e) => { if (tipTarget(e)) hideTip(); });
        rootEl.addEventListener("focusin", (e) => { const el = tipTarget(e); if (el) showTip(el); });
        rootEl.addEventListener("focusout", hideTip);
        rootEl.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
        window.addEventListener("scroll", hideTip, true);

        renderControls();
        renderResults();
        instance.activate = () => { if (state.phase === "ready") load({ quiet: true }); };
        load();
    };

    const instance = { mount, activate: () => {} };
    window.AdminDashboard = instance;
})();
