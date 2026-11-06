/* NodeShop admin: bộ mảnh dùng chung cho các màn dựng bằng class `.ao-*` (Đơn hàng, Voucher, Đánh giá).
 * Nạp sau admin.js, trước admin-orders.js / admin-vouchers.js / admin-reviews.js.
 * window.AdminKit = { esc, vnd, ic, bar, badge, pagerHtml, createSelect, closeOpenSelect, lockScroll, trapTab }
 * Style nằm ở admin-orders.css (gốc `.ao`). Màn dùng kit phải đặt trong một phần tử có class `ao`.
 */
(() => {
    "use strict";

    // ---------- icon (Lucide, nhúng sẵn vì dự án không nạp thư viện icon) ----------
    const ICONS = {
        "circle": '<circle cx="12" cy="12" r="10"/>',
        "circle-check": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
        "circle-x": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
        "circle-dot": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
        "circle-ellipsis": '<circle cx="12" cy="12" r="10"/><path d="M17 12h.01"/><path d="M12 12h.01"/><path d="M7 12h.01"/>',
        "circle-arrow-right": '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="m12 16 4-4-4-4"/>',
        "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
        "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        "chevron-down": '<path d="m6 9 6 6 6-6"/>',
        "chevron-left": '<path d="m15 18-6-6 6-6"/>',
        "chevron-right": '<path d="m9 18 6-6-6-6"/>',
        "check": '<path d="M20 6 9 17l-5-5"/>',
        "copy": '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
        "x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        "package-x": '<path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/><path d="m17 13 5 5m-5 0 5-5"/>',
        "arrow-down-wide-narrow": '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>',
        "rotate-cw": '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
        "calendar-clock": '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
        "calendar-x": '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m14 14-4 4"/><path d="m10 14 4 4"/>',
        "ban": '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
        "eye": '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
        "eye-off": '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
        "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        "truck": '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
        "ticket-percent": '<path d="M2 9a3 3 0 1 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M9 9h.01"/><path d="m15 9-6 6"/><path d="M15 15h.01"/>',
        "star": '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
        "trash-2": '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    };
    const ic = (name, cls = "ao-i4") => `<svg class="ao-i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

    // ---------- tiện ích ----------
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const vnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")}₫`;
    const bar = (w, h, extra = "") => `<div class="ao-sk ${extra}" style="width:${w};height:${h}"></div>`;
    const badge = (tone, label, icon) => `<span class="ao-badge ao-tone-${tone}">${ic(icon, "ao-i3")}${label}</span>`;

    // Phân trang: dưới sm chỉ "trang / tổng"; từ sm hiện số trang khi ≤ 5 trang.
    const pagerHtml = (page, pages) => {
        const arrow = (dir, dis) => `<button type="button" class="ao-pg-arrow" data-page="${dir === "left" ? page - 1 : page + 1}" aria-label="Trang ${dir === "left" ? "trước" : "sau"}" ${dis ? "disabled" : ""}>${ic(`chevron-${dir}`, "ao-i4")}</button>`;
        const nums = pages <= 5
            ? Array.from({ length: pages }, (_, k) => k + 1).map((n) => `<button type="button" data-page="${n}" ${n === page ? 'aria-current="page"' : ""} class="ao-pg-num ao-sm-only ${n === page ? "is-on" : ""}">${n}</button>`).join("")
            : "";
        const compact = `<span class="ao-pg-of ${pages <= 5 ? "ao-sm-hide" : ""}">${page} / ${pages}</span>`;
        return `<nav aria-label="Phân trang" class="ao-pager">${arrow("left", page === 1)}${compact}${nums}${arrow("right", page === pages)}</nav>`;
    };

    // ---------- khoá cuộn nền khi có lớp nổi toàn màn ----------
    let locks = 0;
    const lockScroll = (on) => {
        locks = Math.max(0, locks + (on ? 1 : -1));
        document.documentElement.style.overflow = locks > 0 ? "hidden" : "";
    };

    // Giữ Tab trong một lớp nổi (dialog)
    const trapTab = (event, container) => {
        if (event.key !== "Tab") return;
        const items = [...container.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
            .filter((node) => node.offsetParent !== null || node === document.activeElement);
        if (!items.length) { event.preventDefault(); return; }
        const i = items.indexOf(document.activeElement);
        if (event.shiftKey && i <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
        else if (!event.shiftKey && (i === items.length - 1 || i < 0)) { event.preventDefault(); items[0].focus(); }
    };

    // ---------- select tự vẽ (choice-controls.md + overlay.md) ----------
    let openSelect = null;
    const closeOpenSelect = (focus = false, except = null) => {
        if (!openSelect || (except && openSelect.el.contains(except))) return false;
        openSelect.close(focus);
        return true;
    };
    const createSelect = ({ label, size = "lg", up = false, edge = "left", wrap = "", scroll = false, getGroups, getValueHtml, onSelect }) => {
        const uid = `ao-sel-${Math.random().toString(36).slice(2, 8)}`;
        const wrapEl = document.createElement("div");
        wrapEl.className = `ao-sel ${wrap}`;
        let value = null;
        const api = {
            el: wrapEl,
            setValue(v) { value = v; api.refresh(); },
            getValue: () => value,
            refresh() {
                trigger.querySelector(".ao-sel-value").innerHTML = getValueHtml(value);
                pop.innerHTML = getGroups(value).map((g) => `<div class="ao-pop-group">${g.map((o) => `<button type="button" role="option" tabindex="-1" data-value="${esc(o.value)}" aria-selected="${o.value === value}" class="ao-opt">
                    <span class="ao-opt-text">${o.html}</span>${o.hint !== undefined && o.hint !== "" ? `<span class="ao-opt-hint">${o.hint}</span>` : ""}${o.value === value ? ic("check", "ao-i4 ao-opt-check") : ""}</button>`).join("")}</div>`).join('<hr class="ao-pop-sep">');
            },
            setDisabled(b) { trigger.disabled = b; if (b) api.close(false); },
            close(focus = true) {
                if (trigger.getAttribute("aria-expanded") !== "true") return;
                trigger.setAttribute("aria-expanded", "false");
                pop.removeAttribute("data-open");
                if (openSelect === api) openSelect = null;
                if (focus) trigger.focus();
            },
            open(focusOption = true) {
                if (trigger.disabled) return;
                if (openSelect && openSelect !== api) openSelect.close(false);
                trigger.setAttribute("aria-expanded", "true");
                pop.setAttribute("data-open", "");
                openSelect = api;
                if (focusOption) (pop.querySelector('[aria-selected="true"]') || pop.querySelector(".ao-opt"))?.focus({ preventScroll: true });
            },
            trigger: null,
        };
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.setAttribute("role", "combobox");
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-controls", uid);
        trigger.setAttribute("aria-label", label);
        trigger.className = `ao-sel-trigger ao-sel-${size}`;
        trigger.innerHTML = `<span class="ao-sel-value"></span>${ic("chevron-down", "ao-i4 ao-sel-chev")}`;
        const pop = document.createElement("div");
        pop.id = uid;
        pop.className = `ao-pop ${up ? "ao-pop-up" : ""} ${edge === "right" ? "ao-pop-right" : ""} ${scroll ? "ao-pop-scroll" : ""}`;
        pop.setAttribute("role", "listbox");
        pop.setAttribute("aria-label", label);
        api.trigger = trigger;
        wrapEl.append(trigger, pop);

        trigger.addEventListener("click", () => (trigger.getAttribute("aria-expanded") === "true" ? api.close(false) : api.open(false)));
        trigger.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); api.open(true); }
        });
        pop.addEventListener("click", (e) => {
            const opt = e.target.closest(".ao-opt");
            if (!opt) return;
            const next = opt.dataset.value;
            api.close(true);
            if (next !== value) onSelect(next);
        });
        pop.addEventListener("keydown", (e) => {
            const opts = [...pop.querySelectorAll(".ao-opt")];
            const i = opts.indexOf(document.activeElement);
            if (e.key === "ArrowDown") { e.preventDefault(); opts[(i + 1) % opts.length]?.focus(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length]?.focus(); }
            else if (e.key === "Home") { e.preventDefault(); opts[0]?.focus(); }
            else if (e.key === "End") { e.preventDefault(); opts[opts.length - 1]?.focus(); }
            else if (e.key === "Tab") api.close(false);
        });
        return api;
    };

    // Một select mở tại một thời điểm: bấm ra ngoài thì đóng (đăng ký một lần cho cả trang).
    document.addEventListener("pointerdown", (e) => { closeOpenSelect(false, e.target); });

    window.AdminKit = { esc, vnd, ic, bar, badge, pagerHtml, createSelect, closeOpenSelect, lockScroll, trapTab };
})();
