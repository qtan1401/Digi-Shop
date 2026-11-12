const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { BRANDS, DEVICE_TYPES, DEVICE_TYPE_LABELS } = require("../public/js/catalog-taxonomy");
const jwt = require("jsonwebtoken");
const PNG = require("pngjs").PNG;
const { after, before, beforeEach, test } = require("node:test");
const { encodeColorImageField } = require("../src/middlewares/product-image-upload");

process.env.APP_ORIGIN = "https://catalog.example.test";
process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-more-than-thirty-two-bytes";
process.env.PRODUCT_IMAGE_STORAGE_DIR = path.join(os.tmpdir(), `digi-shop-taxonomy-images-${process.pid}`);

let products;
let productOptions;
let productOptionValues;
let productVariants;
let variantOptionValues;
let audits;
let nextProductId;
let nextOptionId;
let nextOptionValueId;
let nextVariantId;

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === "object" && "contains" in expected) {
        return String(row[key] ?? "").includes(expected.contains);
    }
    if (expected && typeof expected === "object" && "in" in expected) return expected.in.includes(row[key]);
    return row[key] === expected;
});
const includeProduct = (row, include = {}) => {
    const result = clone(row);
    if (include.options) {
        const optionFilter = include.options.where || {};
        result.options = productOptions.filter((option) =>
            option.productId === row.id && matches(option, optionFilter)
        ).map((option) => ({
            ...clone(option),
            values: productOptionValues.filter((value) =>
                value.optionId === option.id && matches(value, include.options.include?.values?.where || {})
            ).map(clone)
        }));
    }
    if (include.variants) {
        const variantFilter = include.variants.where || {};
        result.variants = productVariants.filter((variant) =>
            variant.productId === row.id && matches(variant, variantFilter)
        ).map((variant) => {
            const mapped = clone(variant);
            if (include.variants.include?.optionValues) {
                mapped.optionValues = variantOptionValues
                    .filter((link) => link.variantId === variant.id)
                    .map((link) => {
                        const optionValue = productOptionValues.find((value) => value.id === link.optionValueId);
                        const option = productOptions.find((candidate) => candidate.id === optionValue?.optionId);
                        return {
                            ...clone(link),
                            optionValue: optionValue ? {
                                ...clone(optionValue),
                                option: clone(option)
                            } : null
                        };
                    });
            }
            return mapped;
        });
    }
    return result;
};

const includeVariant = (row, include = {}) => {
    const result = clone(row);
    if (include.product) {
        result.product = clone(products.find((product) => product.id === row.productId));
    }
    if (include.optionValues) {
        result.optionValues = variantOptionValues
            .filter((link) => link.variantId === row.id)
            .map((link) => {
                const optionValue = productOptionValues.find((value) => value.id === link.optionValueId);
                const option = productOptions.find((candidate) => candidate.id === optionValue?.optionId);
                return {
                    ...clone(link),
                    optionValue: optionValue ? { ...clone(optionValue), option: clone(option) } : null
                };
            });
    }
    return result;
};

