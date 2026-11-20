// Brand vocabulary and fallback category labels when the public taxonomy endpoint is unavailable.
(function (root, factory) {
    const taxonomy = factory();
    if (typeof module === "object" && module.exports) module.exports = taxonomy;
    if (root) root.CatalogTaxonomy = taxonomy;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
    "use strict";
    const BRANDS = Object.freeze(["Apple", "Samsung", "MSI", "Aula", "Logitech", "Razer", "Keychron", "Asus"]);
    const DEVICE_TYPE_LABELS = Object.freeze({
        laptop: "Laptop",
        keyboard: "Bàn phím",
        mouse: "Chuột",
        headphone: "Tai nghe máy tính",
        monitor: "Màn hình",
        storage: "Ổ cứng SSD"
    });
    const DEVICE_TYPES = Object.freeze(Object.keys(DEVICE_TYPE_LABELS));
    // Brand URLs live under /hang; /the/<brand> redirects there for older links.
    const brandSlug = (brand) => String(brand).toLowerCase();
    const brandFromSlug = (slug) => BRANDS.find((brand) => brandSlug(brand) === String(slug).toLowerCase());
    return { BRANDS, DEVICE_TYPES, DEVICE_TYPE_LABELS, brandSlug, brandFromSlug };
});
