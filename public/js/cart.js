// ===== CART.JS =====
// Guest local cart and authenticated Account cart coordinator.
// Account mutations always go through DigiAuth.api; local Guest data is only
// removed after the server confirms a committed merge or a successful logout.

const CART_KEY = "digi_cart";
const MERGE_OPERATION_KEY = "digi_cart_merge_operation_v1";
const SHIPPING_FEE_DEFAULT = 100000;

let _authSession = { authenticated: false, user: null };
let _accountItems = [];
let _accountReady = false;
let _pendingLoginUserId = null;
let _handledLoginUserId = null;
let _mergeError = null;

const _load = () => {
    try {
        const value = JSON.parse(localStorage.getItem(CART_KEY));
        return Array.isArray(value) ? value : [];
    } catch (_) {
        return [];
    }
};

const _save = (items) => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (_) { /* private mode */ }
};

const _clearLocal = () => {
    try { localStorage.removeItem(CART_KEY); } catch (_) { /* private mode */ }
};

const _storageGet = (key) => {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
};
const _storageSet = (key, value) => {
    try { window.sessionStorage.setItem(key, value); } catch (_) { /* same-tab persistence is best effort */ }
};
const _storageRemove = (key) => {
    try { window.sessionStorage.removeItem(key); } catch (_) { /* storage can be disabled */ }
};
const _clearMergeContext = () => _storageRemove(MERGE_OPERATION_KEY);

const _number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const _productId = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : null;
const _quantity = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

const _normalizeItem = (item) => {
    if (!item || typeof item !== "object") return null;
    const product = item.product || item;
    const productId = _productId(item.productId ?? product.id ?? item.id);
    const quantity = _quantity(item.quantity);
    if (productId === null || quantity === null) return null;
    const rawStock = item.stock ?? product.stock;
    const hasStock = rawStock !== undefined && rawStock !== null;
    return {
        productId,
        name: typeof (item.name ?? product.name) === "string" ? (item.name ?? product.name) : "Sản phẩm",
        slug: typeof item.slug === "string" ? item.slug : "",
        image: typeof (item.image ?? product.image) === "string" ? (item.image ?? product.image) : "",
        description: typeof (item.description ?? product.description) === "string" ? (item.description ?? product.description) : "",
        price: _number(item.price ?? product.price),
        stock: hasStock ? _number(rawStock) : undefined,
        quantity,
        available: item.available !== false && product.isDeleted !== true && (!hasStock || _number(rawStock) > 0),
        unavailableReason: item.unavailableReason || null,
        ...(item.addedAt ? { addedAt: item.addedAt } : {})
    };
};

const _normalizeItems = (items) => Array.isArray(items) ? items.map(_normalizeItem).filter(Boolean) : [];
const _unwrap = (value) => value && Object.prototype.hasOwnProperty.call(value, "data") ? value.data : value;

const _api = async (path, options = {}) => {
    if (window.DigiAuth && typeof window.DigiAuth.api === "function") {
        return window.DigiAuth.api(path, { credentials: "same-origin", ...options });
    }
    const response = await fetch(path, { credentials: "same-origin", ...options });
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok || body?.success === false) {
        const error = new Error(body?.error?.message || body?.message || "Không thể cập nhật giỏ hàng");
        error.status = response.status;
        error.code = body?.error?.code;
        throw error;
    }
    return _unwrap(body);
};

const _canonicalItems = (items) => _normalizeItems(items)
    .map((item) => ({ productId: item.productId, quantity: item.quantity }))
    .sort((a, b) => a.productId - b.productId);

const _sameItems = (left, right) => JSON.stringify(_canonicalItems(left)) === JSON.stringify(_canonicalItems(right));

