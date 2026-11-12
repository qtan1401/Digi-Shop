const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

process.env.APP_ORIGIN = "https://shop.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";

const { createLandingFake } = require("../test-support/landing-fake");
const { DEVICE_TYPE_LABELS } = require("../public/js/catalog-taxonomy");
const renderer = require("../public/js/catalog-renderer.js");

const fake = createLandingFake();
const db = require("../src/db/prisma");
db.getPrismaClient = () => fake.prisma;
const app = require("../src/app");
const landingService = require("../src/services/landing.service");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12, 8, 0, 0);
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();

let server;
let baseUrl;
let nextProductId;
let nextVariantId;
let nextOrderId;

const addProduct = ({ name, deviceType = "mouse", brand = "Logitech", createdAt = daysAgo(1), prices = [1_000_000], stock = 5, isDeleted = false, activeVariants = true }) => {
    const id = nextProductId++;
    fake.state.products.push({ id, name, deviceType, brand, image: `/img/${id}.png`, description: name, isDeleted, createdAt });
    prices.forEach((price) => fake.state.variants.push({ id: nextVariantId++, productId: id, price, stock, isActive: activeVariants }));
    return id;
};
const variantOf = (productId) => fake.state.variants.find((variant) => variant.productId === productId).id;
const addSale = (productId, quantity, { status = "DELIVERED", createdAt = daysAgo(1) } = {}) => {
    const id = `order-${nextOrderId++}`;
    fake.state.orders.push({ id, orderStatus: status, createdAt });
    fake.state.orderItems.push({ orderId: id, variantId: variantOf(productId), quantity });
};
const addReview = (productId, rating, { isHidden = false } = {}) => fake.state.reviews.push({ productId, rating, isHidden });

const highlights = async () => {
    const response = await fetch(`${baseUrl}/api/landing/highlights`);
    assert.equal(response.status, 200);
    return (await response.json()).data;
};
const names = (list) => list.map((product) => product.name);
const trips = () => fake.calls.queryRaw + fake.calls.findMany + fake.calls.groupBy;

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach((t) => {
    fake.reset();
    nextProductId = 1;
    nextVariantId = 1;
    nextOrderId = 1;
    landingService.clearCache();
    t.mock.method(Date, "now", () => NOW);
});

test("highlights are public and list the newest eight products, newest first, without deleted or unsellable ones", async () => {
    for (let index = 1; index <= 10; index++) addProduct({ name: `P${index}`, createdAt: daysAgo(20 - index) });
    addProduct({ name: "Deleted", createdAt: daysAgo(0), isDeleted: true });
    addProduct({ name: "No active variant", createdAt: daysAgo(0), activeVariants: false });

    const data = await highlights();
    assert.deepEqual(names(data.newProducts), ["P10", "P9", "P8", "P7", "P6", "P5", "P4", "P3"]);
    assert.deepEqual(Object.keys(data).sort(), ["bestSellers", "categories", "newProducts"]);
    const card = data.newProducts[0];
    assert.deepEqual([card.price, card.priceMax, card.stock, card.variantCount], [1_000_000, 1_000_000, 5, 1]);
});

test("products created at the same time are ordered by id, newest id first", async () => {
    addProduct({ name: "Earlier id", createdAt: daysAgo(3) });
    addProduct({ name: "Later id", createdAt: daysAgo(3) });
    assert.deepEqual(names((await highlights()).newProducts), ["Later id", "Earlier id"]);
});

test("best sellers rank by units in the last 90 days and ignore cancelled orders", async () => {
    const recentLow = addProduct({ name: "Recent low" });
    const recentHigh = addProduct({ name: "Recent high" });
    const oldHuge = addProduct({ name: "Old huge" });
    const onlyCancelled = addProduct({ name: "Only cancelled" });
    const mixed = addProduct({ name: "Mixed" });
    addSale(recentLow, 2);
    addSale(recentHigh, 5);
    addSale(oldHuge, 50, { createdAt: daysAgo(200) });
    addSale(onlyCancelled, 99, { status: "CANCELLED" });
    addSale(mixed, 1);
    addSale(mixed, 40, { status: "CANCELLED" });

    const data = await highlights();
    // Recent sales first (5, 2, 1), then the product that only sold long ago fills the list. A cancelled order never counts.
    assert.deepEqual(names(data.bestSellers), ["Recent high", "Recent low", "Mixed", "Old huge"]);
});

