// ===== CHECKOUT-STATE.JS =====
// Same-tab checkout draft, merge report, and redirect safety helpers.
// Drafts intentionally never contain passwords, access tokens, or refresh tokens.

(() => {
    const DRAFT_KEY = "digi_checkout_draft_v2";
    const EXPIRED_KEY = "digi_checkout_draft_expired_v2";
    const MERGE_REPORT_KEY = "digi_checkout_merge_report_v2";
    const DRAFT_VERSION = 2;
    const DRAFT_TTL_MS = 30 * 60 * 1000;
    const ALLOWED_PAYMENT_METHODS = new Set(["COD", "BANKING", "MOMO", "VNPAY"]);

    const storageGet = (key) => {
        try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
    };
    const storageSet = (key, value) => {
        try { window.sessionStorage.setItem(key, value); return true; } catch (_) { return false; }
    };
    const storageRemove = (key) => {
        try { window.sessionStorage.removeItem(key); } catch (_) { /* storage can be disabled */ }
    };

    const toInteger = (value) => {
        const number = Number(value);
        return Number.isSafeInteger(number) ? number : null;
    };

    const normalizeMode = (mode) => mode === "buy-now" ? "buy-now" : mode === "cart" ? "cart" : null;

    const normalizeReturnPath = (path) => {
        if (typeof path !== "string" || !path.startsWith("/checkouts.html")) return null;
        const parsed = new URL(path, window.location.origin);
        if (parsed.origin !== window.location.origin || parsed.pathname !== "/checkouts.html") return null;
        const source = parsed.searchParams.get("source");
        const id = parsed.searchParams.get("id");
        const variantId = parsed.searchParams.get("variantId");
        if (source === "cart" && parsed.searchParams.size === 1) return "/checkouts.html?source=cart";
        if (id && /^\d+$/.test(id) && variantId && /^\d+$/.test(variantId) && parsed.searchParams.size === 2) {
            return `/checkouts.html?id=${Number(id)}&variantId=${Number(variantId)}`;
        }
        return null;
    };

    const currentReturnPath = (mode, productId, variantId) => {
        if (mode === "cart") return "/checkouts.html?source=cart";
        const product = toInteger(productId);
        const variant = toInteger(variantId);
        return product !== null && product > 0 && variant !== null && variant > 0
            ? `/checkouts.html?id=${product}&variantId=${variant}`
            : null;
    };

    const normalizeItem = (item) => {
        if (!item || typeof item !== "object") return null;
        const variantId = toInteger(item.variantId);
        const productId = toInteger(item.productId);
        const quantity = toInteger(item.quantity);
        if (variantId === null || variantId <= 0 || quantity === null || quantity <= 0) return null;
        return {
            variantId,
            ...(productId !== null && productId > 0 ? { productId } : {}),
            quantity,
            name: typeof item.name === "string" ? item.name.slice(0, 240) : "Sản phẩm",
            image: typeof item.image === "string" ? item.image.slice(0, 1000) : "",
            description: typeof item.description === "string" ? item.description.slice(0, 1000) : "",
            variantLabel: typeof item.variantLabel === "string" ? item.variantLabel.slice(0, 240) : "",
            sku: typeof item.sku === "string" ? item.sku.slice(0, 100) : "",
            optionValues: item.optionValues && typeof item.optionValues === "object" ? item.optionValues : {},
            price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
            stock: Number.isFinite(Number(item.stock)) ? Number(item.stock) : undefined,
            available: item.available !== false,
            unavailableReason: typeof item.unavailableReason === "string" ? item.unavailableReason.slice(0, 120) : undefined
        };
    };

    const normalizeForm = (form = {}) => ({
        customerName: typeof form.customerName === "string" ? form.customerName.slice(0, 200) : "",
        customerPhone: typeof form.customerPhone === "string" ? form.customerPhone.slice(0, 40) : "",
        customerAddress: typeof form.customerAddress === "string" ? form.customerAddress.slice(0, 500) : "",
        paymentMethod: ALLOWED_PAYMENT_METHODS.has(form.paymentMethod) ? form.paymentMethod : "COD",
        note: typeof form.note === "string" ? form.note.slice(0, 500) : ""
    });

    const normalizeDraft = (draft) => {
        if (!draft || typeof draft !== "object" || draft.version !== DRAFT_VERSION) return null;
        const returnPath = normalizeReturnPath(draft.returnPath);
        const mode = normalizeMode(draft.mode);
        const createdAt = Number(draft.createdAt);
        const expiresAt = Number(draft.expiresAt);
        if (!returnPath || !mode || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
        const cartSnapshot = Array.isArray(draft.cartSnapshot) ? draft.cartSnapshot.map(normalizeItem).filter(Boolean) : [];
        const variantId = mode === "buy-now" ? toInteger(draft.variantId) : null;
        const productId = mode === "buy-now" ? toInteger(draft.productId) : null;
        if (mode === "buy-now" && (!productId || productId <= 0 || !variantId || variantId <= 0)) return null;
        return {
            version: DRAFT_VERSION,
            createdAt,
            expiresAt,
            returnPath,
            mode,
            ...(productId ? { productId, variantId } : {}),
            cartSnapshot,
            form: normalizeForm(draft.form)
        };
    };

    const readDraft = () => {
        const raw = storageGet(DRAFT_KEY);
        if (!raw) return null;
        try {
            const draft = normalizeDraft(JSON.parse(raw));
            if (!draft) {
                storageRemove(DRAFT_KEY);
                storageSet(EXPIRED_KEY, "1");
            }
            return draft;
        } catch (_) {
            storageRemove(DRAFT_KEY);
            storageSet(EXPIRED_KEY, "1");
            return null;
        }
    };

    const saveDraft = ({ mode, productId, variantId, cartSnapshot, form, returnPath } = {}) => {
        const normalizedMode = normalizeMode(mode);
        const safeReturnPath = normalizeReturnPath(returnPath) || currentReturnPath(normalizedMode, productId, variantId);
        if (!normalizedMode || !safeReturnPath) return null;
        const now = Date.now();
        const normalizedVariantId = normalizedMode === "buy-now" ? toInteger(variantId) : null;
        const normalizedProductId = normalizedMode === "buy-now" ? toInteger(productId) : null;
        const draft = {
            version: DRAFT_VERSION,
            createdAt: now,
            expiresAt: now + DRAFT_TTL_MS,
            returnPath: safeReturnPath,
            mode: normalizedMode,
            ...(normalizedMode === "buy-now" ? { productId: normalizedProductId, variantId: normalizedVariantId } : {}),
            cartSnapshot: Array.isArray(cartSnapshot) ? cartSnapshot.map(normalizeItem).filter(Boolean) : [],
            form: normalizeForm(form)
        };
        if (normalizedMode === "buy-now" && (!draft.productId || draft.productId <= 0 || !draft.variantId || draft.variantId <= 0)) return null;
        return storageSet(DRAFT_KEY, JSON.stringify(draft)) ? draft : null;
    };

    const clearDraft = () => {
        storageRemove(DRAFT_KEY);
        storageRemove(EXPIRED_KEY);
    };

    const takeExpiredNotice = () => {
        const present = storageGet(EXPIRED_KEY) === "1";
        storageRemove(EXPIRED_KEY);
        return present;
    };

    const saveMergeReport = (report, ownerId) => {
        const adjustments = Array.isArray(report) ? report : report?.adjustments;
        if (!Array.isArray(adjustments)) return;
        const safe = adjustments.map((entry) => {
            const variantId = toInteger(entry?.variantId);
            const requestedQuantity = toInteger(entry?.requestedQuantity);
            const finalQuantity = toInteger(entry?.finalQuantity);
            if (variantId === null || requestedQuantity === null || finalQuantity === null) return null;
            return {
                variantId,
                requestedQuantity,
                finalQuantity,
                reason: typeof entry.reason === "string" ? entry.reason.slice(0, 80) : "adjusted",
                ...(typeof entry.name === "string" ? { name: entry.name.slice(0, 240) } : {})
            };
        }).filter(Boolean);
        storageSet(MERGE_REPORT_KEY, JSON.stringify({ version: 2, adjustments: safe, userId: typeof ownerId === "string" ? ownerId : "", createdAt: Date.now() }));
    };

    const readMergeReport = () => {
        const raw = storageGet(MERGE_REPORT_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
        } catch (_) {
            return [];
        }
    };

    const clearMergeReport = () => storageRemove(MERGE_REPORT_KEY);
    const removeMergeAdjustment = (variantId) => {
        const id = toInteger(variantId);
        if (id === null) return;
        const adjustments = readMergeReport().filter((entry) => entry.variantId !== id);
        if (!adjustments.length) return clearMergeReport();
        storageSet(MERGE_REPORT_KEY, JSON.stringify({ version: 2, adjustments, createdAt: Date.now() }));
    };


    window.DigiCheckoutState = Object.freeze({
        DRAFT_KEY,
        DRAFT_VERSION,
        DRAFT_TTL_MS,
        currentReturnPath,
        normalizeReturnPath,
        readDraft,
        saveDraft,
        clearDraft,
        takeExpiredNotice,
        saveMergeReport,
        readMergeReport,
        clearMergeReport,
        removeMergeAdjustment,
        normalizeItem,
        normalizeForm
    });
})();