const _getMergeContext = (userId, items) => {
    let context = null;
    try { context = JSON.parse(_storageGet(MERGE_OPERATION_KEY) || "null"); } catch (_) { context = null; }
    if (context?.userId === userId && _sameItems(context.items, items) && typeof context.operationId === "string") return context;
    const operationId = (window.crypto && typeof window.crypto.randomUUID === "function")
        ? window.crypto.randomUUID()
        : `merge-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    context = { version: 1, userId, operationId, items: _canonicalItems(items) };
    _storageSet(MERGE_OPERATION_KEY, JSON.stringify(context));
    return context;
};

const _augmentUnavailableItems = (items) => {
    const base = _normalizeItems(items);
    const report = window.DigiCheckoutState?.readMergeReport?.() || [];
    const draft = window.DigiCheckoutState?.readDraft?.();
    const unavailable = report.filter((entry) =>
        Number(entry.finalQuantity) <= 0 && ["out_of_stock", "soft_deleted", "not_found"].includes(entry.reason)
    );
    unavailable.forEach((entry) => {
        if (base.some((item) => item.productId === Number(entry.productId))) return;
        const source = draft?.cartSnapshot?.find((item) => Number(item.productId) === Number(entry.productId)) || (entry.name ? { name: entry.name } : null);
        if (!source) return;
        base.push({
            ...source,
            productId: Number(entry.productId),
            quantity: Math.max(1, Number(entry.requestedQuantity) || 1),
            stock: 0,
            available: false,
            unavailableReason: entry.reason
        });
    });
    return base;
};

const _setAccountItems = (items) => {
    _accountItems = _augmentUnavailableItems(items);
    _accountReady = true;
    CartService.updateBadge();
};

const _currentIsUser = () => Boolean(_authSession.authenticated && _authSession.user?.role === "user");
const _currentIsAdmin = () => Boolean(_authSession.authenticated && _authSession.user?.role === "admin");

const _accountPayload = (value) => {
    const data = _unwrap(value) || {};
    return {
        items: _normalizeItems(data.items),
        adjustments: Array.isArray(data.adjustments) ? data.adjustments : []
    };
};

const _refreshAccountCart = async () => {
    if (!_currentIsUser()) {
        _accountItems = [];
        _accountReady = false;
        CartService.updateBadge();
        return [];
    }
    const data = _unwrap(await _api("/api/cart", { method: "GET" })) || {};
    _setAccountItems(data.items || []);
    return _accountItems;
};

const _handleSession = async (session) => {
    const next = session && typeof session === "object" ? session : { authenticated: false, user: null };
    const wasAuthenticated = Boolean(_authSession.authenticated);
    const previousUserId = String(_authSession.user?.id || "");
    _authSession = {
        authenticated: Boolean(next.authenticated),
        user: next.user || null
    };

    if (!_authSession.authenticated) {
        // Initial anonymous bootstrap must preserve the Guest cart. Clear only
        // when an authenticated session actually transitions to Guest/logout.
        if (wasAuthenticated) {
            _clearLocal();
            window.DigiCheckoutState?.clearMergeReport?.();
            _storageRemove("digi_checkout_merge_report_v1");
        }
        _accountItems = [];
        _accountReady = false;
        _mergeError = null;
        _pendingLoginUserId = null;
        _handledLoginUserId = null;
        CartService.updateBadge();
        return [];
    }

    if (_currentIsAdmin()) {
        _accountItems = [];
        _accountReady = false;
        CartService.updateBadge();
        return [];
    }

    // completeLogin owns the Guest→Account merge. A passive session refresh must
    // never delete or overwrite a Guest cart before that coordinator runs.
    const userId = String(_authSession.user?.id || "");
    if (_pendingLoginUserId === userId || _handledLoginUserId === userId) return _accountItems;
    if (!wasAuthenticated || previousUserId !== userId) return _refreshAccountCart();
    return _accountItems;
};

const CartService = {
    getItems() {
        if (_currentIsUser()) {
            // Keep the Guest source visible and non-purchasable while an
            // account fetch/merge is unresolved; never silently drop it.
            if (_mergeError && !_accountReady) return _load();
            return _accountItems.slice();
        }
        return _load();
    },

    getSnapshot() {
        return this.getItems().map((item) => ({ ...item }));
    },

    isAccountCart() { return _currentIsUser(); },
    isAdmin() { return _currentIsAdmin(); },
    getSession() { return { ..._authSession, user: _authSession.user ? { ..._authSession.user } : null }; },
    whenReady() { return digiCartReady; },
    getMergeError() { return _mergeError; },

    addItem(product, quantity = 1) {
        const productId = _productId(product?.id ?? product?.productId);
        const requested = _quantity(quantity);
        if (!product || productId === null || requested === null || _number(product.stock) <= 0) {
            return { ok: false, reason: "out_of_stock", message: "Sản phẩm đã hết hàng" };
        }
        if (_currentIsUser()) {
            if (_mergeError) return { ok: false, reason: "merge_failed", message: "Hãy hợp nhất giỏ hàng trước khi chỉnh sửa." };
            if (!_accountReady && !_mergeError) {
                const promise = digiCartReady.then(() => {
                    const retry = this.addItem(product, quantity);
                    return retry.promise || retry;
                });
                return { ok: true, pending: true, promise };
            }
            const existing = _accountItems.find((item) => item.productId === productId);
            const nextQuantity = (existing?.quantity || 0) + requested;
            if (nextQuantity > _number(product.stock)) return { ok: false, reason: "exceeds_stock", message: `Chỉ còn ${product.stock} sản phẩm có thể thêm` };
            const promise = _api(`/api/cart/items/${encodeURIComponent(productId)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity: nextQuantity })
            }).then((result) => {
                const payload = _accountPayload(result);
                if (payload.adjustments.length) window.DigiCheckoutState?.saveMergeReport(payload.adjustments);
                _setAccountItems(payload.items);
                return payload;
            }).catch((error) => { _mergeError = error; showToast(error.message, "error"); throw error; });
            return { ok: true, pending: true, promise };
        }

        const items = _load();
        const index = items.findIndex((item) => item.productId === productId);
        const existingQty = index >= 0 ? Number(items[index].quantity) : 0;
        const total = existingQty + requested;
        if (total > _number(product.stock)) {
            const canAdd = _number(product.stock) - existingQty;
            return canAdd > 0
                ? { ok: false, reason: "exceeds_stock", message: `Chỉ còn ${canAdd} sản phẩm có thể thêm (tối đa ${product.stock})` }
                : { ok: false, reason: "max_reached", message: `Đã đạt tối đa ${product.stock} sản phẩm trong giỏ` };
        }
        const item = {
            productId,
            name: product.name,
            slug: product.slug || "",
            image: product.image || "",
            description: product.description || "",
            price: _number(product.price),
            stock: _number(product.stock),
            quantity: requested,
            addedAt: new Date().toISOString()
        };
        if (index >= 0) items[index] = { ...items[index], quantity: total, stock: _number(product.stock) };
        else items.push(item);
        _save(items);
        this.updateBadge();
        return { ok: true };
    },

    removeItem(productId) {
        const id = _productId(productId);
        if (id === null) return { ok: false, reason: "not_found" };
        if (_currentIsUser()) {
            if (_mergeError) return { ok: false, reason: "merge_failed", message: "Hãy hợp nhất giỏ hàng trước khi chỉnh sửa." };
            const promise = _api(`/api/cart/items/${encodeURIComponent(id)}`, { method: "DELETE" })
                .then((result) => {
                    window.DigiCheckoutState?.removeMergeAdjustment?.(id);
                    _setAccountItems((_unwrap(result) || {}).items || []);
                })
                .catch((error) => { _mergeError = error; showToast(error.message, "error"); throw error; });
            return { ok: true, pending: true, promise };
        }
        _save(_load().filter((item) => item.productId !== id));
        this.updateBadge();
        return { ok: true };
    },

    updateQty(productId, qty, maxStock) {
        const id = _productId(productId);
        const requested = Number(qty);
        if (id === null || !Number.isInteger(requested)) return { ok: false, reason: "invalid_quantity" };
        if (requested <= 0) return this.removeItem(id);
        if (typeof maxStock === "number" && requested > maxStock) return { ok: false, reason: "exceeds_stock", message: `Chỉ còn ${maxStock} sản phẩm trong kho` };
        if (_currentIsUser()) {
            if (_mergeError) return { ok: false, reason: "merge_failed", message: "Hãy hợp nhất giỏ hàng trước khi chỉnh sửa." };
            const promise = _api(`/api/cart/items/${encodeURIComponent(id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity: requested })
            }).then((result) => {
                const payload = _accountPayload(result);
                _setAccountItems(payload.items);
                return payload;
            }).catch((error) => { _mergeError = error; showToast(error.message, "error"); throw error; });
            return { ok: true, pending: true, promise };
        }
        const items = _load();
        const index = items.findIndex((item) => item.productId === id);
        if (index < 0) return { ok: false, reason: "not_found" };
        items[index].quantity = requested;
        _save(items);
        this.updateBadge();
        return { ok: true };
    },

    clearCart() {
        if (_currentIsUser() && _mergeError) return Promise.reject(new Error("Hãy hợp nhất giỏ hàng trước khi chỉnh sửa."));
        if (_currentIsUser()) return this.clearAccountCart();
        _clearLocal();
        this.updateBadge();
        return Promise.resolve({ ok: true });
    },

    async clearAccountCart() {
        if (!_currentIsUser()) return { ok: true };
        const current = _accountItems.slice();
        for (const item of current) {
            await _api(`/api/cart/items/${encodeURIComponent(item.productId)}`, { method: "DELETE" });
        }
        window.DigiCheckoutState?.clearMergeReport?.();
        _storageRemove("digi_checkout_merge_report_v1");
        _setAccountItems([]);
        return { ok: true };
    },

    async refresh() {
        return _currentIsUser() ? _refreshAccountCart() : _load();
    },

    getCount() {
        return this.getItems().reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    },

    getSubtotal() {
        return this.getItems().reduce((sum, item) => item.available === false ? sum : sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
    },

    getShippingFee() { return SHIPPING_FEE_DEFAULT; },

    updateBadge() {
        const count = this.getCount();
        document.querySelectorAll(".cart-badge").forEach((el) => {
            el.textContent = count > 99 ? "99+" : String(count);
            el.classList.toggle("cart-badge--hidden", count === 0);
        });
    },
    clearForLogout() {
        _clearLocal();
        _accountItems = [];
        _accountReady = false;
        _mergeError = null;
        window.DigiCheckoutState?.clearMergeReport?.();
        _storageRemove("digi_checkout_merge_report_v1");
        _authSession = { authenticated: false, user: null };
        CartService.updateBadge();
    },
};
window.CartService = CartService;

const mergeGuestCartForUser = async (user) => {
    const userId = String(user?.id || "");
    if (!userId) throw new Error("Phiên đăng nhập không hợp lệ");
    _pendingLoginUserId = userId;
    _authSession = { authenticated: true, user };
    window.DigiCheckoutState?.clearMergeReport?.();
    _storageRemove("digi_checkout_merge_report_v1");
    _accountReady = false;
    _mergeError = null;
    const guestItems = _load();
    let result = { items: [], adjustments: [] };
    if (guestItems.length > 0) {
        const context = _getMergeContext(userId, guestItems);
        result = _accountPayload(await _api("/api/cart/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operationId: context.operationId, items: context.items })
        }));
        const report = result.adjustments.map((entry) => ({
            ...entry,
            name: guestItems.find((item) => Number(item.productId) === Number(entry.productId))?.name
        }));
        window.DigiCheckoutState?.saveMergeReport(report);
        _setAccountItems(result.items);
        _clearLocal();
        _clearMergeContext();
    } else {
        await _refreshAccountCart();
    }
    _handledLoginUserId = userId;
    _pendingLoginUserId = null;
    return result;
};

const completeLogin = async (session) => {
    const next = session && typeof session === "object" ? session : window.DigiAuth?.getSession?.();

    const user = next?.user;
    if (!next?.authenticated || !user) throw new Error("Phiên đăng nhập không hợp lệ");

    if (user.role === "admin") {
        _clearLocal();
        _clearMergeContext();
        window.DigiCheckoutState?.clearDraft();
        window.DigiCheckoutState?.clearMergeReport();
        _storageRemove("digi_checkout_merge_report_v1");
        _authSession = { authenticated: true, user };
        _accountItems = [];
        CartService.updateBadge();
        window.location.assign("/admin.html");
        return { ok: true, role: "admin" };
    }

    if (user.role !== "user") throw new Error("Tài khoản không có quyền mua hàng");
    try {
        const result = await mergeGuestCartForUser(user);
        const draft = window.DigiCheckoutState?.readDraft?.();
        const returnPath = draft?.returnPath || window.DigiAuth?.getReturnState?.()?.returnPath;
        window.location.assign(returnPath || "/");
        return { ok: true, role: "user", items: _accountItems.slice(), adjustments: result.adjustments };
    } catch (error) {
        _mergeError = error;
        _accountReady = false;
        _pendingLoginUserId = null;
        // Keep the Guest source and operation context available for an identical retry.
        throw error;
    }
};
const retryMerge = async () => {
    if (!_currentIsUser()) throw new Error("Yêu cầu đăng nhập");
    _pendingLoginUserId = null;
    _handledLoginUserId = null;
    const result = await mergeGuestCartForUser(_authSession.user);
    _mergeError = null;
    return result;
};

const digiCartReady = (async () => {
    if (!window.DigiAuth?.ready) {
        CartService.updateBadge();
        return CartService.getSession();
    }
    try {
        const session = await window.DigiAuth.ready;
        await _handleSession(session);
        // T05 may redirect straight from auth.html to the allowlisted checkout
        // path. In that path this page is the coordinator and must merge before
        // exposing Account cart data, without redirecting a second time.
        if (_currentIsUser() && _load().length > 0 && _handledLoginUserId !== String(_authSession.user?.id || "")) {
            try { await mergeGuestCartForUser(_authSession.user); } catch (error) { _mergeError = error; }
        }
    } catch (error) {
        _mergeError = error;
        _pendingLoginUserId = null;
    }
    CartService.updateBadge();
    return CartService.getSession();
})();


window.DigiCart = Object.freeze({
    completeLogin,
    retryMerge,
    ready: digiCartReady,
    getItems: () => CartService.getItems(),
    getMergeError: () => _mergeError,
    refresh: () => CartService.refresh(),
    isAccountCart: () => CartService.isAccountCart(),
    isAdmin: () => CartService.isAdmin()
});

if (window.DigiAuth?.subscribe) {
    window.DigiAuth.subscribe((session) => { _handleSession(session).catch((error) => { _mergeError = error; }); });
}

function showToast(message, type = "success") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    const icon = document.createElement("span");
    icon.className = "toast__icon";
    icon.textContent = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
    const text = document.createElement("span");
    text.className = "toast__msg";
    text.textContent = String(message || "Đã xảy ra lỗi");
    toast.append(icon, text);
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("toast--show"));
    setTimeout(() => {
        toast.classList.remove("toast--show");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 3000);
}

document.addEventListener("DOMContentLoaded", () => CartService.updateBadge());