test("best sellers are filled from all-time sales when the last 90 days have too few", async () => {
    const recent = addProduct({ name: "Recent" });
    const olderA = addProduct({ name: "Older A" });
    const olderB = addProduct({ name: "Older B" });
    addSale(recent, 1);
    addSale(olderA, 3, { createdAt: daysAgo(120) });
    addSale(olderB, 7, { createdAt: daysAgo(400) });

    assert.deepEqual(names((await highlights()).bestSellers), ["Recent", "Older B", "Older A"]);
});

test("best sellers hold at most eight products", async () => {
    for (let index = 1; index <= 10; index++) addSale(addProduct({ name: `S${index}` }), index);
    const data = await highlights();
    assert.equal(data.bestSellers.length, 8);
    assert.equal(data.bestSellers[0].name, "S10");
});

test("one strip per device type with products: at most four newest, ratings attached, empty types left out", async () => {
    for (let index = 1; index <= 5; index++) addProduct({ name: `Mouse ${index}`, deviceType: "mouse", createdAt: daysAgo(30 - index) });
    for (const [deviceType, name] of [["laptop", "Laptop A"], ["monitor", "Monitor A"], ["keyboard", "Keyboard A"], ["storage", "SSD A"]]) addProduct({ name, deviceType });
    const rated = fake.state.products.find((product) => product.name === "Mouse 5").id;
    addReview(rated, 5);
    addReview(rated, 4);
    addReview(rated, 1, { isHidden: true });

    const data = await highlights();
    const types = data.categories.map((category) => category.deviceType);
    assert.deepEqual(types, ["laptop", "keyboard", "mouse", "monitor", "storage"]);
    assert.deepEqual(data.categories.map((category) => category.label), types.map((type) => DEVICE_TYPE_LABELS[type]));
    assert.ok(data.categories.length >= 3);
    const mouse = data.categories.find((category) => category.deviceType === "mouse");
    assert.deepEqual(names(mouse.products), ["Mouse 5", "Mouse 4", "Mouse 3", "Mouse 2"]);
    assert.deepEqual([mouse.products[0].ratingAverage, mouse.products[0].ratingCount], [4.5, 2]);
    assert.deepEqual([mouse.products[1].ratingAverage, mouse.products[1].ratingCount], [null, 0]);
    // The same product in the New products group carries its rating too.
    assert.equal(data.newProducts.find((product) => product.name === "Mouse 5").ratingAverage, 4.5);
});

test("highlights are cached for 60 seconds, then reloaded", async (t) => {
    addProduct({ name: "First" });
    assert.deepEqual(names((await highlights()).newProducts), ["First"]);
    const afterFirstLoad = trips();
    assert.ok(afterFirstLoad > 0);

    addProduct({ name: "Second", createdAt: daysAgo(0) });
    assert.deepEqual(names((await highlights()).newProducts), ["First"]);
    assert.equal(trips(), afterFirstLoad);

    t.mock.method(Date, "now", () => NOW + 59_000);
    assert.deepEqual(names((await highlights()).newProducts), ["First"]);
    assert.equal(trips(), afterFirstLoad);

    t.mock.method(Date, "now", () => NOW + 61_000);
    assert.deepEqual(names((await highlights()).newProducts), ["Second", "First"]);
});

test("a failed load is not cached", async () => {
    addProduct({ name: "Only" });
    const original = fake.prisma.product.findMany;
    fake.prisma.product.findMany = async () => { throw new Error("database down"); };
    try {
        await assert.rejects(landingService.getHighlights(), /database down/);
    } finally {
        fake.prisma.product.findMany = original;
    }
    assert.deepEqual(names((await highlights()).newProducts), ["Only"]);
});