const fakePrisma = {
    $queryRaw: async (query) => {
        let rows = products.filter((product) => !product.isDeleted).sort((a, b) => a.id - b.id);
        const sql = query.sql || "";
        const values = query.values || [];
        const category = values.find((value) => DEVICE_TYPES.includes(value));
        const brand = values.find((value) => BRANDS.includes(value));
        if (sql.includes("p.device_type IN") && category) rows = rows.filter((product) => product.deviceType === category);
        if (sql.includes("p.brand IN") && brand) rows = rows.filter((product) => product.brand === brand);
        if (sql.includes("COUNT(*) AS total")) return [{ total: rows.length }];
        const pageRows = sql.includes("OFFSET")
            ? rows.slice(Number(values.at(-2)), Number(values.at(-2)) + Number(values.at(-1)))
            : rows;
        return pageRows.map((product) => {
            const prices = productVariants.filter((variant) => variant.productId === product.id && variant.isActive).map((variant) => Number(variant.price));
            return {
                id: product.id,
                min_price: prices.length ? Math.min(...prices) : 0,
                total: rows.length,
                catalog_total: products.filter((candidate) => !candidate.isDeleted).length
            };
        });
    },
    $transaction: async (work) => {
        const previous = {
            products, productOptions, productOptionValues, productVariants, variantOptionValues,
            nextProductId, nextOptionId, nextOptionValueId, nextVariantId
        };
        products = clone(products);
        productOptions = clone(productOptions);
        productOptionValues = clone(productOptionValues);
        productVariants = clone(productVariants);
        variantOptionValues = clone(variantOptionValues);
        try {
            return await work(fakePrisma);
        } catch (error) {
            products = previous.products;
            productOptions = previous.productOptions;
            productOptionValues = previous.productOptionValues;
            productVariants = previous.productVariants;
            variantOptionValues = previous.variantOptionValues;
            nextProductId = previous.nextProductId;
            nextOptionId = previous.nextOptionId;
            nextOptionValueId = previous.nextOptionValueId;
            nextVariantId = previous.nextVariantId;
            throw error;
        }
    },
    product: {
        findMany: async ({ where = {}, include = {}, orderBy, skip = 0, take } = {}) => {
            const rows = products.filter((row) => {
                const direct = Object.fromEntries(Object.entries(where).filter(([key]) => key !== "OR"));
                const directMatch = matches(row, direct);
                const orMatch = !where.OR || where.OR.some((clause) => {
                    if (clause.name?.contains) return String(row.name).includes(clause.name.contains);
                    const skuQuery = clause.variants?.some?.sku?.contains;
                    return skuQuery && productVariants.some((variant) =>
                        variant.productId === row.id && variant.isActive && variant.sku.includes(skuQuery)
                    );
                });
                return directMatch && orMatch;
            }).map((row) => includeProduct(row, include));
            if (orderBy?.id === "asc") rows.sort((a, b) => a.id - b.id);
            rows.splice(0, skip);
            if (take !== undefined) rows.splice(take);
            return rows;
        },
        count: async ({ where = {} } = {}) => products.filter((row) => {
            const direct = Object.fromEntries(Object.entries(where).filter(([key]) => key !== "OR"));
            return matches(row, direct);
        }).length,
        findUnique: async ({ where, include } = {}) => {
            const row = products.find((candidate) => matches(candidate, where));
            return row ? includeProduct(row, include) : null;
        },
        create: async ({ data }) => {
            const row = { id: nextProductId++, ...clone(data) };
            products.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = products.find((candidate) => matches(candidate, where));
            if (!row) throw new Error("product not found");
            Object.assign(row, clone(data));
            return clone(row);
        },
        updateMany: async ({ where, data }) => {
            const row = products.find((candidate) => matches(candidate, where));
            if (!row) return { count: 0 };
            Object.assign(row, clone(data));
            return { count: 1 };
        }
    },
    productOption: {
        findMany: async ({ where = {}, include } = {}) => productOptions.filter((row) => matches(row, where)).map((row) => ({
            ...clone(row),
            ...(include?.values ? { values: productOptionValues.filter((value) => value.optionId === row.id).map(clone) } : {})
        })),
        create: async ({ data }) => {
            const row = { id: nextOptionId++, ...clone(data) };
            productOptions.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = productOptions.find((candidate) => matches(candidate, where));
            if (!row) throw new Error("product option not found");
            Object.assign(row, clone(data));
            return clone(row);
        }
    },
    productOptionValue: {
        create: async ({ data }) => {
            const row = { id: nextOptionValueId++, ...clone(data) };
            productOptionValues.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = productOptionValues.find((candidate) => matches(candidate, where));
            if (!row) throw new Error("product option value not found");
            Object.assign(row, clone(data));
            return clone(row);
        }
    },
    productVariant: {
        findMany: async ({ where = {}, take, include } = {}) => {
            const rows = productVariants.filter((row) => matches(row, where));
            if (take !== undefined) rows.splice(take);
            return rows.map((row) => includeVariant(row, include));
        },
        findUnique: async ({ where = {}, include } = {}) => {
            const key = where.productId_combinationKey;
            const row = productVariants.find((candidate) =>
                key
                    ? candidate.productId === key.productId && candidate.combinationKey === key.combinationKey
                    : matches(candidate, where)
            );
            return row ? includeVariant(row, include) : null;
        },
        create: async ({ data }) => {
            const row = { id: nextVariantId++, ...clone(data) };
            productVariants.push(row);
            return clone(row);
        },
        update: async ({ where, data }) => {
            const row = productVariants.find((candidate) => matches(candidate, where));
            if (!row) throw new Error("product variant not found");
            Object.assign(row, clone(data));
            return clone(row);
        }
    },
    productVariantOptionValue: {
        create: async ({ data }) => {
            const row = clone(data);
            variantOptionValues.push(row);
            return row;
        },
        deleteMany: async ({ where = {} }) => {
            const before = variantOptionValues.length;
            variantOptionValues = variantOptionValues.filter((row) => !matches(row, where));
            return { count: before - variantOptionValues.length };
        }
    },
    productReview: {
        groupBy: async () => []
    },
    user: {
        findUnique: async ({ where }) => where.id === "catalog-admin"
            ? { id: "catalog-admin", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false }
            : null
    },
    auditLog: {
        findMany: async ({ take } = {}) => audits.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, take),
        count: async () => audits.length,
        create: async ({ data }) => {
            const row = clone(data);
            audits.push(row);
            return row;
        }
    }
};

