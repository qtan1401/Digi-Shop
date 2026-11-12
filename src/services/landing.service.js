// ===== LANDING SERVICE =====
// The three groups the landing page shows (New products, Best sellers, one strip per device type), cached in this process.

const landingRepository = require("../repositories/landing.repository");
const reviewService = require("./review.service");
const { DEVICE_TYPE_LABELS } = require("../../public/js/catalog-taxonomy");

const NEW_PRODUCTS_LIMIT = 8;
const BEST_SELLERS_LIMIT = 8;
const CATEGORY_LIMIT = 4;
const BEST_SELLER_WINDOW_DAYS = 90;
const CACHE_TTL_MS = 60 * 1000;

let cached = null; // { expiresAt, pending: Promise<highlights> }

const loadHighlights = async () => {
    const since = new Date(Date.now() - BEST_SELLER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const deviceTypes = Object.keys(DEVICE_TYPE_LABELS);
    const [newProducts, bestSellers, ...strips] = await Promise.all([
        landingRepository.findNewest(NEW_PRODUCTS_LIMIT),
        landingRepository.findBestSellers(BEST_SELLERS_LIMIT, since),
        ...deviceTypes.map((deviceType) => landingRepository.findNewest(CATEGORY_LIMIT, deviceType))
    ]);
    const categories = deviceTypes
        .map((deviceType, index) => ({ deviceType, label: DEVICE_TYPE_LABELS[deviceType], products: strips[index] }))
        .filter((category) => category.products.length);
    await reviewService.attachRatings([...newProducts, ...bestSellers, ...categories.flatMap((category) => category.products)]);
    return { newProducts, bestSellers, categories };
};

/** Highlights for the landing page. A failed load is never cached; concurrent callers share one load. */
const getHighlights = () => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.pending;
    const entry = { expiresAt: now + CACHE_TTL_MS, pending: loadHighlights() };
    cached = entry;
    entry.pending.catch(() => { if (cached === entry) cached = null; });
    return entry.pending;
};

const clearCache = () => { cached = null; };

module.exports = { getHighlights, clearCache };
