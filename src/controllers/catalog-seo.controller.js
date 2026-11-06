const fs = require("fs");
const path = require("path");
const productService = require("../services/product.service");
const { readAuthConfig } = require("../auth/config");
const renderer = require("../../public/js/catalog-renderer.js");

const categories = { phone: "Điện thoại", tablet: "Máy tính bảng", laptop: "Laptop" };
const tags = { apple: "Apple", samsung: "Samsung", msi: "MSI" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const jsonForHtml = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const origin = () => readAuthConfig().appOrigins[0];
const basePath = path.join(__dirname, "../../public/index.html");
const queryValues = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const buildPage = async (req, res, facetType, slug) => {
    const values = facetType === "category" ? categories : tags;
    const label = values[slug];
    if (!label) return res.status(404).send("Not found");

    const route = facetType === "category" ? `/danh-muc/${slug}` : `/the/${slug}`;
    const categoryFilters = new Set(facetType === "category" ? [slug] : []);
    const tagFilters = new Set(facetType === "tag" ? [label] : []);
    queryValues(req.query.category).forEach((value) => categoryFilters.add(value));
    queryValues(req.query.tag).forEach((value) => tagFilters.add(value));
    const filterKeys = ["q", "sort", "order", "minPrice", "maxPrice"];
    if (["page", ...filterKeys].some((key) => Array.isArray(req.query[key]))) {
        return res.status(400).send("Invalid catalog query");
    }

    const filters = { page: req.query.page, pageSize: 12, category: [...categoryFilters], tag: [...tagFilters] };
    for (const key of filterKeys) if (req.query[key] !== undefined) filters[key] = req.query[key];
    const filtered = [...filterKeys, "category", "tag"].some((key) => req.query[key] !== undefined);
    try {
        const result = await productService.getCatalogPage(filters);
        const actualPage = result.meta.page;
        const canonical = `${origin()}${route}${actualPage > 1 && !filtered ? `?page=${actualPage}` : ""}`;
        const title = `${label} — Sản phẩm công nghệ | NodeShop${actualPage > 1 && !filtered ? ` — Trang ${actualPage}` : ""}`;
        const description = `Khám phá các sản phẩm ${label} tại NodeShop.`;
        const hrefForPage = (number) => {
            const params = new URLSearchParams();
            for (const key of filterKeys) {
                if (req.query[key] !== undefined) params.set(key, String(req.query[key]));
            }
            queryValues(req.query.category).forEach((value) => params.append("category", String(value)));
            queryValues(req.query.tag).forEach((value) => params.append("tag", String(value)));
            if (number > 1) params.set("page", String(number));
            const suffix = params.toString();
            return `${route}${suffix ? `?${suffix}` : ""}`;
        };
        const headLinks = [];
        if (actualPage > 1) headLinks.push(`<link rel="prev" href="${escapeHtml(`${origin()}${hrefForPage(actualPage - 1)}`)}">`);
        if (actualPage < result.meta.totalPages) headLinks.push(`<link rel="next" href="${escapeHtml(`${origin()}${hrefForPage(actualPage + 1)}`)}">`);
        const itemList = {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: result.data.map((product, index) => ({
                "@type": "ListItem",
                position: (actualPage - 1) * result.meta.pageSize + index + 1,
                url: `${origin()}/product_info.html?id=${encodeURIComponent(product.id)}`,
                name: product.name
            }))
        };
        const breadcrumb = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
                { "@type": "ListItem", position: 1, name: "Trang chủ", item: origin() },
                { "@type": "ListItem", position: 2, name: label, item: canonical }
            ]
        };
        const head = `<link rel="canonical" href="${escapeHtml(canonical)}"><meta name="robots" content="${filtered ? "noindex,follow" : "index,follow"}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:type" content="website">${headLinks.join("")}<script type="application/ld+json">${jsonForHtml(itemList)}</script><script type="application/ld+json">${jsonForHtml(breadcrumb)}</script>`;
        const cards = result.data.map((product) => renderer.renderProductCard(product)).join("");
        const emptyState = '<div class="catalog-empty"><h2>Không có sản phẩm phù hợp.</h2></div>';
        const pagination = renderer.renderPagination({
            page: actualPage,
            totalPages: result.meta.totalPages,
            hrefForPage,
            ariaLabel: `Trang ${label}`
        });
        const html = fs.readFileSync(basePath, "utf8")
            .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`)
            .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
            .replace("</head>", `${head}\n</head>`)
            .replace("<h1>Thiết bị công nghệ</h1>", `<h1>${escapeHtml(label)}</h1>`)
            .replace(/<div class="product-grid" id="product-grid">[\s\S]*?(?=<div id="catalog-pagination" class="catalog-pagination">)/, `<div class="product-grid" id="product-grid">${cards || emptyState}</div>\n        `)
            .replace('<div id="catalog-pagination" class="catalog-pagination"></div>', `<div id="catalog-pagination" class="catalog-pagination">${pagination}</div>`);
        return res.type("html").send(html);
    } catch (error) {
        if (Number.isInteger(error.statusCode)) return res.status(error.statusCode).send("Invalid catalog query");
        throw error;
    }
};
exports.category = (req, res) => buildPage(req, res, "category", req.params.category);
exports.tag = (req, res) => buildPage(req, res, "tag", req.params.tag);
exports.robots = (_req, res) => res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${origin()}/sitemap.xml\n`);
exports.sitemap = async (_req, res) => {
    const base = origin();
    const urls = [`${base}/`];
    for (const slug of Object.keys(categories)) {
        const result = await productService.getCatalogPage({ category: [slug], page: 1, pageSize: 12 });
        for (let page = 1; page <= result.meta.totalPages; page++) urls.push(`${base}/danh-muc/${slug}${page > 1 ? `?page=${page}` : ""}`);
    }
    for (const [slug, brand] of Object.entries(tags)) {
        const result = await productService.getCatalogPage({ tag: [brand], page: 1, pageSize: 12 });
        for (let page = 1; page <= result.meta.totalPages; page++) urls.push(`${base}/the/${slug}${page > 1 ? `?page=${page}` : ""}`);
    }
    const products = await productService.getCatalogPage({ page: 1, pageSize: 12 });
    for (let page = 1; page <= products.meta.totalPages; page++) {
        const result = page === 1 ? products : await productService.getCatalogPage({ page, pageSize: 12 });
        for (const product of result.data) urls.push(`${base}/product_info.html?id=${encodeURIComponent(product.id)}`);
    }
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escapeHtml(url)}</loc></url>`).join("")}</urlset>`);
};