const db = require("../src/db/prisma");
db.getPrismaClient = () => fakePrisma;
const app = require("../src/app");

let server;
let baseUrl;
const accessToken = jwt.sign(
    { type: "access", ver: 1, role: "admin" },
    process.env.JWT_ACCESS_SECRET,
    { subject: "catalog-admin", expiresIn: "10m" }
);
const productInput = (overrides = {}) => ({
    name: "Logitech MX Master 3S",
    brand: "Logitech",
    deviceType: "mouse",
    sku: "MXM3S-GR",
    price: 999,
    stock: 7,
    image: "https://catalog.example.test/mouse.png",
    description: "A new mouse",
    ...overrides
});

const productPng = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) });

const createProduct = (input) => {
    const body = new FormData();
    const { sku, price, stock, ...metadata } = input;
    for (const [field, value] of Object.entries(metadata)) {
        if (value !== undefined && value !== null) body.append(field, String(value));
    }
    body.append("options", JSON.stringify([]));
    body.append("variants", JSON.stringify([{
        sku,
        price: Number(price),
        stock: Number(stock),
        optionValues: {}
    }]));
    body.append("image", new Blob([productPng], { type: "image/png" }), "product.png");
    return fetch(`${baseUrl}/api/admin/products`, {
        method: "POST",
        headers: {
            Cookie: `__Host-access_token=${accessToken}; __Host-csrf_token=catalog-csrf`,
            Origin: process.env.APP_ORIGIN,
            "X-CSRF-Token": "catalog-csrf"
        },
        body
    });
};
const createProductWithVariants = ({ metadata = {}, options, variants, colorImages = {} }) => {
    const body = new FormData();
    const fields = {
        name: "Logitech MX Keys S",
        brand: "Logitech",
        deviceType: "keyboard",
        description: "Keyboard with selectable configurations",
        ...metadata
    };
    for (const [field, value] of Object.entries(fields)) body.append(field, String(value));
    body.append("options", JSON.stringify(options));
    body.append("variants", JSON.stringify(variants));
    body.append("image", new Blob([productPng], { type: "image/png" }), "product.png");
    for (const [colorValue, buffer] of Object.entries(colorImages)) {
        body.append(encodeColorImageField(colorValue), new Blob([buffer], { type: "image/png" }), `${colorValue}.png`);
    }
    return fetch(`${baseUrl}/api/admin/products`, {
        method: "POST",
        headers: {
            Cookie: `__Host-access_token=${accessToken}; __Host-csrf_token=catalog-csrf`,
            Origin: process.env.APP_ORIGIN,
            "X-CSRF-Token": "catalog-csrf"
        },
        body
    });
};

