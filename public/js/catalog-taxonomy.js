// Danh sách hãng và loại thiết bị của catalog: nguồn duy nhất cho server (validation, SEO, seed) và trình duyệt (bộ lọc, admin).
// Đổi danh sách ở đây thì phải đổi cả hai CHECK constraint `products_brand_check` và `products_device_type_check` bằng migration mới.
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
        headphone: "Tai nghe",
        monitor: "Màn hình",
        storage: "Ổ cứng SSD"
    });
    const DEVICE_TYPES = Object.freeze(Object.keys(DEVICE_TYPE_LABELS));
    // Đường dẫn SEO: /the/<slug hãng> (slug = tên hãng viết thường).
    const brandSlug = (brand) => String(brand).toLowerCase();
    const brandFromSlug = (slug) => BRANDS.find((brand) => brandSlug(brand) === String(slug).toLowerCase());
    return { BRANDS, DEVICE_TYPES, DEVICE_TYPE_LABELS, brandSlug, brandFromSlug };
});
