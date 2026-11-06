/* ===== ADMIN SHELL: khung (sidebar, thanh đầu trang, ☰) + router hash =====
 * Chạy sau admin.js (AdminUI), admin-orders.js (AdminOrders), admin-overview.js (AdminOverview).
 * Router: #/tong-quan (mặc định) · #/san-pham · #/don-hang[/<orderId>] · #/voucher · #/danh-gia · #/tai-khoan
 * Mỗi màn là <section data-view="...">; đổi màn chỉ ẩn/hiện, bắn 'admin:view' trên document.
 */
(() => {
    "use strict";
    const UI = window.AdminUI;
    if (!UI) return;

    const VIEWS = {
        "tong-quan": { title: "Tổng quan" },
        "san-pham": { title: "Sản phẩm" },
        "don-hang": { title: "Đơn hàng" },
        "voucher": { title: "Voucher" },
        "danh-gia": { title: "Đánh giá" },
        "tai-khoan": { title: "Tài khoản" }
    };
    const DEFAULT_VIEW = "tong-quan";
    const SITE = "NodeShop Admin";

    const app = document.getElementById("admin-app");
    const sidebar = document.getElementById("admin-sidebar");
    const heading = document.getElementById("admin-title");
    const menuButton = document.querySelector("[data-menu-open]");
    const sections = Array.from(document.querySelectorAll("[data-view]"));
    const navLinks = Array.from(document.querySelectorAll("[data-nav]"));
    const countBadge = document.querySelector("[data-orders-count]");
    const narrow = window.matchMedia("(max-width: 1023.98px)");

    let current = null;
    let currentParam = null;
    let ordersMounted = false;
    let lastFocus = null;

    /* ---------- Số đếm đơn chờ xử lý trên sidebar ---------- */
    const setPendingCount = (value) => {
        const count = Number(value);
        if (!countBadge) return;
        if (!Number.isFinite(count) || count <= 0) { countBadge.hidden = true; countBadge.textContent = ""; return; }
        countBadge.textContent = count > 99 ? "99+" : String(count);
        countBadge.hidden = false;
    };
    const countPending = (orders) => (Array.isArray(orders) ? orders.filter((order) => order && order.orderStatus === "PENDING").length : 0);

    document.addEventListener("admin:orders-changed", (event) => {
        const orders = event.detail && event.detail.orders;
        if (Array.isArray(orders)) setPendingCount(countPending(orders));
    });

    /* ---------- Panel trượt dưới lg ---------- */
    const isMenuOpen = () => app.classList.contains("is-menu-open");
    const syncInert = () => {
        // Panel đóng ở màn hẹp thì ngoài vòng Tab và ngoài cây trợ năng.
        const hidden = narrow.matches && !isMenuOpen();
        sidebar.inert = hidden;
    };
    const openMenu = () => {
        if (!narrow.matches || isMenuOpen()) return;
        lastFocus = document.activeElement;
        app.classList.add("is-menu-open");
        document.body.classList.add("menu-open");
        menuButton.setAttribute("aria-expanded", "true");
        syncInert();
        const target = sidebar.querySelector("[aria-current=\"page\"]") || sidebar.querySelector("a");
        if (target) target.focus({ preventScroll: true });
    };
    const closeMenu = ({ restoreFocus = true } = {}) => {
        if (!isMenuOpen()) return;
        app.classList.remove("is-menu-open");
        document.body.classList.remove("menu-open");
        menuButton.setAttribute("aria-expanded", "false");
        syncInert();
        if (restoreFocus && lastFocus && typeof lastFocus.focus === "function") lastFocus.focus({ preventScroll: true });
        lastFocus = null;
    };
    narrow.addEventListener("change", () => { closeMenu({ restoreFocus: false }); syncInert(); });

    document.addEventListener("click", (event) => {
        if (event.target.closest("[data-menu-open]")) { openMenu(); return; }
        if (event.target.closest("[data-menu-close]")) { closeMenu(); return; }
        if (isMenuOpen() && event.target.closest("#admin-sidebar a[href]")) closeMenu({ restoreFocus: false });
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !isMenuOpen()) return;
        if (document.querySelector(".modal-backdrop:not([hidden])")) return;
        closeMenu();
    });
    let touchX = null;
    sidebar.addEventListener("touchstart", (event) => { touchX = event.touches[0].clientX; }, { passive: true });
    sidebar.addEventListener("touchend", (event) => {
        if (touchX !== null && event.changedTouches[0].clientX - touchX < -60) closeMenu();
        touchX = null;
    }, { passive: true });

    /* ---------- Màn Đơn hàng (module riêng) ---------- */
    const ordersRoot = document.getElementById("orders-root");
    const showOrdersWait = () => {
        if (ordersRoot.querySelector(".orders-wait")) return;
        ordersRoot.innerHTML = "<div class=\"orders-wait\" role=\"status\" aria-busy=\"true\"><span class=\"sr-only\">Đang tải đơn hàng</span><div class=\"sk\"></div><div class=\"sk\"></div><div class=\"sk\"></div></div>";
    };
    const syncOrders = (param) => {
        const module = window.AdminOrders;
        if (!ordersMounted) {
            if (!module || typeof module.mount !== "function") { showOrdersWait(); return; }
            ordersMounted = true;
            ordersRoot.innerHTML = "";
            try {
                module.mount(ordersRoot, { api: UI.api, toast: UI.toast, initialOrderId: param || undefined });
            } catch (error) {
                console.error("AdminOrders.mount failed", error);
                UI.toast("Không mở được màn Đơn hàng.", "error");
            }
            return;
        }
        if (typeof module.select === "function") module.select(param || null);
    };
    window.addEventListener("load", () => { if (current === "don-hang" && !ordersMounted) syncOrders(currentParam); });

    /* ---------- Màn Voucher và Đánh giá (module riêng, mount một lần khi mở lần đầu) ---------- */
    const MODULES = {
        "voucher": { global: "AdminVouchers", root: "vouchers-root", mounted: false, label: "Voucher" },
        "danh-gia": { global: "AdminReviews", root: "reviews-root", mounted: false, label: "Đánh giá" }
    };
    const syncModule = (key) => {
        const entry = MODULES[key];
        const module = window[entry.global];
        const root = document.getElementById(entry.root);
        if (!module || !root) return;
        if (entry.mounted) {
            if (typeof module.activate === "function") module.activate();
            return;
        }
        entry.mounted = true;
        try {
            module.mount(root, { api: UI.api, toast: UI.toast });
        } catch (error) {
            console.error(`${entry.global}.mount failed`, error);
            UI.toast(`Không mở được màn ${entry.label}.`, "error");
        }
    };

    /* ---------- Router ---------- */
    const parseHash = () => {
        const match = /^#\/([a-z-]+)(?:\/([^?#]+))?/.exec(window.location.hash);
        if (!match || !VIEWS[match[1]]) return { key: null, param: null };
        let param = null;
        if (match[2]) { try { param = decodeURIComponent(match[2]); } catch (_) { param = match[2]; } }
        return { key: match[1], param: match[1] === "don-hang" ? param : null };
    };

    const show = (key, param, { initial = false } = {}) => {
        const changed = key !== current;
        if (!changed && param === currentParam) return;
        const previous = current;
        current = key;
        currentParam = param;
        UI.view = key;

        if (changed) {
            sections.forEach((section) => { section.hidden = section.dataset.view !== key; });
            navLinks.forEach((link) => {
                if (link.dataset.nav === key) link.setAttribute("aria-current", "page");
                else link.removeAttribute("aria-current");
            });
            heading.textContent = VIEWS[key].title;
            document.title = `${VIEWS[key].title} — ${SITE}`;
            closeMenu({ restoreFocus: false });
            window.scrollTo(0, 0);
            if (!initial) heading.focus({ preventScroll: true });
        }

        if (MODULES[key]) syncModule(key);
        if (key === "don-hang") syncOrders(param);
        if (changed) document.dispatchEvent(new CustomEvent("admin:view", { detail: { view: key, param, previous } }));
    };

    const route = ({ initial = false } = {}) => {
        const { key, param } = parseHash();
        if (!key) {
            const url = new URL(window.location.href);
            url.hash = `#/${DEFAULT_VIEW}`;
            window.history.replaceState(window.history.state, "", url);
            show(DEFAULT_VIEW, null, { initial });
            return;
        }
        show(key, param, { initial });
    };

    /* ---------- Khối tài khoản ---------- */
    const fillAccount = (session) => {
        const name = (session && session.user && (session.user.username || session.user.email)) || "admin";
        document.querySelectorAll("[data-admin-avatar]").forEach((element) => UI.paintAvatar(element, name));
        document.querySelectorAll("[data-admin-name]").forEach((element) => { element.textContent = name; element.title = name; });
    };

    const start = (session) => {
        fillAccount(session);
        syncInert();
        app.hidden = false;
        // popstate: back/forward giữa hai mục lịch sử khác query thì trình duyệt không bắn hashchange.
        window.addEventListener("hashchange", () => route());
        window.addEventListener("popstate", () => route());
        route({ initial: true });
        // Số đếm đơn chờ: Tổng quan và Đơn hàng tự cấp qua dữ liệu của chúng; các màn còn lại thì tải một lần.
        if (current !== "tong-quan" && current !== "don-hang") {
            UI.api("/api/orders").then((payload) => setPendingCount(countPending(payload && payload.data))).catch(() => {});
        }
    };

    window.AdminShell = { setPendingCount, countPending, go: (hash) => { window.location.hash = hash; } };
    UI.ready.then(start);
})();
