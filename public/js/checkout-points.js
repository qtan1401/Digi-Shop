// ===== CHECKOUT-POINTS.JS =====
// Khối "Điểm thưởng" trong cột tóm tắt của trang thanh toán: số dư, ô nhập số điểm, "Dùng tối đa" và kết quả trước khi trả tiền.
// 1 điểm = 1.000₫. Mọi con số lấy từ báo giá của CheckoutVouchers (POST /api/vouchers/quote có pointsToUse), cùng hàm tính với lúc tạo đơn.
// Cần: ui-icons.js, checkout-vouchers.js. payment.js gọi CheckoutPoints.mount() sau khi dựng khối #points-block.

(function () {
    "use strict";
    const icon = (name, cls) => window.UiIcons.icon(name, cls);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const num = (value) => Number(value || 0).toLocaleString("vi-VN");
    const vnd = (value) => num(value) + "₫";
    const el = (id) => document.getElementById(id);

    let mounted = false;
    let inputError = "";
    let note = "";

    const vouchers = () => window.CheckoutVouchers;

    const render = () => {
        const box = el("points-block");
        if (!box) return;
        box.innerHTML = `
            <div class="vc-head"><h2 class="vc-title">Điểm thưởng</h2><p class="vc-limit" id="pt-balance" aria-live="polite">Đang tải số dư…</p></div>
            <form class="vc-form" id="pt-form" novalidate>
                <div class="vc-form__field"><label for="pt-input" class="sr-only">Số điểm muốn dùng</label>
                <input id="pt-input" class="checkout-input vc-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Số điểm muốn dùng" disabled></div>
                <button type="button" class="btn btn--secondary vc-apply" id="pt-max" disabled>Dùng tối đa</button>
            </form>
            <div id="pt-error-slot"></div>
            <p class="vc-limit" id="pt-result" aria-live="polite"></p>
            <p class="vc-error" id="pt-warn" role="alert" hidden></p>`;
        box.querySelector("#pt-form").addEventListener("submit", (event) => event.preventDefault());
        el("pt-input").addEventListener("input", onInput);
        el("pt-max").addEventListener("click", onMax);
    };

    const quote = () => vouchers().getQuote();

    const onInput = (event) => {
        const q = quote();
        const raw = event.target.value.trim();
        note = "";
        if (raw === "") { inputError = ""; vouchers().setPoints(0); update(); return; }
        if (!/^\d{1,9}$/.test(raw)) { inputError = "Số điểm phải là số nguyên không âm."; update(); return; }
        inputError = "";
        const balance = q ? q.points.balance : null;
        let wanted = Number(raw);
        if (balance !== null && wanted > balance) {
            wanted = balance;
            event.target.value = String(balance);
            note = `Bạn chỉ có ${num(balance)} điểm.`;
        }
        vouchers().setPoints(wanted);
        update();
    };

    const onMax = () => {
        const q = quote();
        if (!q) return;
        inputError = "";
        note = q.points.maxUsable > 0 && q.points.maxUsable < q.points.balance ? `Chỉ cần ${num(q.points.maxUsable)} điểm để trả đủ đơn này.` : "";
        vouchers().setPoints(q.points.maxUsable);
        el("pt-input").value = String(q.points.maxUsable || "");
        update();
    };

    const update = () => {
        if (!mounted || !el("pt-input")) return;
        const api = vouchers();
        const q = quote();
        const input = el("pt-input");
        const max = el("pt-max");
        const result = el("pt-result");
        const warn = el("pt-warn");
        const loading = !q;
        if (q) {
            const p = q.points;
            el("pt-balance").textContent = p.balance > 0
                ? `Số dư: ${num(p.balance)} điểm (tương đương ${vnd(p.balance * 1000)}). 1 điểm = 1.000₫.`
                : "Bạn chưa có điểm. Mỗi đơn tích lũy 10% giá trị thành điểm (1 điểm = 1.000₫).";
            input.disabled = p.balance <= 0;
            max.disabled = p.balance <= 0 || p.maxUsable <= 0;
            // Máy chủ có thể dùng ít điểm hơn đã nhập (số dư, số tiền còn phải trả): ô nhập luôn khớp với số được áp dụng.
            if (!inputError && String(p.used || "") !== input.value.trim() && /^\d*$/.test(input.value.trim())) {
                if (Number(input.value) > p.used) note = note || `Chỉ dùng được tối đa ${num(p.used)} điểm cho đơn này.`;
                input.value = p.used ? String(p.used) : "";
            }
            result.textContent = p.used > 0
                ? `Dùng ${num(p.used)} điểm: giảm ${vnd(p.discount)}, còn phải trả ${vnd(q.totalPrice)}.${p.earned > 0 ? ` Đơn này tích lũy +${num(p.earned)} điểm.` : ""}`
                : p.earned > 0 ? `Đơn này tích lũy +${num(p.earned)} điểm.` : "";
        } else if (api.isStale()) {
            max.disabled = true;
        }
        const message = inputError || (note && !loading ? note : "");
        input.classList.toggle("checkout-input--error", Boolean(inputError));
        if (inputError) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
        el("pt-error-slot").innerHTML = message
            ? `<p class="${inputError ? "vc-error" : "vc-limit"}" id="pt-input-error" ${inputError ? 'role="alert"' : ""}>${inputError ? icon("circle-alert") : ""}<span>${escapeHtml(message)}</span></p>`
            : "";
        const pay = api.payState();
        warn.hidden = pay.reason !== "zero-online";
        warn.innerHTML = pay.reason === "zero-online"
            ? `${icon("circle-alert")}<span>Điểm đã dùng bù hết tổng thanh toán nên không thể thanh toán qua MoMo/VNPay. Hãy chọn COD hoặc chuyển khoản, hoặc dùng ít điểm hơn.</span>`
            : "";
    };

    const mount = () => {
        if (!el("points-block") || !vouchers() || !vouchers().isEnabled() || vouchers().isGuest()) { const box = el("points-block"); if (box) box.hidden = true; return; }
        mounted = true;
        render();
        vouchers().subscribe(update);
        el("payment-method")?.addEventListener("change", update);
        update();
    };

    window.CheckoutPoints = Object.freeze({ mount, update });
})();
