// ===== PRODUCT-REVIEWS.JS =====
// Khối "Đánh giá của khách" ở trang chi tiết sản phẩm (danhgia-sanpham C):
// điểm gọn + nút viết, danh sách mới nhất trước (5 mỗi trang), hộp thoại viết/sửa (kèm hỏi Username
// lần đầu), xác nhận xoá ngay trên thẻ, ghi chú khi bị quản trị ẩn.
// Khách chưa đăng nhập chỉ viết được bình luận (tên hiển thị + nội dung, không sao), gắn nhãn "Khách".
// Tên và nội dung do người dùng nhập luôn được đặt bằng textContent, không qua innerHTML.
// Cập nhật trực tiếp qua ReviewLive (review-live.js, tải trước file này).
// Cần: catalog-renderer.js, ui-icons.js, auth.js (DigiAuth). showToast từ cart.js.

(function () {
    "use strict";
    const R = window.CatalogRenderer;
    const { escapeHtml, renderStars, formatRating } = R;
    const icon = (name, cls) => window.UiIcons.icon(name, cls);
    const PAGE_SIZE = 5;
    const MAX_COMMENT = 1000;
    const CLAMP_AT = 300;
    const STAR_LABELS = ["", "Rất tệ", "Tệ", "Bình thường", "Tốt", "Rất tốt"];
    const FALLBACK_NAME = "Khách hàng";
    const GUEST_NAME_MIN = 2;
    const GUEST_NAME_MAX = 60;
    const STYLESHEET = "/css/reviews.css";

    const s = {
        productId: 0,
        productName: "",
        page: 1,
        list: { status: "loading", data: [], meta: null, summary: null },
        mine: { status: "loading", kind: "guest", eligible: false, hasUsername: false, review: null },
        confirmDelete: false,
        busy: false,
        expanded: new Set(),
        freshId: 0
    };
    let root = null;
    let dialog = null;
    let dialogState = null; // { mode: "create" | "edit", step: "username" | "form", rating, text, error, busy }
    let returnFocus = null;
    let listSeq = 0;
    let live = null;
    let resyncTimer = null;
    let freshTimer = null;

    const session = () => (window.DigiAuth?.getSession?.() || { authenticated: false });
    const fmtDate = (iso) => new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const displayName = (name) => (!name || name === "Khach hang" ? FALLBACK_NAME : name);
    const initials = (name) => (displayName(name).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?");
    const announce = (text) => { const live = root?.querySelector("[data-rv-live]"); if (live) { live.textContent = ""; live.textContent = text; } };
    const toast = (message, type = "success") => { if (typeof showToast === "function") showToast(message, type); };

    // Lỗi API: DigiAuth.api chỉ giữ thông điệp chung; thông điệp tiếng Việt của máy chủ nằm trong payload.
    const apiError = (error) => {
        const detail = error?.payload?.error || {};
        return {
            status: error?.status || 0,
            code: detail.code || error?.code || "",
            message: detail.message || "",
            errors: Array.isArray(detail.errors) ? detail.errors : []
        };
    };

    // ---------- tải dữ liệu ----------
    const loadList = async (page = s.page, { silent = false } = {}) => {
        const seq = ++listSeq;
        if (!silent) {
            s.page = page;
            s.list.status = "loading";
            renderList();
        }
        try {
            const response = await fetch(`/api/products/${encodeURIComponent(s.productId)}/reviews?page=${page}&pageSize=${PAGE_SIZE}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
            const body = await response.json();
            if (!response.ok || body.success === false) throw new Error("load");
            if (seq !== listSeq) return;
            s.page = body.meta?.page || page;
            s.list = { status: "ready", data: body.data || [], meta: body.meta, summary: body.summary };
        } catch (_) {
            if (seq !== listSeq) return;
            if (silent) return; // làm mới nền thất bại thì giữ nguyên danh sách đang hiện
            s.list.status = "error";
        }
        renderSummary();
        renderList();
        syncHeaderRating();
    };

    const loadMine = async () => {
        const current = session();
        if (!current.authenticated) { s.mine = { status: "ready", kind: "guest", eligible: false, hasUsername: false, review: null }; return renderCta(); }
        if (current.user?.role !== "user") { s.mine = { status: "ready", kind: "admin", eligible: false, hasUsername: false, review: null }; return renderCta(); }
        s.mine.status = "loading";
        renderCta();
        try {
            const payload = await window.DigiAuth.api(`/api/products/${encodeURIComponent(s.productId)}/reviews/mine`);
            const data = payload.data || {};
            s.mine = { status: "ready", kind: "user", eligible: Boolean(data.eligible), hasUsername: Boolean(data.hasUsername), review: data.review || null };
        } catch (_) {
            s.mine = { status: "error", kind: "user", eligible: false, hasUsername: false, review: null };
        }
        renderCta();
        renderOwn();
        renderList();
    };

    const reloadAll = async (page = 1) => { await Promise.all([loadList(page), loadMine()]); };

    // ---------- hiển thị ----------
    const syncHeaderRating = () => {
        const link = document.getElementById("product-rating-link");
        const summary = s.list.summary;
        if (!link || !summary) return;
        if (summary.ratingCount > 0) {
            link.innerHTML = `${renderStars(summary.ratingAverage)}<span>${formatRating(summary.ratingAverage)} · ${summary.ratingCount.toLocaleString("vi-VN")} đánh giá</span>`;
            link.hidden = false;
        } else {
            link.hidden = true;
        }
    };

    const barsHtml = (summary) => `<div class="reviews__bars">${[5, 4, 3, 2, 1].map((star) => {
        const count = Number(summary.distribution?.[star]) || 0;
        const percent = summary.ratingCount ? Math.round(count / summary.ratingCount * 100) : 0;
        return `<div class="reviews__bar"><span class="reviews__bar-label">${star}${R.starIcon()}</span><div class="reviews__bar-track" role="img" aria-label="${star} sao: ${count} đánh giá"><div class="reviews__bar-fill" style="width:${percent}%"></div></div><span class="reviews__bar-count">${count}</span></div>`;
    }).join("")}</div>`;

    const scoreHtml = (summary) => {
        if (!summary.ratingCount) {
            const note = (s.list.meta?.total || 0) > 0 ? "Chưa có lượt chấm sao" : "Chưa có đánh giá";
            return `<div><p class="reviews__score reviews__score--empty">—</p><div class="reviews__score-stars">${renderStars(0, "stars--lg")}</div><p class="reviews__score-note">${note}</p></div>`;
        }
        return `<div><p class="reviews__score">${formatRating(summary.ratingAverage)}<small> / 5</small></p><div class="reviews__score-stars">${renderStars(summary.ratingAverage, "stars--lg")}</div><p class="reviews__score-note">${summary.ratingCount.toLocaleString("vi-VN")} lượt chấm sao</p></div>`;
    };

    const renderSummary = () => {
        const box = root.querySelector("[data-rv-summary]");
        if (s.list.status === "loading" && !s.list.summary) {
            box.innerHTML = `<div class="reviews__summary" aria-busy="true"><div><div class="skeleton" style="width:96px;height:36px;border-radius:8px"></div><div class="skeleton" style="width:112px;height:16px;margin-top:12px"></div><div class="skeleton" style="width:80px;height:12px;margin-top:8px"></div></div><div class="reviews__bars">${[1, 2, 3, 4, 5].map(() => '<div class="skeleton" style="height:8px;width:100%"></div>').join("")}</div></div>`;
            return;
        }
        if (!s.list.summary) { box.innerHTML = '<p class="reviews__hint">Chưa có điểm do lỗi tải.</p>'; return; }
        const summary = s.list.summary;
        box.innerHTML = `<div class="reviews__summary">${scoreHtml(summary)}${summary.ratingCount ? barsHtml(summary) : ""}</div>`;
    };

    const renderCta = () => {
        const box = root.querySelector("[data-rv-cta]");
        const m = s.mine;
        let html;
        if (m.status === "loading") html = '<div class="skeleton" style="width:160px;height:16px" aria-busy="true"></div>';
        else if (m.status === "error") html = `<p class="reviews__hint">${icon("circle-alert")}Không kiểm tra được quyền đánh giá.</p><button type="button" class="btn btn--secondary" data-rv-action="retry-mine">${icon("rotate-cw")}Thử lại</button>`;
        else if (m.kind === "guest") html = `<p class="reviews__hint">Bình luận không cần đăng nhập. Muốn chấm sao thì đăng nhập.</p><div class="reviews__cta-actions"><button type="button" class="btn btn--primary" data-rv-action="write-guest" aria-haspopup="dialog">${icon("pencil")}Viết bình luận</button><a href="${escapeHtml(window.DigiAuth?.loginUrl?.(`/product_info.html?id=${encodeURIComponent(s.productId)}#danh-gia`) || "/auth.html?tab=login")}" class="btn btn--secondary">Đăng nhập để chấm sao</a></div>`;
        else if (m.kind === "admin") html = `<p class="reviews__hint">Tài khoản Admin chỉ xem đánh giá.</p>`;
        else if (m.review) html = `<p class="reviews__hint">Bạn đã đánh giá sản phẩm này, xem ở đầu danh sách.</p>`;
        else if (!m.eligible) html = `<p class="reviews__hint">${icon("package-check")}<span>Đánh giá mở sau khi bạn nhận đơn có ${escapeHtml(s.productName)}.</span></p>`;
        else html = `<button type="button" class="btn btn--primary" data-rv-action="write" aria-haspopup="dialog">${icon("pencil")}Viết đánh giá</button>`;
        box.innerHTML = html;
    };

    // Trả về phần tử DOM: tên, nội dung, ngày do người dùng nhập chỉ được gán bằng textContent / thuộc tính, không nối vào HTML.
    // `below` và `actions` là HTML tin cậy do chính file này dựng.
    const reviewEl = (review, { own = false, below = "", actions = "" } = {}) => {
        const name = own ? (session().user?.username || FALLBACK_NAME) : review.username;
        const guest = !own && review.authorType === "guest";
        const text = review.comment || "";
        const id = Number(review.id);
        const rating = Number(review.rating) || 0;
        const long = text.length > CLAMP_AT || text.split("\n").length > 4;
        const open = s.expanded.has(review.id);
        const article = document.createElement("article");
        article.className = `review${s.freshId === review.id ? " review--new" : ""}`;
        article.dataset.reviewId = String(id);
        if (own) { article.tabIndex = -1; article.setAttribute("data-rv-mine", ""); }
        article.innerHTML = `<span class="review__avatar" aria-hidden="true" data-f="avatar"></span>
            <div class="review__main">
                <div class="review__head"><span class="review__name" data-f="name"></span>${guest ? '<span class="review__guest">Khách</span>' : ""}${own ? '<span class="review__mine">Của bạn</span>' : ""}<time class="review__date" data-f="date"></time></div>
                ${rating ? `<div class="review__stars">${renderStars(rating)}<span class="sr-only">${rating} trên 5 sao</span></div>` : ""}
                ${text ? `<p class="review__text${long && !open ? " review__text--clamp" : ""}" data-f="text"></p>` : ""}
                ${long ? `<button type="button" class="review__more" data-rv-action="toggle-more" data-id="${id}" aria-expanded="${open}">${open ? "Thu gọn" : "Xem thêm"}</button>` : ""}
                ${below}
                ${actions ? `<div class="review__actions">${actions}</div>` : ""}
            </div>`;
        const field = (key) => article.querySelector(`[data-f="${key}"]`);
        field("avatar").textContent = initials(name);
        const nameNode = field("name");
        nameNode.textContent = displayName(name);
        nameNode.title = displayName(name);
        const dateNode = field("date");
        dateNode.dateTime = String(review.createdAt || "");
        dateNode.textContent = fmtDate(review.createdAt);
        if (text) field("text").textContent = text;
        return article;
    };

    const renderOwn = () => {
        const box = root.querySelector("[data-rv-own]");
        const review = s.mine.review;
        if (!review) { box.innerHTML = ""; return; }
        let below = "";
        let actions = `<button type="button" class="review__action" data-rv-action="edit" aria-haspopup="dialog">${icon("pencil")}Sửa</button><button type="button" class="review__action" data-rv-action="delete">${icon("trash-2")}Xoá</button>`;
        if (s.confirmDelete) {
            below = `<div class="review__note review__note--confirm" role="alertdialog" aria-labelledby="rv-del-t" aria-describedby="rv-del-d" tabindex="-1" data-rv-confirm><p id="rv-del-t"><strong>Xoá đánh giá này?</strong></p><p id="rv-del-d">Điểm trung bình sẽ được tính lại. Bạn có thể viết lại sau.</p><div class="review__confirm-actions"><button type="button" class="btn btn--danger" data-rv-action="confirm-delete" ${s.busy ? "disabled" : ""}>${s.busy ? "Đang xoá…" : "Xoá đánh giá"}</button><button type="button" class="btn btn--secondary" data-rv-action="cancel-delete" ${s.busy ? "disabled" : ""}>Giữ lại</button></div></div>`;
            actions = "";
        } else if (review.isHidden) {
            below = `<div class="review__note review__note--warn" role="note">${icon("eye-off")}<p>Quản trị viên đã ẩn đánh giá này. Người khác không thấy và đánh giá không tính vào điểm. Sửa lại nội dung rồi liên hệ cửa hàng nếu bạn cho rằng bị ẩn nhầm.</p></div>`;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "review--own";
        wrapper.appendChild(reviewEl(review, { own: true, below, actions }));
        box.replaceChildren(wrapper);
    };

    const skeletonRow = () => '<div class="review review--skeleton"><div class="skeleton" style="width:36px;height:36px;flex-shrink:0"></div><div style="flex:1;display:flex;flex-direction:column;gap:10px"><div class="skeleton" style="width:25%"></div><div class="skeleton" style="width:96px"></div><div class="skeleton" style="width:100%"></div><div class="skeleton" style="width:66%"></div></div></div>';

    const renderList = () => {
        const box = root.querySelector("[data-rv-list]");
        const pager = root.querySelector("[data-rv-pager]");
        const { status, data, meta } = s.list;
        pager.innerHTML = "";
        if (status === "loading") { box.setAttribute("aria-busy", "true"); box.innerHTML = `${skeletonRow()}${skeletonRow()}${skeletonRow()}<span class="sr-only" role="status">Đang tải đánh giá</span>`; return; }
        box.removeAttribute("aria-busy");
        if (status === "error") { box.innerHTML = `<div class="reviews__error" role="alert"><div><p>Không tải được đánh giá</p><p>Mất kết nối mạng hoặc máy chủ chưa phản hồi.</p></div><button type="button" class="btn btn--secondary" data-rv-action="retry-list">${icon("rotate-cw")}Thử lại</button></div>`; return; }
        const ownId = s.mine.review?.id;
        const rows = data.filter((review) => review.id !== ownId);
        if (!meta?.total && !s.mine.review) { box.innerHTML = `<div class="reviews__empty">${icon("message-square-text")}<p>Chưa có đánh giá nào</p><p>Khách đã nhận hàng đánh giá, ai cũng có thể bình luận.</p></div>`; return; }
        const heading = document.createElement("h3");
        heading.className = "sr-only";
        heading.textContent = "Đánh giá mới nhất";
        box.replaceChildren(heading, ...rows.map((review) => reviewEl(review)));
        if (meta && meta.totalPages > 1) {
            pager.innerHTML = R.renderPagination({ page: meta.page, totalPages: meta.totalPages, total: meta.total, pageSize: meta.pageSize, ariaLabel: "Phân trang đánh giá", noun: "đánh giá", hrefForPage: (n) => `#danh-gia-trang-${n}` });
        }
    };

    // ---------- hộp thoại ----------
    const pickerHtml = (rating) => `<div role="radiogroup" aria-label="Số sao" class="rv-picker">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === rating}" aria-label="${n} sao" tabindex="${(rating ? n === rating : n === 1) ? 0 : -1}" class="rv-star${n <= rating ? " is-on" : ""}" data-rv-star="${n}">${R.starIcon()}</button>`).join("")}${rating ? `<span class="rv-picker__label">${STAR_LABELS[rating]}</span>` : ""}</div>`;

    const counterHtml = (length) => `<p class="rv-form__counter${length >= MAX_COMMENT ? " rv-form__counter--full" : ""}" data-rv-counter>${length.toLocaleString("vi-VN")} / 1.000</p>`;

    const alertHtml = (message) => (message ? `<div class="rv-form__alert" role="alert">${icon("circle-alert")}<span>${escapeHtml(message)}</span></div>` : "");

    const formHtml = (d) => `<form class="rv-form" data-rv-form novalidate>
        <div><p id="rv-stars-l" class="rv-form__label">Số sao <small>(không bắt buộc)</small></p><div aria-labelledby="rv-stars-l" data-rv-picker>${pickerHtml(d.rating)}</div></div>
        <div>
            <label for="rv-text" class="rv-form__label">Nhận xét <small>(không bắt buộc)</small></label>
            <textarea id="rv-text" class="rv-textarea" maxlength="${MAX_COMMENT}" rows="4" placeholder="Sản phẩm dùng thế nào, giao hàng ra sao…" aria-describedby="${d.fieldError ? "rv-text-e" : "rv-text-h"}" ${d.fieldError ? 'aria-invalid="true"' : ""}>${escapeHtml(d.text)}</textarea>
            <div class="rv-form__row">${d.fieldError ? `<p id="rv-text-e" class="rv-form__error" role="alert">${icon("circle-alert")}<span>${escapeHtml(d.fieldError)}</span></p>` : '<p id="rv-text-h" class="rv-form__hint">Cần ít nhất số sao hoặc nhận xét.</p>'}${counterHtml(d.text.length)}</div>
        </div>
        <div data-rv-alert>${alertHtml(d.alert)}</div>
        <div class="rv-form__actions">${d.mode === "edit" ? '<button type="button" class="btn btn--secondary" data-rv-action="close-dialog">Huỷ</button>' : ""}<button type="submit" class="btn btn--primary" ${d.busy ? "disabled" : ""}>${d.busy ? "Đang gửi…" : d.mode === "edit" ? "Lưu thay đổi" : "Gửi đánh giá"}</button></div>
    </form>`;

    const guestFormHtml = (d) => `<form class="rv-form" data-rv-guest novalidate>
        <div class="rv-form__note">${icon("message-square-text")}<p>Bình luận hiện với nhãn “Khách”, không có sao và không sửa hay xoá được sau khi gửi.</p></div>
        <div>
            <label for="rv-guest-name" class="rv-form__label">Tên hiển thị</label>
            <input id="rv-guest-name" class="rv-input" type="text" autocomplete="nickname" spellcheck="false" maxlength="${GUEST_NAME_MAX}" placeholder="Ví dụ: Minh Anh" aria-describedby="${d.nameError ? "rv-guest-name-e" : "rv-guest-name-h"}" ${d.nameError ? 'aria-invalid="true"' : ""}>
            ${d.nameError ? `<p id="rv-guest-name-e" class="rv-form__error" role="alert" style="margin-top:8px">${icon("circle-alert")}<span>${escapeHtml(d.nameError)}</span></p>` : `<p id="rv-guest-name-h" class="rv-form__hint" style="margin-top:8px">${GUEST_NAME_MIN}–${GUEST_NAME_MAX} ký tự: chữ, số, khoảng trắng, dấu chấm, gạch ngang và gạch dưới.</p>`}
        </div>
        <div>
            <label for="rv-text" class="rv-form__label">Bình luận</label>
            <textarea id="rv-text" class="rv-textarea" maxlength="${MAX_COMMENT}" rows="4" placeholder="Bạn nghĩ gì về sản phẩm này?" aria-describedby="${d.fieldError ? "rv-text-e" : "rv-text-h"}" ${d.fieldError ? 'aria-invalid="true"' : ""}></textarea>
            <div class="rv-form__row">${d.fieldError ? `<p id="rv-text-e" class="rv-form__error" role="alert">${icon("circle-alert")}<span>${escapeHtml(d.fieldError)}</span></p>` : '<p id="rv-text-h" class="rv-form__hint">Bắt buộc.</p>'}${counterHtml(d.text.length)}</div>
        </div>
        <div data-rv-alert>${alertHtml(d.alert)}</div>
        <div class="rv-form__actions"><button type="submit" class="btn btn--primary" ${d.busy ? "disabled" : ""}>${d.busy ? "Đang gửi…" : "Gửi bình luận"}</button></div>
    </form>`;

    const usernameHtml = (d) => `<form class="rv-form" data-rv-username novalidate>
        <div>
            <label for="rv-user" class="rv-form__label">Chọn Username trước khi viết đánh giá</label>
            <p class="rv-form__help">Tên này hiện cùng đánh giá của bạn. Chỉ chọn một lần, không đổi được sau này.</p>
            <input id="rv-user" class="rv-input" type="text" autocomplete="off" spellcheck="false" maxlength="30" value="${escapeHtml(d.username || "")}" placeholder="Ví dụ: baotruong" aria-describedby="${d.fieldError ? "rv-user-e" : "rv-user-h"}" ${d.fieldError ? 'aria-invalid="true"' : ""}>
            ${d.fieldError ? `<p id="rv-user-e" class="rv-form__error" role="alert" style="margin-top:8px">${icon("circle-alert")}<span>${escapeHtml(d.fieldError)}</span></p>` : '<p id="rv-user-h" class="rv-form__hint" style="margin-top:8px">3–30 ký tự: chữ, số, dấu chấm, gạch ngang và gạch dưới.</p>'}
        </div>
        <div data-rv-alert>${alertHtml(d.alert)}</div>
        <div class="rv-form__actions"><button type="submit" class="btn btn--primary" ${d.busy ? "disabled" : ""}>${d.busy ? "Đang lưu…" : "Lưu và tiếp tục"}</button></div>
    </form>`;

    const ensureDialog = () => {
        if (dialog) return dialog;
        dialog = document.createElement("div");
        dialog.className = "rv-dialog";
        dialog.hidden = true;
        dialog.innerHTML = `<div class="rv-dialog__backdrop" data-rv-action="close-dialog"></div>
            <div class="rv-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="rv-dialog-title">
                <div class="rv-dialog__head"><h2 class="rv-dialog__title" id="rv-dialog-title"></h2><button type="button" class="icon-btn" aria-label="Đóng" data-rv-action="close-dialog">${icon("x", "icon--20")}</button></div>
                <div class="rv-dialog__body" data-rv-dialog-body></div>
            </div>`;
        document.body.appendChild(dialog);
        dialog.addEventListener("click", onClick);
        dialog.addEventListener("submit", onSubmit);
        dialog.addEventListener("input", onInput);
        dialog.addEventListener("keydown", onDialogKey);
        return dialog;
    };

    const renderDialog = (focusSelector) => {
        const d = dialogState;
        if (!d) return;
        ensureDialog();
        dialog.querySelector("#rv-dialog-title").textContent = d.mode === "guest" ? "Viết bình luận" : d.mode === "edit" ? "Sửa đánh giá của bạn" : "Viết đánh giá";
        dialog.querySelector("[data-rv-dialog-body]").innerHTML = d.mode === "guest" ? guestFormHtml(d) : d.step === "username" ? usernameHtml(d) : formHtml(d);
        if (d.mode === "guest") {
            // Giá trị người dùng đã gõ được đặt lại bằng thuộc tính value, không đưa vào chuỗi HTML.
            dialog.querySelector("#rv-guest-name").value = d.guestName;
            dialog.querySelector("#rv-text").value = d.text;
        }
        if (focusSelector) dialog.querySelector(focusSelector)?.focus();
    };

    const openDialog = (mode) => {
        const review = s.mine.review;
        returnFocus = document.activeElement;
        const needsUsername = mode === "create" && !s.mine.hasUsername;
        dialogState = { mode, step: needsUsername ? "username" : "form", rating: mode === "edit" ? review?.rating || 0 : 0, text: mode === "edit" ? review?.comment || "" : "", username: "", guestName: "", nameError: "", fieldError: "", alert: "", busy: false };
        ensureDialog().hidden = false;
        document.documentElement.classList.add("is-locked");
        renderDialog(needsUsername ? "#rv-user" : mode === "guest" ? "#rv-guest-name" : "#rv-text");
    };

    const closeDialog = () => {
        if (!dialog || dialog.hidden) return;
        dialog.hidden = true;
        dialogState = null;
        document.documentElement.classList.remove("is-locked");
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        else root.querySelector("[data-rv-action='write'], [data-rv-action='write-guest'], [data-rv-action='edit']")?.focus();
    };

    const focusables = () => [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]")].filter((node) => node.offsetParent !== null && node.tabIndex >= 0);

    const onDialogKey = (event) => {
        if (event.key === "Escape") { event.preventDefault(); closeDialog(); return; }
        if (event.key === "Tab") {
            const nodes = focusables();
            if (!nodes.length) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            return;
        }
        const star = event.target.closest?.("[data-rv-star]");
        if (star && dialogState) {
            const keys = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
            if (event.key in keys) {
                event.preventDefault();
                setRating(Math.max(1, Math.min(5, (dialogState.rating || (keys[event.key] > 0 ? 0 : 6)) + keys[event.key])), true);
            }
        }
    };

    const setRating = (value, focus) => {
        dialogState.rating = value;
        dialog.querySelector("[data-rv-picker]").innerHTML = pickerHtml(value);
        if (focus) dialog.querySelector(`[data-rv-star="${value}"]`)?.focus();
    };

    const onInput = (event) => {
        if (!dialogState) return;
        if (event.target.id === "rv-text") {
            dialogState.text = event.target.value;
            const counter = dialog.querySelector("[data-rv-counter]");
            counter.textContent = `${event.target.value.length.toLocaleString("vi-VN")} / 1.000`;
            counter.classList.toggle("rv-form__counter--full", event.target.value.length >= MAX_COMMENT);
        } else if (event.target.id === "rv-user") {
            dialogState.username = event.target.value;
        } else if (event.target.id === "rv-guest-name") {
            dialogState.guestName = event.target.value;
        }
    };

    const submitUsername = async () => {
        const d = dialogState;
        const value = d.username.trim();
        const problem = window.DigiAuth.usernameProblem?.(value);
        if (problem) { d.fieldError = problem; d.alert = ""; return renderDialog("#rv-user"); }
        d.busy = true; d.fieldError = ""; d.alert = "";
        renderDialog();
        try {
            await window.DigiAuth.setUsername(value);
            s.mine.hasUsername = true;
            d.step = "form"; d.busy = false;
            renderDialog("#rv-text");
        } catch (error) {
            const e = apiError(error);
            d.busy = false;
            if (e.code === "USERNAME_ALREADY_SET") { s.mine.hasUsername = true; d.step = "form"; return renderDialog("#rv-text"); }
            if (e.code === "USERNAME_TAKEN" || e.status === 409) d.fieldError = `Username “${value}” đã có người dùng. Thử tên khác.`;
            else if (e.status === 422 || e.status === 400) d.fieldError = e.message || "Username không hợp lệ.";
            else if (e.status === 401) d.alert = "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
            else d.alert = "Không lưu được Username. Kiểm tra kết nối rồi thử lại.";
            renderDialog(d.fieldError ? "#rv-user" : null);
        }
    };

    const submitReview = async () => {
        const d = dialogState;
        const comment = d.text.trim();
        if (!d.rating && !comment) { d.fieldError = "Hãy chọn số sao hoặc viết nhận xét."; d.alert = ""; return renderDialog("#rv-text"); }
        d.busy = true; d.fieldError = ""; d.alert = "";
        renderDialog();
        const editing = d.mode === "edit";
        try {
            await window.DigiAuth.api(`/api/products/${encodeURIComponent(s.productId)}/reviews${editing ? "/mine" : ""}`, {
                method: editing ? "PUT" : "POST",
                body: { rating: d.rating || null, comment }
            });
            closeDialog();
            toast(editing ? "Đã lưu đánh giá của bạn" : "Cảm ơn bạn đã đánh giá", "success");
            await reloadAll(1);
            root.querySelector("[data-rv-mine]")?.focus();
            announce(editing ? "Đã lưu thay đổi đánh giá." : "Đã gửi đánh giá.");
        } catch (error) {
            const e = apiError(error);
            d.busy = false;
            if (e.code === "USERNAME_REQUIRED") { s.mine.hasUsername = false; d.step = "username"; d.alert = ""; return renderDialog("#rv-user"); }
            if (e.code === "REVIEW_NOT_ELIGIBLE") { closeDialog(); s.mine.eligible = false; renderCta(); toast(e.message || "Bạn chưa thể đánh giá sản phẩm này.", "error"); return; }
            if (e.code === "REVIEW_EXISTS") { closeDialog(); toast(e.message || "Bạn đã đánh giá sản phẩm này rồi.", "info"); return reloadAll(1); }
            if (e.status === 422) { d.fieldError = e.errors[0]?.message || e.message || "Đánh giá không hợp lệ."; return renderDialog("#rv-text"); }
            if (e.status === 401) d.alert = "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
            else d.alert = e.status >= 400 && e.status < 500 && e.message ? e.message : "Không gửi được đánh giá. Kiểm tra kết nối rồi thử lại, nội dung của bạn vẫn được giữ.";
            renderDialog();
        }
    };

    const submitGuest = async () => {
        const d = dialogState;
        const guestName = d.guestName.replace(/\s+/g, " ").trim();
        const comment = d.text.trim();
        d.nameError = ""; d.fieldError = ""; d.alert = "";
        if (guestName.length < GUEST_NAME_MIN || guestName.length > GUEST_NAME_MAX) { d.nameError = `Tên hiển thị dài từ ${GUEST_NAME_MIN} đến ${GUEST_NAME_MAX} ký tự.`; return renderDialog("#rv-guest-name"); }
        if (!comment) { d.fieldError = "Hãy viết nội dung bình luận."; return renderDialog("#rv-text"); }
        d.busy = true;
        renderDialog();
        try {
            await window.DigiAuth.api(`/api/products/${encodeURIComponent(s.productId)}/reviews`, { method: "POST", body: { guestName, comment } });
            closeDialog();
            toast("Cảm ơn bạn đã bình luận", "success");
            await loadList(1);
            announce("Đã gửi bình luận.");
        } catch (error) {
            const e = apiError(error);
            d.busy = false;
            const fieldError = (field) => e.errors.find((item) => item.field === field)?.message || "";
            if (e.status === 400 && (fieldError("guestName") || fieldError("comment"))) {
                d.nameError = fieldError("guestName");
                d.fieldError = fieldError("comment");
                return renderDialog(d.nameError ? "#rv-guest-name" : "#rv-text");
            }
            if (e.status === 429) d.alert = "Bạn gửi bình luận quá nhanh. Hãy thử lại sau ít phút.";
            else if (e.status === 401) d.alert = e.message || "Đăng nhập để chấm sao.";
            else d.alert = e.status >= 400 && e.status < 500 && e.message ? e.message : "Không gửi được bình luận. Kiểm tra kết nối rồi thử lại, nội dung của bạn vẫn được giữ.";
            renderDialog();
        }
    };

    const onSubmit = (event) => {
        if (!dialogState) return;
        event.preventDefault();
        if (dialogState.busy) return;
        if (event.target.matches("[data-rv-guest]")) submitGuest();
        else if (event.target.matches("[data-rv-username]")) submitUsername();
        else if (event.target.matches("[data-rv-form]")) submitReview();
    };

    const deleteReview = async () => {
        s.busy = true; renderOwn();
        try {
            await window.DigiAuth.api(`/api/products/${encodeURIComponent(s.productId)}/reviews/mine`, { method: "DELETE" });
            s.busy = false; s.confirmDelete = false;
            toast("Đã xoá đánh giá của bạn", "success");
            await reloadAll(1);
            root.querySelector("[data-rv-action='write']")?.focus();
            announce("Đã xoá đánh giá.");
        } catch (error) {
            const e = apiError(error);
            s.busy = false; s.confirmDelete = false;
            renderOwn();
            toast(e.status >= 400 && e.status < 500 && e.message ? e.message : "Không xoá được đánh giá. Hãy thử lại.", "error");
        }
    };

    // ---------- sự kiện trên khối ----------
    function onClick(event) {
        const pageLink = event.target.closest(".catalog-pagination a[href]");
        if (pageLink && root.contains(pageLink)) {
            event.preventDefault();
            const page = Number((/trang-(\d+)$/.exec(pageLink.getAttribute("href")) || [])[1]);
            if (page) { loadList(page).then(() => root.querySelector(".reviews__title").scrollIntoView({ block: "start" })); }
            return;
        }
        const target = event.target.closest("[data-rv-action], [data-rv-star]");
        if (!target) return;
        if (target.dataset.rvStar && dialogState) { const value = Number(target.dataset.rvStar); setRating(dialogState.rating === value ? 0 : value, true); return; }
        switch (target.dataset.rvAction) {
            case "write": openDialog("create"); break;
            case "write-guest": openDialog("guest"); break;
            case "edit": openDialog("edit"); break;
            case "close-dialog": closeDialog(); break;
            case "delete": s.confirmDelete = true; renderOwn(); root.querySelector("[data-rv-confirm]")?.focus(); break;
            case "cancel-delete": s.confirmDelete = false; renderOwn(); root.querySelector("[data-rv-action='delete']")?.focus(); break;
            case "confirm-delete": deleteReview(); break;
            case "retry-list": loadList(s.page); break;
            case "retry-mine": loadMine(); break;
            case "toggle-more": {
                const id = Number(target.dataset.id);
                if (s.expanded.has(id)) s.expanded.delete(id); else s.expanded.add(id);
                renderOwn(); renderList();
                root.querySelector(`[data-rv-action="toggle-more"][data-id="${id}"]`)?.focus();
                break;
            }
            default: break;
        }
    }

    // ---------- cập nhật trực tiếp ----------
    const scheduleResync = () => {
        clearTimeout(resyncTimer);
        resyncTimer = setTimeout(() => loadList(s.page, { silent: true }), 400);
    };

    const setLiveStatus = (state) => {
        const node = root?.querySelector("[data-rv-live-state]");
        if (!node) return;
        node.hidden = false;
        node.dataset.state = state;
        node.textContent = state === "live" ? "Cập nhật trực tiếp" : "Tự làm mới mỗi 30 giây";
    };

    const validAggregate = (a) => a && typeof a === "object" && Number.isFinite(a.ratingCount) && Number.isFinite(a.commentCount)
        && a.distribution && typeof a.distribution === "object" && (a.ratingAverage === null || Number.isFinite(a.ratingAverage));

    // Áp một sự kiện từ máy chủ: điểm trung bình đổi ngay, trang 1 chèn/xoá tại chỗ, trang khác thì tải lại nền.
    const applyLiveEvent = ({ type, review, aggregate }) => {
        if (validAggregate(aggregate)) {
            s.list.summary = aggregate;
            renderSummary();
            syncHeaderRating();
        }
        if (s.list.status !== "ready" || !s.list.meta) { scheduleResync(); return; }
        if (review.id === s.mine.review?.id) return; // đánh giá của chính mình đã có khối riêng
        const { data, meta } = s.list;
        const index = data.findIndex((row) => row.id === review.id);
        let needsResync = s.page > 1;
        if (type === "review.deleted" || type === "review.hidden") {
            if (index >= 0) { data.splice(index, 1); meta.total = Math.max(0, meta.total - 1); }
            needsResync = true; // refill the page, or refresh the totals when an older review went away
        } else if (index >= 0) {
            data[index] = review;
        } else {
            meta.total += 1;
            if (s.page === 1) {
                data.unshift(review);
                if (data.length > PAGE_SIZE) { data.pop(); needsResync = true; }
                s.freshId = review.id;
                clearTimeout(freshTimer);
                freshTimer = setTimeout(() => { s.freshId = 0; }, 3000);
                if (type === "review.created") announce("Có bình luận mới.");
            }
        }
        meta.totalPages = Math.max(1, Math.ceil(meta.total / (meta.pageSize || PAGE_SIZE)));
        renderList();
        if (needsResync) scheduleResync();
    };

    const ensureStyles = () => {
        if (document.querySelector(`link[href="${STYLESHEET}"]`)) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = STYLESHEET;
        document.head.appendChild(link);
    };

    // Liên kết từ trang Đơn hàng của tôi (product_info.html?id=…#danh-gia): khách đủ điều kiện vào thẳng hộp thoại,
    // đã có đánh giá thì mở bản sửa. Khách chưa đăng nhập, quản trị, chưa đủ điều kiện chỉ dừng ở khối đánh giá.
    const openFromDeepLink = () => {
        const m = s.mine;
        if (m.status !== "ready" || m.kind !== "user") return;
        if (m.review) openDialog("edit");
        else if (m.eligible) openDialog("create");
        else return;
        returnFocus = null;
    };

    const startLive = () => {
        if (live || !window.ReviewLive) return;
        live = window.ReviewLive.connect({
            productId: s.productId,
            onEvent: applyLiveEvent,
            onResync: () => loadList(s.page, { silent: true }),
            onStatus: setLiveStatus
        });
        window.addEventListener("pagehide", () => live?.close(), { once: true });
    };

    const mount = ({ container, product }) => {
        s.productId = product.id;
        s.productName = product.name || "";
        ensureStyles();
        root = document.createElement("section");
        root.className = "reviews";
        root.id = "danh-gia";
        root.setAttribute("aria-labelledby", "reviews-title");
        root.innerHTML = `<div class="reviews__head"><h2 class="reviews__title" id="reviews-title">Đánh giá của khách</h2><span class="reviews__live" data-rv-live-state hidden></span></div>
            <div data-rv-summary></div>
            <div class="reviews__cta" data-rv-cta></div>
            <div data-rv-own></div>
            <div class="reviews__list" data-rv-list aria-live="polite"></div>
            <div class="catalog-pagination reviews__pager" data-rv-pager></div>
            <p class="sr-only" role="status" data-rv-live></p>`;
        container.appendChild(root);
        root.addEventListener("click", onClick);
        renderSummary(); renderCta(); renderList();
        window.DigiAuth?.ready?.then(() => reloadAll(1)).catch(() => reloadAll(1)).then(() => {
            startLive();
            if (location.hash !== "#danh-gia") return;
            root.scrollIntoView({ block: "start" });
            openFromDeepLink();
        });
    };

    window.ProductReviews = Object.freeze({ mount });
})();