test("admin creates purchasable variants and product detail returns their option combinations", async () => {
    const options = [
        { name: "Màu sắc", values: [{ value: "Đen", colorHex: "#1C1C1E" }, { value: "Trắng", colorHex: "#F5F5F0" }] },
        { name: "Dung lượng", values: [{ value: "128GB", colorHex: null }, { value: "256GB", colorHex: null }] }
    ];
    const variants = [
        { sku: "GS-BLK-128", price: 10_000_000, stock: 3, options: { "Màu sắc": "Đen", "Dung lượng": "128GB" } },
        { sku: "GS-WHT-256", price: 10_100_000, stock: 4, options: { "Màu sắc": "Trắng", "Dung lượng": "256GB" } }
    ];
    const colorImages = {
        "Đen": PNG.sync.write({ width: 1, height: 1, data: Buffer.from([0, 0, 0, 255]) }),
        "Trắng": PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 255, 255, 255]) })
    };
    const createResponse = await createProductWithVariants({ options, variants, colorImages });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).data;
    assert.equal(created.variants.length, 2);
    assert.deepEqual(created.options, options);
    assert.match(created.variants[0].image, /^\/uploads\/products\/[a-f0-9-]+\.png$/);
    assert.notEqual(created.variants[0].image, created.variants[1].image);
    assert.deepEqual(
        created.variants.map(({ sku, price, stock, optionValues }) => ({ sku, price, stock, optionValues })),
        [
            { sku: "GS-BLK-128", price: 10_000_000, stock: 3, optionValues: { "Màu sắc": "Đen", "Dung lượng": "128GB" } },
            { sku: "GS-WHT-256", price: 10_100_000, stock: 4, optionValues: { "Màu sắc": "Trắng", "Dung lượng": "256GB" } }
        ]
    );

    const detailResponse = await fetch(`${baseUrl}/api/products/info/${created.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()).data;
    assert.deepEqual(detail.variants.map((variant) => variant.sku), ["GS-BLK-128", "GS-WHT-256"]);
    assert.equal(detail.price, 10_000_000);
    assert.equal(detail.stock, 7);
});
test("admin rejects a color configuration without a photo for every color", async () => {
    await fs.rm(process.env.PRODUCT_IMAGE_STORAGE_DIR, { recursive: true, force: true });
    const response = await createProductWithVariants({
        metadata: { name: "Incomplete color photos" },
        options: [
            { name: "Màu sắc", values: [{ value: "Đen", colorHex: "#1C1C1E" }, { value: "Trắng", colorHex: "#F5F5F0" }] },
            { name: "Bộ nhớ", values: [{ value: "128GB" }] }
        ],
        variants: [
            { sku: "GS-BLK-128", price: 10_000_000, stock: 3, options: { "Màu sắc": "Đen", "Bộ nhớ": "128GB" } },
            { sku: "GS-WHT-128", price: 10_100_000, stock: 4, options: { "Màu sắc": "Trắng", "Bộ nhớ": "128GB" } }
        ],
        colorImages: { "Đen": productPng }
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.ok(payload.errors.some((error) => error.field === "colorImages"));

    const catalogResponse = await fetch(`${baseUrl}/api/products`);
    assert.equal(catalogResponse.status, 200);
    assert.deepEqual((await catalogResponse.json()).data, []);
    assert.deepEqual(await fs.readdir(process.env.PRODUCT_IMAGE_STORAGE_DIR), []);
});


test("cart validation prices the selected variant and maps legacy product IDs only when unambiguous", async () => {
    const options = [{ name: "Color", values: ["Red", "Blue"] }];
    const variantResponse = await createProductWithVariants({
        options,
        variants: [
            { sku: "GS-RED", price: 500, stock: 3, optionValues: { Color: "Red" } },
            { sku: "GS-BLUE", price: 1000, stock: 4, optionValues: { Color: "Blue" } }
        ]
    });
    assert.equal(variantResponse.status, 201);
    const product = (await variantResponse.json()).data;

    const defaultResponse = await createProduct(productInput({ sku: "DEFAULT-1" }));
    assert.equal(defaultResponse.status, 201);
    const defaultProduct = (await defaultResponse.json()).data;

    const response = await fetch(`${baseUrl}/api/cart/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            items: [
                { variantId: product.variants[0].id, quantity: 2 },
                { productId: product.id, quantity: 1 },
                { productId: defaultProduct.id, quantity: 1 }
            ]
        })
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).data;
    assert.deepEqual(
        {
            variantId: result.validatedItems[0].variantId,
            sku: result.validatedItems[0].sku,
            price: result.validatedItems[0].price,
            stock: result.validatedItems[0].stock,
            optionValues: result.validatedItems[0].optionValues,
            lineTotal: result.validatedItems[0].lineTotal
        },
        {
            variantId: product.variants[0].id,
            sku: "GS-RED",
            price: 500,
            stock: 3,
            optionValues: { Color: "Red" },
            lineTotal: 1000
        }
    );
    assert.equal(result.validatedItems[1].available, false);
    assert.equal(result.validatedItems[1].unavailableReason, "legacy_variant_unavailable");
    assert.equal(result.validatedItems[1].variantId, undefined);
    assert.equal(result.validatedItems[2].variantId, defaultProduct.variants[0].id);
    assert.equal(result.validatedItems[2].available, true);
    assert.equal(result.hasUnavailable, true);
});

