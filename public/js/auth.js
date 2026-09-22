/* DigiAuth — shared browser auth client
 *
 * Public contract:
 *   DigiAuth.ready          Promise<SessionState> (bootstrap GET /api/auth/session)
 *   DigiAuth.api(path, opts) credentialed same-origin JSON API with CSRF
 *   DigiAuth.getSession()   current SessionState (await-safe)
 *   DigiAuth.subscribe(fn)  unsubscribe callback for session changes
 *
 * SessionState = { authenticated: boolean, user?: {
 *   id, email?, username?, role: 'user'|'admin', status,
 *   forcePasswordChange: boolean
 * } }
 *
 * Login handoff: dispatches `digiauth:login` with detail {session,user,
 * returnState,handled}. If a checkout coordinator is available it may set
 * detail.handled or expose DigiCart.completeLogin(session). This client never
 * submits an order. Checkout drafts use sessionStorage key
 * `digi_checkout_draft_v1`; passwords/tokens are never written there.
 */
(() => {
    "use strict";

    const DRAFT_KEY = "digi_checkout_draft_v1";
    const VERIFY_KEY = "digi_auth_verification_v1";
    const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
    const listeners = new Set();
    const csrfCookieNames = ["__Host-csrf_token", "csrf_token"];
    let session = { authenticated: false };
    let refreshPromise = null;
    let bootstrapPromise = null;
    let googlePendingCredential = null;

    const readCookie = (name) => {
        const prefix = `${name}=`;
        const pair = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
        if (!pair) return "";
        try { return decodeURIComponent(pair.slice(prefix.length)); } catch (_) { return ""; }
    };

    const ensureGoogleCsrfCookie = () => {
        const existing = readCookie("g_csrf_token");
        if (existing) return existing;
        const bytes = new Uint8Array(24);
        if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
        else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
        const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        document.cookie = `g_csrf_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict`;
        return token;
    };

    const getCsrfToken = () => csrfCookieNames.map(readCookie).find(Boolean) || "";

    const safeJson = async (response) => {
        if (response.status === 204) return {};
        try { return await response.json(); } catch (_) { return {}; }
    };

    const errorMessage = (code, fallback = "Yêu cầu không thành công. Vui lòng thử lại.") => ({
        AUTH_CONFIGURATION: "Dịch vụ xác thực tạm thời không khả dụng.",
        INVALID_CREDENTIALS: "Thông tin đăng nhập không đúng.",
        EMAIL_UNVERIFIED: "Email chưa được xác minh. Hãy gửi lại email xác minh.",
        PASSWORD_LOCKED: "Đăng nhập bằng mật khẩu đang bị khóa. Hãy dùng phục hồi mật khẩu.",
        GOOGLE_TOKEN_INVALID: "Không thể xác minh tài khoản Google. Hãy thử lại hoặc dùng mật khẩu.",
        GOOGLE_LINK_REQUIRES_PASSWORD: "Hãy xác nhận mật khẩu hiện tại để liên kết Google.",
        MAIL_UNAVAILABLE: "Không thể gửi email lúc này. Vui lòng thử lại sau.",
        RATE_LIMITED: "Bạn đã thử quá nhiều lần. Hãy chờ một lát rồi thử lại.",
        REFRESH_INVALID: "Phiên đã hết hạn. Vui lòng đăng nhập lại.",
        REFRESH_REUSED: "Phiên đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại.",
        TOKEN_INVALID: "Liên kết xác minh không hợp lệ.",
        TOKEN_EXPIRED: "Liên kết xác minh đã hết hạn. Hãy gửi lại email mới.",
        CURRENT_PASSWORD_INVALID: "Mật khẩu hiện tại không đúng.",
        PASSWORD_CHANGE_REQUIRED: "Hãy đổi mật khẩu trước khi tiếp tục.",
        VALIDATION_FAILED: "Vui lòng kiểm tra lại thông tin đã nhập.",
        AUTH_REQUIRED: "Bạn cần đăng nhập để tiếp tục.",
        FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
        USERNAME_TAKEN: "Tên đăng nhập đã được sử dụng.",
        IDEMPOTENCY_CONFLICT: "Yêu cầu đã thay đổi. Vui lòng tải lại và thử lại."
    }[code] || fallback);

    const normalizeUser = (user) => {
        if (!user || typeof user !== "object") return undefined;
        const normalized = {
            id: typeof user.id === "string" ? user.id : "",
            role: user.role === "admin" ? "admin" : "user",
            status: typeof user.status === "string" ? user.status : "ACTIVE",
            forcePasswordChange: Boolean(user.forcePasswordChange)
        };
        if (typeof user.email === "string" && user.email) normalized.email = user.email;
        if (typeof user.username === "string" && user.username) normalized.username = user.username;
        return normalized;
    };

    const normalizeSession = (value) => {
        const authenticated = Boolean(value && value.authenticated && value.user);
        return authenticated ? { authenticated: true, user: normalizeUser(value.user) } : { authenticated: false };
    };

    const notify = (next, reason = "session") => {
        const normalized = normalizeSession(next);
        const changed = JSON.stringify(session) !== JSON.stringify(normalized);
        session = normalized;
        if (!changed && reason !== "login" && reason !== "logout") { renderNav(); return session; }
        listeners.forEach((listener) => {
            try { listener(session, reason); } catch (_) { /* Subscriber errors must not break auth. */ }
        });
        window.dispatchEvent(new CustomEvent("digiauth:change", { detail: { session, reason } }));
        renderNav();
        return session;
    };

    const parseApiError = (response, payload) => {
        const detail = payload && payload.error && typeof payload.error === "object" ? payload.error : {};
        const code = detail.code || payload.code || "REQUEST_FAILED";
        const error = new Error(errorMessage(code));
        error.code = code;
        error.status = response.status;
        error.fields = detail.fields || payload.fields || {};
        error.details = Array.isArray(payload.errors) ? payload.errors : [];
        error.payload = payload;
        return error;
    };

    const validatePath = (path) => {
        const url = new URL(path, window.location.origin);
        if (url.origin !== window.location.origin) throw new Error("Only same-origin requests are allowed");
        return url;
    };

    const request = async (path, options = {}, allowRefresh = true) => {
        const url = validatePath(path);
        const suppliedBody = options.body;
        const method = String(options.method || "GET").toUpperCase();
        const headers = { Accept: "application/json", ...(options.headers || {}) };
        let body = suppliedBody;
        if (body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof FormData)) {
            body = JSON.stringify(body);
            if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
        } else if (typeof body === "string" && !headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = "application/json";
        }
        const skipCsrf = options.csrf === false || url.pathname === "/api/auth/google";
        if (!skipCsrf && !SAFE_METHODS.has(method) && !headers["X-CSRF-Token"] && !headers["x-csrf-token"]) {
            let token = getCsrfToken();
            if (!token && path !== "/api/auth/session") {
                try { await request("/api/auth/session", { method: "GET" }, false); } catch (_) { /* Let the mutation report the useful error. */ }
                token = getCsrfToken();
            }
            if (token) headers["X-CSRF-Token"] = token;
        }
        const fetchOptions = { ...options, method, body, headers, credentials: "same-origin" };
        delete fetchOptions.csrf;
        const response = await fetch(url.href, fetchOptions);
        const payload = await safeJson(response);
        if (response.status === 401 && allowRefresh && SAFE_METHODS.has(method) && path !== "/api/auth/refresh") {
            try {
                await refresh();
                return request(path, options, false);
            } catch (_) { /* Preserve the original safe request error. */ }
        }
        if (!response.ok || payload.success === false) throw parseApiError(response, payload);
        syncFromResponse(path, payload);
        return payload;
    };
    const refresh = async () => {
        if (refreshPromise) return refreshPromise;
        refreshPromise = (async () => {
            let token = getCsrfToken();
            if (!token) {
                try { await request("/api/auth/session", { method: "GET" }, false); } catch (_) { /* Continue so refresh returns its server error. */ }
                token = getCsrfToken();
            }
            const headers = { Accept: "application/json" };
            if (token) headers["X-CSRF-Token"] = token;
            const response = await fetch(new URL("/api/auth/refresh", window.location.origin), {
                method: "POST", credentials: "same-origin", headers
            });
            const payload = await safeJson(response);
            if (!response.ok) throw parseApiError(response, payload);
            const current = await request("/api/auth/session", { method: "GET" }, false);
            notify(current.data || { authenticated: false }, "refresh");
            return session;
        })().finally(() => { refreshPromise = null; });
        return refreshPromise;
    };

    const syncFromResponse = (path, payload) => {
        const pathname = new URL(path, window.location.origin).pathname;
        if ((pathname === "/api/auth/login" || pathname === "/api/auth/google") && payload?.data?.user) {
            notify({ authenticated: true, user: payload.data.user }, "login");
            return;
        }
        if (pathname === "/api/auth/logout") notify({ authenticated: false }, "logout");
        if (pathname === "/api/auth/change-password" && session.authenticated) {
            notify({ authenticated: true, user: { ...session.user, forcePasswordChange: false } }, "password-change");
        }
    };

    const getReturnState = () => {
        try {
            const raw = sessionStorage.getItem(DRAFT_KEY);
            if (!raw) return null;
            const draft = JSON.parse(raw);
            if (!draft || draft.version !== 1 || !Number.isFinite(draft.expiresAt) || draft.expiresAt <= Date.now()) {
                sessionStorage.removeItem(DRAFT_KEY);
                return null;
            }
            const path = typeof draft.returnPath === "string" ? draft.returnPath : "";
            if (!/^\/checkouts\.html\?(?:source=cart|id=\d+)$/.test(path)) { sessionStorage.removeItem(DRAFT_KEY); return null; }
            return { ...draft, returnPath: path };
        } catch (_) { return null; }
    };

    const clearReturnState = () => {
        try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) { /* storage can be disabled */ }
    };

    const setVerificationContext = (value) => {
        try {
            sessionStorage.setItem(VERIFY_KEY, JSON.stringify({
                email: typeof value?.email === "string" ? value.email : "",
                maskedEmail: typeof value?.maskedEmail === "string" ? value.maskedEmail : "",
                expiresAt: Date.now() + 15 * 60 * 1000
            }));
        } catch (_) { /* Verification page remains usable without storage. */ }
    };

    const getVerificationContext = () => {
        try {
            const value = JSON.parse(sessionStorage.getItem(VERIFY_KEY) || "null");
            if (!value || !value.expiresAt || value.expiresAt <= Date.now()) return null;
            return value;
        } catch (_) { return null; }
    };

    const clearVerificationContext = () => {
        try { sessionStorage.removeItem(VERIFY_KEY); } catch (_) { /* no-op */ }
    };

    const identityLabel = (user) => {
        const value = user?.username || user?.email || "Tài khoản";
        if (user?.username) return value.length > 18 ? `${value.slice(0, 15)}…` : value;
        const [local, domain] = value.split("@");
        if (!domain) return value.length > 18 ? `${value.slice(0, 15)}…` : value;
        return `${local.slice(0, 2)}…@${domain}`;
    };

    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[character]));

    const renderNav = () => {
        document.querySelectorAll("[data-auth-nav]").forEach((host) => {
            host.classList.toggle("auth-nav--admin", session.user?.role === "admin");
            if (!session.authenticated) {
                host.innerHTML = `<a class="auth-nav__login" href="/auth.html">Đăng nhập</a><a class="auth-nav__register" href="/auth.html?tab=register">Đăng ký</a>`;
                return;
            }
            const label = escapeHtml(identityLabel(session.user));
            host.innerHTML = `<details class="auth-nav__menu"><summary class="auth-nav__identity" aria-label="Mở menu tài khoản">${label}<span aria-hidden="true">⌄</span></summary><div class="auth-nav__popover"><a href="/profile.html">Hồ sơ</a>${session.user.role === "admin" ? "<a href=\"/admin.html\">Quản trị</a>" : ""}<button type="button" data-auth-logout>Đăng xuất</button></div></details>`;
        });
        document.querySelectorAll(".cart-nav-link").forEach((link) => {
            const item = link.closest("li");
            if (item) item.hidden = session.user?.role === "admin";
        });
    };

    const performLogout = async () => {
        const button = document.querySelector("[data-auth-logout]");
        if (button) button.disabled = true;
        try { await request("/api/auth/logout", { method: "POST" }, false); } catch (_) { notify({ authenticated: false }, "logout"); }
        clearReturnState();
        if (window.CartService && typeof window.CartService.clearForLogout === "function") window.CartService.clearForLogout();
        window.location.assign("/");
    };

    const onGoogleCredential = async (response) => {
        const token = ensureGoogleCsrfCookie();
        if (!response || !response.credential || !token) return showAuthMessage("Không thể xác minh phiên Google. Hãy thử lại.", "error");
        googlePendingCredential = response.credential;
        try {
            await request("/api/auth/google", {
                method: "POST", csrf: false,
                body: { credential: response.credential, g_csrf_token: token, remember: Boolean(document.querySelector("#remember-me")?.checked) }
            });
            googlePendingCredential = null;
            await finishLogin();
        } catch (error) {
            if (error.code === "GOOGLE_LINK_REQUIRES_PASSWORD") {
                const proof = document.querySelector("#google-password-proof");
                if (proof) { proof.hidden = false; document.querySelector("#google-password-proof-input")?.focus(); }
                showAuthMessage(error.message, "error");
            } else showAuthMessage(error.message, "error");
        }
    };

    const setupGoogle = () => {
        const containers = Array.from(document.querySelectorAll("[data-google-button]"));
        if (!containers.length) return;
        ensureGoogleCsrfCookie();
        const clientId = document.querySelector('meta[name="google-client-id"]')?.content || window.DIGI_GOOGLE_CLIENT_ID || "";
        const render = () => {
            if (!window.google?.accounts?.id || !clientId) return false;
            window.google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential, cancel_on_tap_outside: true });
            containers.forEach((container) => {
                container.innerHTML = "";
                window.google.accounts.id.renderButton(container, { theme: "outline", size: "large", width: Math.min(360, container.clientWidth || 360), text: "signin_with", locale: "vi" });
            });
            return true;
        };
        if (render()) return;
        containers.forEach((container) => {
            container.innerHTML = `<button class="auth-google-fallback" type="button">Tiếp tục với Google</button>`;
            container.querySelector("button")?.addEventListener("click", () => showAuthMessage("Đăng nhập Google chưa được cấu hình. Hãy dùng email và mật khẩu.", "error"));
        });
        let attempts = 0;
        const timer = window.setInterval(() => { if (render() || ++attempts > 20) window.clearInterval(timer); }, 250);
    };

    const showAuthMessage = (message, type = "error") => {
        document.querySelectorAll("[data-auth-message]").forEach((element) => {
            element.textContent = message || "";
            element.dataset.state = message ? type : "";
            element.hidden = !message;
        });
    };
    const setFormError = (field, message, root = document) => {
        const input = root.querySelector(`[name="${field}"]`);
        const error = root.querySelector(`[data-field-error="${field}"]`);
        if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
        if (error) error.textContent = message || "";
    };

    const clearFormErrors = (form) => {
        form?.querySelectorAll("[data-field-error]").forEach((element) => { element.textContent = ""; });
        form?.querySelectorAll("[aria-invalid]").forEach((element) => { element.setAttribute("aria-invalid", "false"); });
    };

    const firstInvalid = (form) => form?.querySelector('[aria-invalid="true"]');

    const setSubmitBusy = (form, busy, label = "Đang xử lý…") => {
        const button = form?.querySelector("button[type=submit]");
        if (!button) return;
        if (!button.dataset.label) button.dataset.label = button.textContent;
        button.disabled = busy;
        button.textContent = busy ? label : button.dataset.label;
    };

    const initAuthPage = async () => {
        const loginForm = document.querySelector("#login-form");
        const registerForm = document.querySelector("#register-form");
        if (!loginForm || !registerForm) return;
        const tabs = Array.from(document.querySelectorAll("[data-auth-tab]"));
        const panels = Array.from(document.querySelectorAll("[data-auth-panel]"));
        const selectTab = (name) => {
            tabs.forEach((tab) => {
                const active = tab.dataset.authTab === name;
                tab.setAttribute("aria-selected", String(active));
                tab.tabIndex = active ? 0 : -1;
            });
            panels.forEach((panel) => { panel.hidden = panel.dataset.authPanel !== name; });
            document.querySelector(`[data-auth-panel="${name}"] input`)?.focus();
        };
        const initialTab = new URLSearchParams(window.location.search).get("tab") === "register" ? "register" : "login";
        tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => selectTab(tab.dataset.authTab));
            tab.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next]?.focus();
                selectTab(tabs[next]?.dataset.authTab || initialTab);
            });
        });
        selectTab(initialTab);
        await bootstrapPromise;
        if (new URLSearchParams(window.location.search).get("verified") === "1") showAuthMessage("Email đã xác minh. Bạn có thể đăng nhập.", "success");

        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFormErrors(loginForm);
            showAuthMessage("");
            const identifier = loginForm.identifier.value.trim();
            const password = loginForm.password.value;
            let invalid = false;
            if (!identifier) { setFormError("identifier", "Nhập email hoặc username."); invalid = true; }
            if (password.length < 6) { setFormError("password", "Mật khẩu phải có ít nhất 6 ký tự."); invalid = true; }
            if (invalid) { firstInvalid(loginForm)?.focus(); return; }
            setSubmitBusy(loginForm, true);
            try {
                await api("/api/auth/login", { method: "POST", body: { identifier, password, remember: Boolean(loginForm.remember.checked) } });
                loginForm.reset();
                await finishLogin();
            } catch (error) {
                if (error.code === "EMAIL_UNVERIFIED") {
                    showAuthMessage("Email chưa được xác minh. Hãy kiểm tra hộp thư hoặc gửi lại email xác minh.", "error");
                    const resend = document.querySelector("[data-resend-login]");
                    if (resend) { resend.hidden = false; resend.dataset.email = identifier; }
                } else showAuthMessage(error.message, "error");
                loginForm.password.value = "";
            } finally { setSubmitBusy(loginForm, false); }
        });

        registerForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFormErrors(registerForm);
            showAuthMessage("");
            const email = registerForm.email.value.trim();
            const password = registerForm.password.value;
            const confirmation = registerForm.confirmPassword.value;
            let invalid = false;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFormError("email", "Nhập email hợp lệ.", registerForm); invalid = true; }
            if (password.length < 6) { setFormError("password", "Mật khẩu phải có ít nhất 6 ký tự.", registerForm); invalid = true; }
            if (password !== confirmation) { setFormError("confirmPassword", "Mật khẩu nhập lại chưa khớp.", registerForm); invalid = true; }
            if (invalid) { firstInvalid(registerForm)?.focus(); return; }
            setSubmitBusy(registerForm, true, "Đang tạo tài khoản…");
            try {
                const payload = await api("/api/auth/register", { method: "POST", body: { email, password } });
                setVerificationContext({ email: email, maskedEmail: payload.data?.email });
                registerForm.reset();
                window.location.assign("/verify-email.html");
            } catch (error) {
                showAuthMessage(error.message, "error");
                registerForm.password.value = "";
                registerForm.confirmPassword.value = "";
            } finally { setSubmitBusy(registerForm, false); }
        });

        document.querySelector("[data-resend-login]")?.addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await api("/api/auth/resend-verification", { method: "POST", body: { email: button.dataset.email || "" } });
                showAuthMessage("Nếu email hợp lệ, hướng dẫn xác minh đã được gửi. Hãy kiểm tra hộp thư.", "success");
            } catch (error) { showAuthMessage(error.message, "error"); }
            finally { window.setTimeout(() => { button.disabled = false; }, 1000); }
        });

        document.querySelector("[data-google-proof-submit]")?.addEventListener("click", async () => {
            const proof = document.querySelector("#google-password-proof-input");
            const password = proof?.value || "";
            if (!googlePendingCredential || password.length < 6) { showAuthMessage("Nhập mật khẩu hiện tại để xác nhận liên kết.", "error"); proof?.focus(); return; }
            try {
                const csrf = ensureGoogleCsrfCookie();
                await api("/api/auth/google", { method: "POST", csrf: false, body: { credential: googlePendingCredential, password, g_csrf_token: csrf, remember: Boolean(document.querySelector("#remember-me")?.checked) } });
                googlePendingCredential = null;
                if (proof) proof.value = "";
                await finishLogin();
            } catch (error) { showAuthMessage(error.message, "error"); if (proof) proof.value = ""; }
        });
    };
    const initVerificationPage = async () => {
        const card = document.querySelector("[data-verification-page]");
        if (!card) return;
        const context = getVerificationContext();
        const emailLabel = document.querySelector("[data-verification-email]");
        if (emailLabel) emailLabel.textContent = context?.maskedEmail || (context?.email ? `${context.email.slice(0, 2)}…` : "địa chỉ email của bạn");
        const status = document.querySelector("[data-verification-status]");
        const resend = document.querySelector("[data-resend-verification]");
        const check = document.querySelector("[data-check-verification]");
        const countdown = document.querySelector("[data-verification-countdown]");
        const token = new URLSearchParams(window.location.search).get("token");
        if (token) {
            window.history.replaceState({}, "", "/verify-email.html");
            try {
                await api("/api/auth/verify-email", { method: "POST", body: { token } });
                clearVerificationContext();
                if (status) { status.textContent = "Email đã được xác minh. Bạn có thể đăng nhập."; status.dataset.state = "success"; }
                if (resend) resend.hidden = true;
                if (check) check.hidden = true;
                document.querySelector("[data-verification-login]")?.removeAttribute("hidden");
            } catch (error) {
                if (status) { status.textContent = error.code === "TOKEN_EXPIRED" ? "Liên kết đã hết hạn. Hãy gửi lại email xác minh." : error.message; status.dataset.state = "error"; }
            }
        }
        let expiresAt = context?.expiresAt || Date.now();
        const tick = () => {
            const remaining = Math.max(0, expiresAt - Date.now());
            if (countdown) {
                const minutes = Math.floor(remaining / 60000).toString().padStart(2, "0");
                const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
                countdown.textContent = `${minutes}:${seconds}`;
            }
            if (resend) resend.disabled = remaining > 0 && Boolean(resend.dataset.cooldown);
            if (remaining <= 0 && resend) { resend.disabled = false; resend.dataset.cooldown = ""; }
        };
        tick();
        window.setInterval(tick, 1000);
        resend?.addEventListener("click", async () => {
            if (!context?.email) { status.textContent = "Hãy đăng ký lại hoặc nhập email trong trang phục hồi."; status.dataset.state = "error"; return; }
            resend.disabled = true;
            try {
                await api("/api/auth/resend-verification", { method: "POST", body: { email: context.email } });
                expiresAt = Date.now() + 15 * 60 * 1000;
                resend.dataset.cooldown = "true";
                if (status) { status.textContent = "Nếu email hợp lệ, liên kết mới đã được gửi."; status.dataset.state = "success"; }
            } catch (error) { if (status) { status.textContent = error.message; status.dataset.state = "error"; } resend.disabled = false; }
        });
        check?.addEventListener("click", () => window.location.assign("/auth.html?verified=1"));
    };

    const initRecoveryPage = () => {
        const form = document.querySelector("#recovery-form");
        if (!form) return;
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFormErrors(form);
            const email = form.email.value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFormError("email", "Nhập email hợp lệ."); form.email.focus(); return; }
            setSubmitBusy(form, true, "Đang gửi…");
            try {
                await api("/api/auth/recover", { method: "POST", body: { email } });
                form.reset();
                showAuthMessage("Nếu email khớp với tài khoản, hướng dẫn phục hồi đã được gửi. Hãy kiểm tra hộp thư.", "success");
            } catch (error) { showAuthMessage(error.message, "error"); }
            finally { setSubmitBusy(form, false); }
        });
    };

    const initProfilePage = async () => {
        const form = document.querySelector("#profile-password-form");
        if (!form) return;
        const current = await bootstrapPromise;
        if (!current.authenticated) { window.location.assign("/auth.html"); return; }
        const identity = document.querySelector("[data-profile-identity]");
        if (identity) identity.textContent = identityLabel(current.user);
        if (current.user.forcePasswordChange) document.querySelector("[data-force-password]")?.removeAttribute("hidden");
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFormErrors(form);
            const newPassword = form.newPassword.value;
            const confirmation = form.confirmPassword.value;
            let invalid = false;
            if (form.currentPassword.value.length < 1) { setFormError("currentPassword", "Nhập mật khẩu hiện tại."); invalid = true; }
            if (newPassword.length < 6) { setFormError("newPassword", "Mật khẩu mới phải có ít nhất 6 ký tự."); invalid = true; }
            if (newPassword !== confirmation) { setFormError("confirmPassword", "Mật khẩu nhập lại chưa khớp."); invalid = true; }
            if (invalid) { firstInvalid(form)?.focus(); return; }
            setSubmitBusy(form, true, "Đang lưu…");
            try {
                await api("/api/auth/change-password", { method: "POST", body: { currentPassword: form.currentPassword.value, newPassword } });
                form.reset();
                showAuthMessage("Mật khẩu đã được đổi thành công.", "success");
                document.querySelector("[data-force-password]")?.setAttribute("hidden", "");
            } catch (error) { showAuthMessage(error.message, "error"); form.currentPassword.value = ""; form.newPassword.value = ""; form.confirmPassword.value = ""; }
            finally { setSubmitBusy(form, false); }
        });
    };

    const initForbiddenPage = async () => {
        const page = document.querySelector("[data-forbidden-page]");
        if (!page) return;
        const context = new URLSearchParams(window.location.search).get("context");
        const { authenticated, user } = await bootstrapPromise;
        const heading = document.querySelector("[data-forbidden-title]");
        const copy = document.querySelector("[data-forbidden-copy]");
        if (context === "checkout" || context === "admin") {
            if (heading) heading.textContent = "Không thể truy cập khu vực này";
            if (copy) copy.textContent = authenticated && user?.role === "admin" && context === "checkout" ? "Tài khoản quản trị chỉ có quyền quản lý catalog, không đặt hàng." : "Tài khoản hiện tại không có quyền cho khu vực này.";
        }
        document.querySelector("[data-forbidden-admin]")?.toggleAttribute("hidden", user?.role !== "admin");
    };

    const initAuthSurfaces = () => {
        initAuthPage();
        initVerificationPage();
        initRecoveryPage();
        initProfilePage();
        initForbiddenPage();
    };

    const finishLogin = async () => {
        const returnState = getReturnState();
        const detail = { session, user: session.user, returnState, handled: false };
        window.dispatchEvent(new CustomEvent("digiauth:login", { detail }));
        if (!detail.handled && typeof window.DigiCart?.completeLogin === "function") {
            await window.DigiCart.completeLogin(session);
            detail.handled = true;
        }
        if (session.user?.role === "admin") {
            clearReturnState();
            window.location.replace("/admin.html");
            return detail;
        }
        if (!detail.handled) window.location.replace(returnState?.returnPath || "/");
        return detail;
    };

    const bootstrap = async () => {
        try {
            const payload = await request("/api/auth/session", { method: "GET" }, false);
            notify(payload.data || { authenticated: false }, "bootstrap");
        } catch (_) {
            notify({ authenticated: false }, "bootstrap");
        }
        setupGoogle();
        return session;
    };

    document.addEventListener("click", (event) => {
        const logout = event.target.closest("[data-auth-logout]");
        if (logout) { event.preventDefault(); performLogout(); }
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderNav, { once: true });
    else renderNav();

    bootstrapPromise = bootstrap();
    const api = (path, options = {}) => request(path, options);
    window.DigiAuth = {
        ready: bootstrapPromise,
        api,
        getSession: () => session,
        subscribe: (listener) => { if (typeof listener !== "function") return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
        getReturnState,
        clearReturnState,
        setVerificationContext,
        getVerificationContext,
        clearVerificationContext,
        finishLogin,
        showMessage: showAuthMessage,
        errorMessage
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAuthSurfaces, { once: true });
    else initAuthSurfaces();
})();