test("catalog listing filters by minimum rating and rejects invalid values", async () => {
    const five = addProduct({ name: "Five stars" });
    const four = addProduct({ name: "Four stars" });
    const three = addProduct({ name: "Three stars" });
    addProduct({ name: "Unrated" });
    const hiddenLow = addProduct({ name: "Hidden low" });
    addReview(five, 5);
    addReview(four, 4);
    addReview(three, 3);
    addReview(three, null);
    addReview(hiddenLow, 5);
    addReview(hiddenLow, 1, { isHidden: true });

    const list = async (query) => names((await (await fetch(`${baseUrl}/api/products?${query}`)).json()).data);
    assert.deepEqual(await list("minRating=4"), ["Five stars", "Four stars", "Hidden low"]);
    assert.deepEqual(await list("minRating=3"), ["Five stars", "Four stars", "Three stars", "Hidden low"]);
    assert.deepEqual(await list("minRating=5"), ["Five stars", "Hidden low"]);
    assert.equal((await list("")).length, 5);

    const filtered = await (await fetch(`${baseUrl}/api/products?minRating=4`)).json();
    assert.equal(filtered.meta.total, 3);

    for (const bad of ["0", "6", "abc", "3.5", "", "-1", "3&minRating=4"]) {
        const response = await fetch(`${baseUrl}/api/products?minRating=${bad}`);
        assert.equal(response.status, 400, `minRating=${bad}`);
    }
});

test("the landing page is served at / and the catalog is its own page at /catalog.html", async () => {
    const landing = await (await fetch(`${baseUrl}/`)).text();
    assert.match(landing, /id="landing-title"/);
    assert.match(landing, /href="\/css\/landing\.css"/);
    assert.match(landing, /<a href="\/catalog\.html">Sản phẩm<\/a>/);
    assert.doesNotMatch(landing, /id="product-grid"/);

    const catalogResponse = await fetch(`${baseUrl}/catalog.html`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.text();
    assert.match(catalog, /id="product-grid"/);
    assert.match(catalog, /<script src="\/js\/main\.js">/);
    assert.match(catalog, /<a href="\/catalog\.html" aria-current="page">Sản phẩm<\/a>/);
});

test("category and brand pages are rendered from catalog.html and the sitemap lists /catalog.html", async () => {
    addProduct({ name: "Mouse One", deviceType: "mouse" });

    const category = await fetch(`${baseUrl}/danh-muc/mouse`);
    assert.equal(category.status, 200);
    const html = await category.text();
    assert.match(html, /id="product-grid"/);
    assert.doesNotMatch(html, /landing-hero/);
    assert.match(html, /Mouse One/);
    assert.match(html, /aria-current="page">1<\/span>/);

    const brand = await (await fetch(`${baseUrl}/the/logitech`)).text();
    assert.match(brand, /id="product-grid"/);

    const withRating = await fetch(`${baseUrl}/danh-muc/mouse?minRating=4`);
    assert.match(await withRating.text(), /name="robots" content="noindex,follow"/);
    assert.equal((await fetch(`${baseUrl}/danh-muc/mouse?minRating=9`)).status, 400);

    const sitemap = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
    assert.match(sitemap, /<loc>https:\/\/shop\.example\.test\/<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/shop\.example\.test\/catalog\.html<\/loc>/);
});

test("pagination always shows the page number, even for a single page or none", () => {
    for (const options of [{ page: 1, totalPages: 1, total: 5, pageSize: 12 }, { page: 1, totalPages: 0, total: 0, pageSize: 12 }, {}]) {
        const html = renderer.renderPagination(options);
        assert.match(html, /<span class="catalog-pagination__item" aria-current="page">1<\/span>/);
        assert.match(html, /<span class="catalog-pagination__compact">1 \/ 1<\/span>/);
        assert.equal((html.match(/aria-disabled="true"/g) || []).length, 2);
    }
    assert.match(renderer.renderPagination({ page: 1, totalPages: 1, total: 5, pageSize: 12 }), /5 sản phẩm/);
});

test("the catalog page script keeps every filter in the URL and offers the rating chips", () => {
    const source = fs.readFileSync(path.join(__dirname, "../public/js/main.js"), "utf8");
    assert.match(source, /"\/catalog\.html"/);
    assert.match(source, /minRating/);
    assert.match(source, /Từ 4 sao/);
    assert.match(source, /Từ 3 sao/);
});