const adminHeaders = {
    Cookie: `__Host-access_token=${accessToken}; __Host-csrf_token=catalog-csrf`,
    Origin: process.env.APP_ORIGIN,
    "Content-Type": "application/json",
    "X-CSRF-Token": "catalog-csrf"
};

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(process.env.PRODUCT_IMAGE_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
    products = [];
    productOptions = [];
    productOptionValues = [];
    productVariants = [];
    variantOptionValues = [];
    audits = [];
    nextProductId = 1;
    nextOptionId = 1;
    nextOptionValueId = 1;
    nextVariantId = 1;
});

test("admin creates supported taxonomy and public listing returns both fields", async () => {
    const created = await createProduct(productInput());
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(createdPayload.data.brand, "Logitech");
    assert.equal(createdPayload.data.deviceType, "mouse");

    const response = await fetch(`${baseUrl}/api/products`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(
        { brand: payload.data[0].brand, deviceType: payload.data[0].deviceType },
        { brand: "Logitech", deviceType: "mouse" }
    );
    assert.deepEqual(payload.meta, { page: 1, pageSize: 12, total: 1, totalPages: 1, catalogTotal: 1 });
});

test("public catalog validates pagination and returns stable empty-page metadata", async () => {
    const invalid = await fetch(`${baseUrl}/api/products?page=0`);
    assert.equal(invalid.status, 400);

    const response = await fetch(`${baseUrl}/api/products?page=99&pageSize=48`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.meta, { page: 1, pageSize: 48, total: 0, totalPages: 1, catalogTotal: 0 });
});

test("public catalog applies page size and clamps a non-empty out-of-range page", async () => {
    await createProduct(productInput({ name: "Mouse Alpha", sku: "MOUSE-ALPHA" }));
    await createProduct(productInput({ name: "Mouse Beta", sku: "MOUSE-BETA" }));
    await createProduct(productInput({ name: "Monitor Gamma", sku: "MON-GAMMA", brand: "Samsung", deviceType: "monitor" }));
    const response = await fetch(`${baseUrl}/api/products?page=99&pageSize=1&category=mouse&tag=Logitech&sort=name&order=asc`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.meta, { page: 2, pageSize: 1, total: 2, totalPages: 2, catalogTotal: 3 });
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].name, "Mouse Beta");

    const invalidFilter = await fetch(`${baseUrl}/api/products?category=watch`);
    assert.equal(invalidFilter.status, 400);
    const invalidSearch = await fetch(`${baseUrl}/api/products?q=${"x".repeat(121)}`);
    assert.equal(invalidSearch.status, 400);
});

test("admin catalog pages non-empty results and clamps to the last page", async () => {
    await createProduct(productInput({ name: "Admin Alpha", sku: "ADMIN-ALPHA" }));
    await createProduct(productInput({ name: "Admin Beta", sku: "ADMIN-BETA" }));

    const response = await fetch(`${baseUrl}/api/admin/products?page=99&pageSize=1`, { headers: adminHeaders });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.meta, { page: 2, pageSize: 1, total: 2, totalPages: 2 });
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0].name, "Admin Beta");
});

test("admin product listing returns paginated metadata", async () => {
    const response = await fetch(`${baseUrl}/api/admin/products?page=1&pageSize=10`, { headers: adminHeaders });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.meta, { page: 1, pageSize: 10, total: 0, totalPages: 1 });
});

