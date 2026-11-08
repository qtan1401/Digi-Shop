// ===== CHECKOUT-VOUCHERS.JS =====
// Khối Voucher trong cột tóm tắt của trang thanh toán (thanhtoan-voucher A): ô nhập mã, chip đã áp dụng,
// danh sách voucher (đã chọn trước, khoá sau cùng kèm lý do, gập sau 3 dòng), bảng giá và trạng thái bị chặn lúc trả tiền.
// Mọi con số lấy từ POST /api/vouchers/quote (cùng hàm tính với lúc tạo đơn); mã đã chọn chỉ lưu trong sessionStorage.
// Điểm thưởng đi cùng báo giá: `pointsToUse` được gửi kèm, máy chủ trả `points` (số dư, số điểm dùng được, giá trị) và tổng đã trừ điểm;
// khối nhập điểm nằm ở checkout-points.js, dùng setPoints/subscribe bên dưới.
// Cần: ui-icons.js, vat.js, auth.js (DigiAuth). payment.js nối các hook ở cuối tệp này.

(function () {
    "use strict";
    const STORAGE_KEY = "digi_checkout_vouchers_v1";
    const MAX_VOUCHERS = 3;
    const VISIBLE_ROWS = 3;
    const icon = (name, cls) => window.UiIcons.icon(name, cls);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const vnd = (value) => Number(value || 0).toLocaleString("vi-VN") + "₫";
    const neg = (value) => "−" + vnd(value);

    let hooks = null; // { getItems, getLocalTotals, getPaymentMethod, isEnabled, isGuest, getEmail, onChange, goLogin }
    const listeners = new Set();
    const state = {
        codes: [],
        quote: null,
        status: "idle",      // idle | loading | ready | error
        stale: false,         // đang chờ báo giá mới sau khi đổi giỏ/mã
        error: "",
        typedError: "",
        notice: "",
        blockedCode: "",
        blockedMessage: "",
        meta: new Map(),      // code -> thông tin từ danh sách liệt kê (trần giảm)
        expanded: false,
        points: 0            // số điểm khách muốn dùng (máy chủ có thể giảm xuống)
    };
    let seq = 0;
    let debounceTimer = null;

    // ---------- lưu trữ ----------
    const readStored = () => {
        try {
            const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]");
            // Only 5-character codes exist now: a code saved by an older version of the page would only be rejected.
            return Array.isArray(value) ? value.filter((code) => typeof code === "string" && /^[A-Z0-9]{5}$/.test(code)).slice(0, MAX_VOUCHERS) : [];
        } catch (_) { return []; }
    };
    const persist = () => { try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.codes)); } catch (_) { /* storage có thể bị tắt */ } };
    const clearStored = () => { state.codes = []; state.points = 0; try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* no-op */ } };

    const apiError = (error) => {
        const detail = error?.payload?.error || {};
        return { status: error?.status || 0, code: detail.code || error?.code || "", message: detail.message || "", details: Array.isArray(detail.details) ? detail.details : [], data: error?.payload?.data };
    };

    const el = (id) => document.getElementById(id);
    const announce = (text) => { const live = el("vc-live"); if (live) { live.textContent = ""; live.textContent = text; } };
    const quoteCodes = () => state.codes.filter((code) => code !== state.blockedCode);
    const enabled = () => Boolean(hooks?.isEnabled());
    const isGuest = () => Boolean(hooks?.isGuest?.());

    // ---------- gọi báo giá ----------
    const requestQuote = async (codes) => {
        const items = hooks.getItems();
        try {
            // Khách chưa đăng nhập báo giá qua /api/guest/vouchers/quote (cần email, không có điểm); khách đã đăng nhập như cũ.
            const guest = isGuest();
            const body = guest ? { items, codes, email: hooks.getEmail?.() || "" }
                : state.points > 0 ? { items, codes, pointsToUse: state.points } : { items, codes };
            const payload = await window.DigiAuth.api(guest ? "/api/guest/vouchers/quote" : "/api/vouchers/quote", { method: "POST", body });
            return { data: payload.data, rejected: [] };
        } catch (error) {
            const e = apiError(error);
            if (e.code === "VOUCHER_REJECTED" && e.data) return { data: e.data, rejected: e.details };
            throw e;
        }
    };

    // Báo giá với `codes` (đã gồm mã vừa thêm nếu có). `typed` là mã gõ tay/chọn vừa thêm, để báo lỗi đúng chỗ.
    const refresh = async ({ codes = quoteCodes(), typed = "", silent = false } = {}) => {
        if (!enabled()) return;
        const mine = ++seq;
        clearTimeout(debounceTimer);
        if (!hooks.getItems().length) { state.status = "ready"; state.quote = null; state.stale = false; renderAll(); return; }
        state.stale = true;
        if (!state.quote) state.status = "loading";
        renderAll();
        try {
            const { data, rejected } = await requestQuote(codes);
            if (mine !== seq) return;
            (data.listed || []).forEach((voucher) => state.meta.set(voucher.code, voucher));
            const typedRejection = typed ? rejected.find((entry) => entry.code === typed) : null;
            const dropped = rejected.filter((entry) => entry !== typedRejection);
            const keepBlocked = state.blockedCode && state.codes.includes(state.blockedCode) ? [state.blockedCode] : [];
            state.quote = data;
            if (data.points && state.points > 0) state.points = data.points.used; // đã bị giảm theo số dư / số tiền còn phải trả
            state.codes = [...data.applied.map((voucher) => voucher.code), ...keepBlocked];
            state.status = "ready";
            state.stale = false;
            state.error = "";
            if (typedRejection) state.typedError = typedRejection.reason;
            else if (typed) state.typedError = "";
            if (dropped.length && !silent) state.notice = `${dropped.map((entry) => entry.reason).join(" ")} Voucher này đã được bỏ khỏi đơn.`;
            else if (!dropped.length) state.notice = "";
            persist();
            if (typed && !typedRejection) {
                const line = data.applied.find((voucher) => voucher.code === typed);
                announce(line ? `Đã áp dụng voucher ${typed}, giảm ${vnd(line.amount)}.` : `Đã áp dụng voucher ${typed}.`);
            }
        } catch (e) {
            if (mine !== seq) return;
            state.status = "error";
            state.quote = null;
            state.stale = false;
            state.error = e.code === "CART_UNAVAILABLE" ? (e.message || "Không có sản phẩm nào còn hàng để áp dụng voucher.") : "";
            if (typed) state.typedError = "Không kiểm tra được mã lúc này. Hãy thử lại.";
            if (typed) state.codes = state.codes.filter((code) => code !== typed);
            persist();
        }
        renderAll();
        hooks.onChange?.();
        notify();
    };

    const notify = () => listeners.forEach((listener) => listener());

    const scheduleRefresh = () => {
        if (!enabled()) return;
        // A quote already in flight was priced for the old cart / points: drop its answer instead of letting it overwrite
        // what the customer has just changed (it would reset the points box to the old amount).
        seq += 1;
        state.stale = true;
        renderBreakdown();
        hooks.onChange?.();
        notify();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => refresh({ silent: true }), 150);
    };

    // ---------- thao tác ----------
    const addCode = (raw, fromList = false) => {
        const code = String(raw || "").trim().toUpperCase();
        if (!code) { state.typedError = "Nhập mã voucher trước khi áp dụng."; renderForm(); el("vc-input")?.focus(); return; }
        if (!/^[A-Z0-9]{5}$/.test(code)) { state.typedError = "Mã voucher gồm đúng 5 chữ cái hoặc số."; renderForm(); el("vc-input")?.focus(); return; }
        if (state.codes.includes(code)) { state.typedError = `Mã “${code}” đã được áp dụng cho đơn này.`; renderForm(); el("vc-input")?.focus(); return; }
        state.typedError = "";
        // Mã chọn từ danh sách đã được máy chủ cho phép nên hiện ngay; mã gõ tay chỉ hiện sau khi báo giá chấp nhận.
        if (fromList) state.codes = [...state.codes, code];
        refresh({ codes: [...quoteCodes().filter((c) => c !== code), code], typed: code }).then(() => {
            const input = el("vc-input");
            if (!fromList && !state.typedError && input && input.value.trim().toUpperCase() === code) input.value = "";
            focusKey(fromList ? `row:${code}` : "input");
        });
    };

    const removeCode = (code) => {
        state.codes = state.codes.filter((c) => c !== code);
        if (state.blockedCode === code) { state.blockedCode = ""; state.blockedMessage = ""; }
        state.typedError = "";
        persist();
        announce(`Đã bỏ voucher ${code}.`);
        refresh({ codes: quoteCodes() }).then(() => focusKey("input"));
    };

    const focusKey = (key) => {
        if (key === "input") { el("vc-input")?.focus(); return; }
        const [kind, code] = key.split(":");
        const selector = kind === "row" ? `[data-vc-code="${code}"]` : `[data-vc-remove="${code}"]`;
        (document.querySelector(`#voucher-block ${selector}`) || el("vc-input"))?.focus();
    };

    const setBlocked = (message) => {
        const text = String(message || "");
        const named = state.codes.find((code) => new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`, "i").test(text));
        state.blockedCode = named || "";
        state.blockedMessage = text;
        renderAll();
        refresh({ codes: quoteCodes(), silent: false });
        el("voucher-banner")?.focus();
    };

    // ---------- hiển thị ----------
    const blockHtml = () => `
        <div class="vc-head"><h2 class="vc-title">Voucher</h2><p class="vc-limit">Chọn tối đa ${MAX_VOUCHERS} voucher, trong đó 1 voucher miễn phí vận chuyển.</p></div>
        <div id="vc-form-box"></div>
        <p class="vc-notice" id="vc-notice" role="status" hidden></p>
        <div id="vc-chips"></div>
        <div class="vc-list" id="vc-list" role="group" aria-label="Voucher áp dụng cho đơn này"></div>
        <p class="sr-only" id="vc-live" role="status" aria-live="polite"></p>`;

    // Dựng form một lần; các lần sau chỉ cập nhật thuộc tính để ô nhập không mất tiêu điểm khi báo giá chạy lại.
    const renderForm = () => {
        const box = el("vc-form-box");
        if (!box) return;
        if (!el("vc-form")) {
            box.innerHTML = `<form class="vc-form" id="vc-form" novalidate>
                <div class="vc-form__field"><label for="vc-input" class="sr-only">Nhập mã voucher</label>
                <input id="vc-input" class="checkout-input vc-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" placeholder="Nhập mã gồm 5 ký tự"></div>
                <button type="submit" class="btn btn--secondary vc-apply">Áp dụng</button>
            </form><div id="vc-error-slot"></div>`;
        }
        const input = el("vc-input");
        const loading = state.status === "loading";
        const hasError = Boolean(state.typedError);
        input.disabled = loading;
        input.classList.toggle("checkout-input--error", hasError);
        if (hasError) { input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", "vc-input-error"); }
        else { input.removeAttribute("aria-invalid"); input.removeAttribute("aria-describedby"); }
        box.querySelector(".vc-apply").disabled = loading || state.stale;
        el("vc-error-slot").innerHTML = hasError ? `<p class="vc-error" id="vc-input-error" role="alert">${icon("circle-alert")}<span>${escapeHtml(state.typedError)}</span></p>` : "";
    };

    const chipsHtml = () => {
        if (!state.codes.length) return "";
        const amounts = new Map((state.quote?.applied || []).map((voucher) => [voucher.code, voucher.amount]));
        return `<ul class="vc-chips" aria-label="Voucher đã áp dụng">${state.codes.map((code) => {
            const bad = code === state.blockedCode;
            const amount = amounts.get(code);
            return `<li class="vc-chip${bad ? " is-bad" : ""}">${icon(bad ? "circle-alert" : "ticket")}<span class="vc-chip__code">${escapeHtml(code)}</span>${bad ? '<span class="vc-chip__note">hết hiệu lực</span>' : amount !== undefined ? `<span class="vc-chip__amount">${neg(amount)}</span>` : ""}<button type="button" class="vc-chip__remove" data-vc-remove="${escapeHtml(code)}" aria-label="Bỏ voucher ${escapeHtml(code)}">${icon("x")}</button></li>`;
        }).join("")}</ul>`;
    };

    // Voucher bị giảm bớt vì trần tổng giảm của đơn (1.000.000₫ hoặc tổng tiền tối thiểu 1.000₫): máy chủ trừ từ voucher cuối trở về trước.
    const reducedCodes = (quote) => {
        const result = new Set();
        if (!quote || !quote.applied.length) return result;
        const cap = Math.min(1000000, quote.subtotal + quote.shippingFee - 1000);
        if (quote.discount < cap) return result;
        for (let i = quote.applied.length - 1; i >= 0; i--) {
            const voucher = quote.applied[i];
            const own = state.meta.get(voucher.code);
            const ownMax = voucher.type === "FREE_SHIPPING" ? quote.shippingFee : Math.min(Math.floor(quote.subtotal * (voucher.percent || 0) / 100), own?.maxDiscount ?? 500000, quote.subtotal);
            if (voucher.amount >= ownMax) break;
            result.add(voucher.code);
            if (voucher.amount > 0) break;
        }
        return result;
    };

    // Dòng voucher: đã chọn (theo thứ tự chọn) → chọn được → bị khoá (kèm lý do) sau cùng.
    const buildRows = () => {
        const quote = state.quote;
        const appliedMap = new Map((quote?.applied || []).map((voucher) => [voucher.code, voucher]));
        const cutCodes = reducedCodes(quote);
        const rows = [];
        for (const code of state.codes) {
            const applied = appliedMap.get(code);
            const meta = state.meta.get(code);
            const bad = code === state.blockedCode;
            let amount = applied ? applied.amount : null;
            const cut = Boolean(applied) && cutCodes.has(code);
            rows.push({ code, selected: true, locked: false, bad, amount, cut, description: applied?.description || meta?.description || "", reason: "" });
        }
        const listed = (quote?.listed || []).filter((voucher) => !state.codes.includes(voucher.code));
        const pick = (voucher) => ({ code: voucher.code, selected: false, locked: !voucher.selectable, bad: false, amount: voucher.selectable ? voucher.estimatedDiscount : null, cut: false, description: voucher.description, reason: voucher.selectable ? "" : voucher.reason || "" });
        listed.filter((voucher) => voucher.selectable).forEach((voucher) => rows.push(pick(voucher)));
        listed.filter((voucher) => !voucher.selectable).forEach((voucher) => rows.push(pick(voucher)));
        return rows;
    };

    const rowHtml = (row) => {
        const note = (cls, iconName, text) => `<span class="vc-row__note ${cls}">${icon(iconName)}<span>${escapeHtml(text)}</span></span>`;
        const disabled = row.locked || state.stale || (!row.selected && state.codes.length >= MAX_VOUCHERS);
        const amountText = row.amount === null || row.amount === undefined ? "" : row.amount > 0 ? neg(row.amount) : "—";
        return `<label class="vc-row${row.selected ? " is-selected" : ""}${row.locked ? " is-locked" : ""}${row.bad ? " is-bad" : ""}">
            <input type="checkbox" class="vc-row__check" data-vc-code="${escapeHtml(row.code)}" aria-describedby="vc-d-${escapeHtml(row.code)}" ${row.selected ? "checked" : ""} ${disabled && !row.selected ? "disabled" : ""} ${state.stale && row.selected ? "disabled" : ""}>
            <span class="vc-row__body" id="vc-d-${escapeHtml(row.code)}">
                <span class="vc-row__top"><span class="vc-row__code">${escapeHtml(row.code)}</span></span>
                ${row.description ? `<span class="vc-row__desc" title="${escapeHtml(row.description)}">${escapeHtml(row.description)}</span>` : ""}
                ${row.reason ? note("", "info", row.reason) : ""}
                ${row.cut ? note("is-warn", "info", "Đã giảm bớt vì tổng giảm tối đa 1.000.000₫") : ""}
                ${row.bad ? note("is-bad", "circle-alert", "Không còn dùng được") : ""}
            </span>
            ${amountText ? `<span class="vc-row__amount${row.bad ? " is-struck" : ""}">${amountText}<small>cho đơn này</small></span>` : ""}
        </label>`;
    };

    const skeletonRow = () => '<div class="vc-row vc-row--skeleton"><span class="skeleton vc-sk vc-sk--box"></span><span class="vc-row__body"><span class="skeleton vc-sk" style="width:33%"></span><span class="skeleton vc-sk" style="width:80%"></span><span class="skeleton vc-sk" style="width:25%"></span></span><span class="skeleton vc-sk" style="width:72px;height:16px"></span></div>';

    const renderList = () => {
        const box = el("vc-list");
        if (!box) return;
        if (state.status === "loading") {
            box.setAttribute("aria-busy", "true");
            box.innerHTML = `${skeletonRow()}${skeletonRow()}${skeletonRow()}<span class="sr-only" role="status">Đang tải danh sách voucher</span>`;
            return;
        }
        box.removeAttribute("aria-busy");
        if (state.status === "error") {
            const title = state.error ? "Chưa áp dụng được voucher" : "Không tải được danh sách voucher";
            const sub = state.error || "Bạn vẫn nhập mã ở ô phía trên được.";
            box.innerHTML = `<div class="vc-empty" role="alert"><p class="vc-empty__title vc-empty__title--error">${escapeHtml(title)}</p><p>${escapeHtml(sub)}</p><button type="button" class="btn btn--secondary" data-vc-retry>${icon("rotate-cw")}Thử lại</button></div>`;
            return;
        }
        const rows = buildRows();
        if (!rows.length) {
            box.innerHTML = `<div class="vc-empty vc-empty--dashed">${icon("ticket", "vc-empty__icon")}<p class="vc-empty__title">Chưa có voucher nào áp dụng cho đơn này</p><p>Có mã riêng thì nhập ở ô phía trên.</p></div>`;
            return;
        }
        const head = rows.slice(0, VISIBLE_ROWS).map(rowHtml).join("");
        const rest = rows.slice(VISIBLE_ROWS);
        box.innerHTML = `${head}${rest.length ? `<details class="vc-more" data-vc-more ${state.expanded ? "open" : ""}><summary>Xem thêm ${rest.length} voucher${icon("chevron-down")}</summary><div class="vc-more__rows">${rest.map(rowHtml).join("")}</div></details>` : ""}`;
    };

    const renderNotice = () => {
        const node = el("vc-notice");
        if (!node) return;
        node.hidden = !state.notice;
        node.textContent = state.notice;
    };

    const renderBanner = () => {
        const node = el("voucher-banner");
        if (!node) return;
        if (!state.blockedMessage) { node.hidden = true; node.innerHTML = ""; return; }
        const code = state.blockedCode;
        node.hidden = false;
        node.innerHTML = `${icon("circle-alert")}<div><p class="vc-banner__title">Chưa thanh toán được: ${escapeHtml(state.blockedMessage.replace(/\.$/, ""))}.</p><p>Đơn của bạn chưa bị trừ tiền. ${code ? "Bỏ voucher này để tiếp tục." : "Kiểm tra lại voucher rồi thử thanh toán lại."}</p>${code ? `<button type="button" class="btn btn--secondary vc-banner__btn" data-vc-remove="${escapeHtml(code)}">Bỏ ${escapeHtml(code)} khỏi đơn</button>` : `<button type="button" class="btn btn--secondary vc-banner__btn" data-vc-dismiss>Đã hiểu</button>`}</div>`;
    };

    const renderGuest = () => {
        const box = el("voucher-block");
        if (!box) return;
        if (isGuest()) {
            // Khách vãng lai dùng được voucher; báo giá cần một email hợp lệ nên chờ khách nhập email.
            box.innerHTML = `<div class="vc-head"><h2 class="vc-title">Voucher</h2></div><div class="vc-guest">${icon("ticket")}<div><p class="vc-guest__title">Nhập email để dùng voucher</p><p>Nhập email hợp lệ ở phần Thông tin giao hàng, danh sách voucher sẽ hiện ra ngay.</p></div></div>`;
            return;
        }
        box.innerHTML = `<div class="vc-head"><h2 class="vc-title">Voucher</h2></div><div class="vc-guest">${icon("ticket")}<div><p class="vc-guest__title">Đăng nhập để dùng voucher</p><p>Voucher áp dụng cho tài khoản khách hàng. Thông tin đơn hàng bạn đã nhập được giữ lại.</p><button type="button" class="btn btn--secondary" data-vc-login>Đăng nhập</button></div></div>`;
    };

    const breakdownRow = (label, value, cls = "") => `<div class="vc-sum__row${cls ? " " + cls : ""}"><dt>${label}</dt><dd>${value}</dd></div>`;
    const renderBreakdown = () => {
        const box = el("summary-breakdown");
        if (!box) return;
        const local = hooks.getLocalTotals();
        const quote = enabled() ? state.quote : null;
        const subtotal = quote ? quote.subtotal : local.subtotal;
        const shipping = quote ? quote.shippingFee : local.shipping;
        const loading = enabled() && (state.status === "loading" || state.stale);
        const appliedMap = new Map((quote?.applied || []).map((voucher) => [voucher.code, voucher]));
        let vouchers = "";
        if (enabled()) {
            if (loading && !state.codes.length && state.status === "loading") vouchers = breakdownRow("Voucher", '<span class="skeleton vc-sk" style="width:64px;height:12px"></span>');
            else vouchers = state.codes.map((code) => {
                const bad = code === state.blockedCode;
                const row = buildRows().find((entry) => entry.code === code);
                const label = `<span class="vc-sum__code">${icon("ticket")}<span>${escapeHtml(code)}</span></span>`;
                if (bad) return breakdownRow(`<span class="is-struck">${label}</span><span class="vc-sum__sub is-bad">Không còn dùng được</span>`, '<span class="vc-sum__muted">—</span>');
                const applied = appliedMap.get(code);
                if (!applied) return "";
                return breakdownRow(`${label}${row?.cut ? '<span class="vc-sum__sub is-warn">Giảm bớt vì tổng giảm tối đa 1.000.000₫</span>' : ""}`, `<span class="is-success">${neg(applied.amount)}</span>`);
            }).join("");
        }
        const useLocal = !enabled() || state.status === "error" || (state.status === "ready" && !state.quote);
        const total = quote && !state.stale ? quote.totalPrice : (useLocal ? local.subtotal + local.shipping : null);
        const points = quote && !state.stale && quote.points && quote.points.used > 0
            ? breakdownRow(`Điểm thưởng<span class="vc-sum__sub">${quote.points.used.toLocaleString("vi-VN")} điểm</span>`, `<span class="is-success">${neg(quote.points.discount)}</span>`)
            : "";
        box.innerHTML = `${breakdownRow("Tạm tính", `<span id="summary-subtotal">${vnd(subtotal)}</span>`)}${breakdownRow(`<span class="vc-sum__muted">${window.DigiVat.label}</span>`, `<span class="vc-sum__muted" id="summary-vat">${vnd(window.DigiVat.includedVat(subtotal))}</span>`)}${breakdownRow("Phí vận chuyển", `<span id="summary-shipping">${vnd(shipping)}</span>`)}${vouchers}${points}${breakdownRow("Tổng cộng", total === null ? '<span class="skeleton vc-sk vc-sk--total" id="summary-total" aria-busy="true"></span>' : `<span id="summary-total">${vnd(total)}</span>`, "vc-sum__total")}`;
    };

    const renderAll = () => {
        if (!el("voucher-block")) return;
        renderForm();
        renderNotice();
        el("vc-chips").innerHTML = state.status === "loading" ? "" : chipsHtml();
        renderList();
        renderBanner();
        renderBreakdown();
    };

    // Trạng thái cho nút thanh toán: `total` chỉ lấy từ máy chủ khi đã có báo giá mới nhất.
    const payState = () => {
        if (!enabled()) return { ready: true, total: null, reason: "" };
        if (state.points > 0 && state.status === "error") return { ready: false, total: null, reason: "error" };
        if (state.blockedMessage && state.blockedCode) return { ready: false, total: null, reason: "blocked" };
        if (state.status === "loading" || state.stale) return { ready: false, total: null, reason: "loading" };
        if (state.status === "error") return state.codes.length ? { ready: false, total: null, reason: "error" } : { ready: true, total: null, reason: "" };
        // Điểm bù hết tổng tiền thì MoMo/VNPay không tạo được giao dịch (số tiền tối thiểu 1₫): chỉ COD / chuyển khoản.
        const online = ["MOMO", "VNPAY"].includes(hooks.getPaymentMethod?.());
        if (online && state.quote && state.quote.totalPrice < 1) return { ready: false, total: null, reason: "zero-online" };
        return { ready: true, total: state.quote ? state.quote.totalPrice : null, reason: "" };
    };

    // Số điểm gửi kèm đơn: đúng số điểm báo giá mới nhất đã tính (không có thì không gửi, đơn như cũ).
    const pointsToSend = () => (enabled() && !isGuest() && state.quote && state.quote.points ? state.quote.points.used : 0);
    const setPoints = (value) => {
        if (isGuest()) return; // điểm thuộc về tài khoản; khách vãng lai không dùng điểm
        const next = Math.max(0, Math.trunc(Number(value) || 0));
        if (next === state.points) return;
        state.points = next;
        scheduleRefresh();
    };

    // ---------- sự kiện ----------
    const bind = (root) => {
        if (root.dataset.vcBound) return;
        root.dataset.vcBound = "1";
        root.addEventListener("submit", (event) => {
            if (!event.target.matches("#vc-form")) return;
            event.preventDefault();
            addCode(el("vc-input").value);
        });
        root.addEventListener("input", (event) => {
            if (!event.target.matches("#vc-input")) return;
            const start = event.target.selectionStart;
            event.target.value = event.target.value.toUpperCase();
            event.target.setSelectionRange(start, start);
            if (state.typedError) { state.typedError = ""; el("vc-input").classList.remove("checkout-input--error"); el("vc-input").removeAttribute("aria-invalid"); el("vc-input").removeAttribute("aria-describedby"); el("vc-input-error")?.remove(); }
        });
        root.addEventListener("change", (event) => {
            const check = event.target.closest("[data-vc-code]");
            if (!check) return;
            const code = check.dataset.vcCode;
            if (check.checked) addCode(code, true); else removeCode(code);
        });
        root.addEventListener("click", (event) => {
            const remove = event.target.closest("[data-vc-remove]");
            if (remove) { removeCode(remove.dataset.vcRemove); return; }
            if (event.target.closest("[data-vc-retry]")) { refresh({ codes: quoteCodes() }); return; }
            if (event.target.closest("[data-vc-dismiss]")) { state.blockedMessage = ""; renderBanner(); hooks.onChange?.(); return; }
            if (event.target.closest("[data-vc-login]")) hooks.goLogin?.();
        });
        root.addEventListener("toggle", (event) => { if (event.target.matches("[data-vc-more]")) state.expanded = event.target.open; }, true);
    };

    let started = false;
    const mount = (options) => {
        hooks = options;
        started = false;
        const block = el("voucher-block");
        if (!block) return;
        if (!enabled()) { renderGuest(); bind(block); renderBreakdown(); return; }
        start(block);
    };

    // Khách vãng lai nhập email hợp lệ lần đầu: dựng khối voucher đầy đủ rồi báo giá.
    const activate = () => {
        const block = el("voucher-block");
        if (!hooks || started || !block || !enabled()) return;
        start(block);
    };

    const start = (block) => {
        started = true;
        state.codes = readStored();
        block.innerHTML = blockHtml();
        bind(block);
        el("voucher-banner")?.addEventListener("click", (event) => {
            const remove = event.target.closest("[data-vc-remove]");
            if (remove) removeCode(remove.dataset.vcRemove);
            if (event.target.closest("[data-vc-dismiss]")) { state.blockedMessage = ""; renderBanner(); hooks.onChange?.(); }
        });
        state.status = "loading";
        renderAll();
        refresh({ codes: quoteCodes(), silent: false }).then(async () => {
            // Mã đã chọn từ phiên trước không nằm trong `listed` của báo giá đầu: lấy trần giảm bằng một báo giá không mã.
            if (state.status !== "ready" || !state.codes.some((code) => !state.meta.has(code))) return;
            try {
                const { data } = await requestQuote([]);
                (data.listed || []).forEach((voucher) => state.meta.set(voucher.code, voucher));
                renderAll();
            } catch (_) { /* chỉ thiếu trần giảm */ }
        });
    };

    window.CheckoutVouchers = Object.freeze({
        mount,
        activate,
        refresh: scheduleRefresh,
        getCodes: () => (enabled() ? [...state.codes] : []),
        getPointsToSend: pointsToSend,
        isEnabled: enabled,
        isGuest,
        getQuote: () => (enabled() && !state.stale ? state.quote : null),
        isStale: () => state.stale || state.status === "loading",
        setPoints,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        payState,
        setBlocked,
        clearStored,
        renderBreakdown: () => { if (hooks) renderBreakdown(); },
        reload: () => refresh({ codes: quoteCodes() })
    });
})();