test("audit panel requests and returns only the first eight logs", async () => {
    audits = Array.from({ length: 10 }, (_, index) => ({
        id: `AUD-${index}`,
        actor: "admin",
        action: "CREATE",
        entity: "product",
        entityId: String(index),
        changesJson: "null",
        timestamp: new Date(Date.UTC(2026, 0, index + 1))
    }));
    // The audit log view is an admin extra: hidden (404) unless ADMIN_EXTRAS is on.
    const hidden = await fetch(`${baseUrl}/api/admin/audit-logs`, { headers: adminHeaders });
    assert.equal(hidden.status, 404);
    process.env.ADMIN_EXTRAS = "1";
    try {
        const response = await fetch(`${baseUrl}/api/admin/audit-logs`, { headers: adminHeaders });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.data.length, 8);
        assert.equal(payload.total, 10);
    } finally {
        delete process.env.ADMIN_EXTRAS;
    }
});
test("category and brand pages render server-side with canonical pagination and sitemap entries", async () => {
    for (let index = 1; index <= 13; index++) {
        const response = await createProduct(productInput({
            name: `Mouse ${String(index).padStart(2, "0")}`,
            sku: `MOUSE-${index}`
        }));
        assert.equal(response.status, 201);
    }

    const categoryPageOne = await fetch(`${baseUrl}/danh-muc/mouse`);
    assert.equal(categoryPageOne.status, 200);
    const categoryHtml = await categoryPageOne.text();
    assert.equal((categoryHtml.match(/<title>/g) || []).length, 1);
    assert.match(categoryHtml, /<title>Chuột — Sản phẩm công nghệ \| NodeShop<\/title>/);
    assert.match(categoryHtml, /rel="canonical" href="https:\/\/catalog\.example\.test\/danh-muc\/mouse"/);
    assert.match(categoryHtml, /name="robots" content="index,follow"/);
    assert.match(categoryHtml, /aria-current="page">1<\/span>/);
    assert.match(categoryHtml, /href="\/danh-muc\/mouse\?page=2"/);
    assert.equal((categoryHtml.match(/class="product-card"/g) || []).length, 12);

    const categoryPageTwo = await fetch(`${baseUrl}/danh-muc/mouse?page=2`);
    assert.equal(categoryPageTwo.status, 200);
    const pageTwoHtml = await categoryPageTwo.text();
    assert.match(pageTwoHtml, /rel="canonical" href="https:\/\/catalog\.example\.test\/danh-muc\/mouse\?page=2"/);
    assert.match(pageTwoHtml, /rel="prev" href="https:\/\/catalog\.example\.test\/danh-muc\/mouse"/);
    assert.match(pageTwoHtml, /Mouse 13/);
    assert.match(pageTwoHtml, /aria-current="page">2<\/span>/);

    const filtered = await fetch(`${baseUrl}/danh-muc/mouse?tag=Logitech&sort=name&order=asc`);
    const filteredHtml = await filtered.text();
    assert.match(filteredHtml, /name="robots" content="noindex,follow"/);
    assert.match(filteredHtml, /rel="canonical" href="https:\/\/catalog\.example\.test\/danh-muc\/mouse"/);
    assert.match(filteredHtml, /href="\/danh-muc\/mouse\?sort=name&amp;order=asc&amp;tag=Logitech&amp;page=2"/);

    const brandPage = await fetch(`${baseUrl}/the/logitech?page=2`);
    assert.equal(brandPage.status, 200);
    assert.match(await brandPage.text(), /rel="canonical" href="https:\/\/catalog\.example\.test\/the\/logitech\?page=2"/);

    const emptyPage = await fetch(`${baseUrl}/danh-muc/monitor`);
    const emptyHtml = await emptyPage.text();
    assert.equal(emptyPage.status, 200);
    assert.match(emptyHtml, /aria-current="page">1<\/span>/);
    assert.match(emptyHtml, /Không có sản phẩm phù hợp/);

    const robots = await fetch(`${baseUrl}/robots.txt`);
    assert.match(await robots.text(), /Sitemap: https:\/\/catalog\.example\.test\/sitemap\.xml/);
    const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
    const sitemapXml = await sitemap.text();
    assert.equal(sitemap.status, 200);
    assert.match(sitemapXml, /https:\/\/catalog\.example\.test\/danh-muc\/mouse\?page=2/);
    assert.match(sitemapXml, /https:\/\/catalog\.example\.test\/the\/logitech\?page=2/);
    assert.equal((sitemapXml.match(/product_info\.html\?id=/g) || []).length, 13);
});

test("every supported device type and brand has a server-rendered page and anything else is not found", async () => {
    for (const [slug, label] of Object.entries(DEVICE_TYPE_LABELS)) {
        const response = await fetch(`${baseUrl}/danh-muc/${slug}`);
        assert.equal(response.status, 200, slug);
        assert.match(await response.text(), new RegExp(`<h1>${label}</h1>`), slug);
    }
    for (const brand of ["Apple", "Samsung", "MSI", "Aula", "Logitech", "Razer", "Keychron", "Asus"]) {
        const response = await fetch(`${baseUrl}/the/${brand.toLowerCase()}`);
        assert.equal(response.status, 200, brand);
        assert.match(await response.text(), new RegExp(`<h1>${brand}</h1>`), brand);
    }
    for (const path of ["/danh-muc/phone", "/danh-muc/tablet", "/the/google"]) {
        assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
    }
});


test("public product detail API returns the product identified by its numeric ID", async () => {
    const createResponse = await createProduct(productInput());
    assert.equal(createResponse.status, 201);

    const response = await fetch(`${baseUrl}/api/products/info/1`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(
        {
            id: payload.data.id,
            slug: payload.data.slug,
            name: payload.data.name,
            brand: payload.data.brand,
            deviceType: payload.data.deviceType,
            price: payload.data.price,
            stock: payload.data.stock,
            description: payload.data.description
        },
        {
            id: 1,
            slug: "logitech-mx-master-3s",
            name: "Logitech MX Master 3S",
            brand: "Logitech",
            deviceType: "mouse",
            price: 999,
            stock: 7,
            description: "A new mouse"
        }
    );
    assert.match(payload.data.image, /^\/uploads\/products\/[a-f0-9-]+\.png$/);
});

test("product create reports missing and unsupported taxonomy with field errors", async () => {
    for (const [input, field] of [
        [productInput({ brand: "Google" }), "brand"],
        [productInput({ deviceType: "phone" }), "deviceType"],
        [productInput({ brand: undefined }), "brand"],
        [productInput({ deviceType: undefined }), "deviceType"]
    ]) {
        const response = await createProduct(input);
        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.ok(payload.errors.some((error) => error.field === field));
    }
    const seeded = await createProduct(productInput());
    assert.equal(seeded.status, 201);
    const seededProduct = (await seeded.json()).data;
    for (const [changes, field] of [
        [{ brand: "Google" }, "brand"],
        [{ deviceType: "tablet" }, "deviceType"],
        [{ brand: null }, "brand"],
        [{ deviceType: null }, "deviceType"]
    ]) {
        const response = await fetch(`${baseUrl}/api/admin/products/${seededProduct.id}`, {
            method: "PUT", headers: adminHeaders, body: JSON.stringify(changes)
        });
        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.ok(payload.errors.some((error) => error.field === field));
    }
});

test("product update accepts a different supported brand and device type", async () => {
    const seeded = await createProduct(productInput());
    assert.equal(seeded.status, 201);
    const { id } = (await seeded.json()).data;
    const response = await fetch(`${baseUrl}/api/admin/products/${id}`, {
        method: "PUT", headers: adminHeaders,
        body: JSON.stringify({ brand: "MSI", deviceType: "laptop" })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.brand, "MSI");
    assert.equal(payload.data.deviceType, "laptop");
});

test("every supported brand and device type persists through HTTP", async () => {
    let sequence = 0;
    for (const brand of BRANDS) {
        for (const deviceType of DEVICE_TYPES) {
            sequence += 1;
            const response = await createProduct(productInput({ name: `${brand} ${deviceType}`, brand, deviceType, sku: `ANY-${sequence}` }));
            assert.equal(response.status, 201, `${brand}/${deviceType}`);
            const payload = await response.json();
            assert.deepEqual({ brand: payload.data.brand, deviceType: payload.data.deviceType }, { brand, deviceType });
        }
    }
});

test("unsupported taxonomy errors name the current supported values", async () => {
    const response = await createProduct(productInput({ brand: "Google", deviceType: "phone" }));
    assert.equal(response.status, 400);
    const { errors } = await response.json();
    assert.equal(errors.find((error) => error.field === "brand").message, "Thương hiệu phải là Apple, Samsung, MSI, Aula, Logitech, Razer, Keychron hoặc Asus");
    assert.equal(errors.find((error) => error.field === "deviceType").message, "Loại thiết bị phải là laptop, keyboard, mouse, headphone, monitor hoặc storage");
});

test("a deleted product of a retired device type cannot be restored", async () => {
    const { id } = (await (await createProduct(productInput())).json()).data;
    Object.assign(products.find((row) => row.id === id), { deviceType: "phone", isDeleted: true });
    const response = await fetch(`${baseUrl}/api/admin/products/${id}/restore`, { method: "POST", headers: adminHeaders });
    assert.equal(response.status, 409);
    assert.equal(products.find((row) => row.id === id).isDeleted, true);
});

test("legacy category APIs are no longer mounted", async () => {
    const publicResponse = await fetch(`${baseUrl}/api/categories`);
    assert.equal(publicResponse.status, 404);
    const adminResponse = await fetch(`${baseUrl}/api/admin/categories`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ name: "Accessories" })
    });
    assert.equal(adminResponse.status, 404);
});
