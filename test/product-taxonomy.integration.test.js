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
let categories;
let tags;
let productTags;
let retireCategoryOnLock;
let nextProductId;
let nextOptionId;
let nextOptionValueId;
let nextVariantId;

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === "object" && "contains" in expected) {
        // PostgreSQL LIKE '%value%' with the default backslash escape: unescaped % and _ stay wildcards.
        const source = expected.contains.replace(/\\(.)|(%)|(_)|[.*+?^${}()|[\]\\]/g, (match, escaped, percent, underscore) =>
            escaped !== undefined ? escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : percent ? "[\\s\\S]*" : underscore ? "[\\s\\S]" : `\\${match}`);
        return new RegExp(source, expected.mode === "insensitive" ? "i" : "").test(String(row[key] ?? ""));
    }
    if (expected && typeof expected === "object" && "in" in expected) return expected.in.includes(row[key]);
    return row[key] === expected;
});
const includeProduct = (row, include = {}) => {
    const result = clone(row);
    if (include.category) result.category = clone(categories.find((category) => category.id === row.categoryId));
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
    $queryRaw: async (query, ...parameters) => {
        const sql = query.sql || query.join?.("?") || "";
        const values = query.values || parameters;
        if (sql.includes("FOR UPDATE")) {
            if (sql.includes("FROM categories") && retireCategoryOnLock) {
                categories.find(({ id }) => id === parameters[0]).isDeleted = true;
            }
            return [{ id: values[0] }];
        }
        let rows = products.filter((product) => !product.isDeleted).sort((a, b) => a.id - b.id);
        const category = values.find((value) => categories.some(({ slug }) => slug === value));
        const brand = values.find((value) => BRANDS.includes(value));
        const tag = values.find((value) => tags.some(({ slug }) => slug === value));
        if (sql.includes("categories c") && category) rows = rows.filter((product) => categories.some(({ id, slug, isDeleted }) => id === product.categoryId && slug === category && !isDeleted));
        if (sql.includes("product_tags pt") && tag) rows = rows.filter((product) => productTags.some(({ productId, tagId }) => productId === product.id && tags.some(({ id, slug, isDeleted }) => id === tagId && slug === tag && !isDeleted)));
        if (sql.includes("p.brand IN") && brand) rows = rows.filter((product) => product.brand === brand);
        if (sql.includes("immutable_unaccent(")) {
            const queryText = values[0];
            if (queryText) rows = rows.filter((product) =>
                [product.name, product.description].some((text) => text.toLowerCase().includes(queryText.toLowerCase()))
            );
        }
        if (sql.includes("COUNT(*) AS total")) return [{ total: rows.length }];
        const pageRows = sql.includes("OFFSET")
            ? rows.slice(Number(values.at(-1)), Number(values.at(-1)) + Number(values.at(-2)))
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
            categories, tags, productTags, nextProductId, nextOptionId, nextOptionValueId, nextVariantId
        };
        products = clone(products);
        productOptions = clone(productOptions);
        productOptionValues = clone(productOptionValues);
        productVariants = clone(productVariants);
        categories = clone(categories);
        tags = clone(tags);
        productTags = clone(productTags);
        variantOptionValues = clone(variantOptionValues);
        try {
            return await work(fakePrisma);
        } catch (error) {
            products = previous.products;
            productOptions = previous.productOptions;
            productOptionValues = previous.productOptionValues;
            productVariants = previous.productVariants;
            categories = previous.categories;
            tags = previous.tags;
            productTags = previous.productTags;
            variantOptionValues = previous.variantOptionValues;
            nextProductId = previous.nextProductId;
            nextOptionId = previous.nextOptionId;
            nextOptionValueId = previous.nextOptionValueId;
            nextVariantId = previous.nextVariantId;
            throw error;
        }
    },
    category: {
        findMany: async ({ where = {} } = {}) => clone(categories.filter((row) => matches(row, where))),
        findFirst: async ({ where = {} } = {}) => clone(categories.find((row) => matches(row, where))) || null
    },
    tag: {
        findMany: async ({ where = {} } = {}) => clone(tags.filter((row) => {
            if (where.products?.some) return !row.isDeleted && productTags.some((link) => link.tagId === row.id && link.productId === where.products.some.productId);
            return matches(row, where);
        })),
        findFirst: async ({ where = {} } = {}) => clone(tags.find((row) => matches(row, where))) || null
    },
    productTag: {
        findMany: async ({ where = {} } = {}) => productTags.filter((link) => where.productId.in.includes(link.productId) && tags.some((tag) => tag.id === link.tagId && !tag.isDeleted)).map((link) => ({
            productId: link.productId, tag: clone(tags.find((tag) => tag.id === link.tagId))
        })),
        deleteMany: async ({ where }) => { productTags = productTags.filter((link) => link.productId !== where.productId); },
        createMany: async ({ data }) => { productTags.push(...clone(data)); }
    },
    product: {
        findMany: async ({ where = {}, include = {}, orderBy, skip = 0, take } = {}) => {
            const rows = products.filter((row) => {
                const direct = Object.fromEntries(Object.entries(where).filter(([key]) => key !== "OR"));
                const directMatch = matches(row, direct);
                const orMatch = !where.OR || where.OR.some((clause) => {
                    if (clause.name?.contains) return matches(row, { name: clause.name });
                    const skuQuery = clause.variants?.some?.sku;
                    return skuQuery?.contains && productVariants.some((variant) =>
                        variant.productId === row.id && variant.isActive && matches(variant, { sku: skuQuery })
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
        findFirst: async ({ where = {} } = {}) => clone(products.find((row) => matches(row, where))) || null,
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
        costPrice: 1,
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
        { sku: "GS-BLK-128", price: 10_000_000, costPrice: 1, stock: 3, options: { "Màu sắc": "Đen", "Dung lượng": "128GB" } },
        { sku: "GS-WHT-256", price: 10_100_000, costPrice: 1, stock: 4, options: { "Màu sắc": "Trắng", "Dung lượng": "256GB" } }
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
            { sku: "GS-BLK-128", price: 10_000_000, costPrice: 1, stock: 3, options: { "Màu sắc": "Đen", "Bộ nhớ": "128GB" } },
            { sku: "GS-WHT-128", price: 10_100_000, costPrice: 1, stock: 4, options: { "Màu sắc": "Trắng", "Bộ nhớ": "128GB" } }
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
            { sku: "GS-RED", price: 500, costPrice: 1, stock: 3, optionValues: { Color: "Red" } },
            { sku: "GS-BLUE", price: 1000, costPrice: 1, stock: 4, optionValues: { Color: "Blue" } }
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
    categories = Object.entries(DEVICE_TYPE_LABELS).map(([slug, name], index) => ({ id: index + 1, slug, name, sortOrder: index, isDeleted: false }));
    tags = [{ id: 1, slug: "gaming", name: "Gaming", isDeleted: false }, { id: 2, slug: "khong-day", name: "Không dây", isDeleted: false }];
    productTags = [];
    retireCategoryOnLock = false;
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

test("admin soft-deletes a product through DELETE /api/admin/products/:id and the storefront stops listing it", async () => {
    const created = await (await createProduct(productInput())).json();
    const response = await fetch(`${baseUrl}/api/admin/products/${created.data.id}`, { method: "DELETE", headers: adminHeaders });
    assert.equal(response.status, 200);
    const listing = await (await fetch(`${baseUrl}/api/products`)).json();
    assert.equal(listing.data.length, 0);
});

test("public taxonomy, dynamic category, tag and brand filters remain distinct", async () => {
    categories.push({ id: 7, slug: "webcam", name: "Webcam mới", sortOrder: 7, isDeleted: false });
    const taxonomy = await fetch(`${baseUrl}/api/catalog/taxonomy`);
    assert.equal(taxonomy.status, 200);
    assert.deepEqual(await taxonomy.json(), {
        categories: categories.map(({ id, slug, name, sortOrder }) => ({ id, slug, name, sortOrder })),
        tags: tags.map(({ id, slug, name }) => ({ id, slug, name })),
        brands: BRANDS
    });
    const created = await createProduct(productInput({ name: "Webcam Pro", categoryId: 7, deviceType: undefined, sku: "WEB-1" }));
    assert.equal(created.status, 201);
    const product = (await created.json()).data;
    assert.equal(product.categoryId, 7);
    assert.equal(product.deviceType, "webcam");
    assert.equal(product.category.name, "Webcam mới");
    const tagged = await fetch(`${baseUrl}/api/admin/products/${product.id}`, {
        method: "PUT", headers: adminHeaders, body: JSON.stringify({ tagIds: [1] })
    });
    assert.equal(tagged.status, 200);
    assert.deepEqual((await tagged.json()).data.tags.map(({ slug }) => slug), ["gaming"]);
    for (const query of ["category=webcam", "tag=gaming", "brand=Logitech", "tag=Logitech"]) {
        const response = await fetch(`${baseUrl}/api/products?${query}`);
        assert.equal(response.status, 200, query);
        assert.equal((await response.json()).meta.total, 1, query);
    }
    assert.equal((await (await fetch(`${baseUrl}/api/products?tag=khong-day`)).json()).meta.total, 0);
    const tagPage = await fetch(`${baseUrl}/the/gaming`);
    assert.equal(tagPage.status, 200);
    assert.match(await tagPage.text(), /<title>Gaming — Sản phẩm công nghệ \| NodeShop<\/title>/);
    const categoryPage = await fetch(`${baseUrl}/danh-muc/webcam`);
    assert.match(await categoryPage.text(), /<h1>Webcam mới<\/h1>/);
    const cleared = await fetch(`${baseUrl}/api/admin/products/${product.id}`, {
        method: "PUT", headers: adminHeaders, body: JSON.stringify({ tagIds: [] })
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual((await cleared.json()).data.tags, []);
    assert.equal((await (await fetch(`${baseUrl}/api/products?tag=gaming`)).json()).meta.total, 0);
    assert.equal((await (await fetch(`${baseUrl}/api/products?brand=Logitech`)).json()).meta.total, 1);
    tags.find(({ slug }) => slug === "gaming").isDeleted = true;
    assert.equal((await fetch(`${baseUrl}/the/gaming`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/products?tag=gaming`)).status, 400);
    categories.find(({ slug }) => slug === "webcam").isDeleted = true;
    assert.equal((await fetch(`${baseUrl}/danh-muc/webcam`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/products?category=webcam`)).status, 400);
});
test("product creation rechecks category after taking the write lock", async () => {
    retireCategoryOnLock = true;
    const response = await createProduct(productInput());
    assert.equal(response.status, 409);
    assert.equal(products.length, 0);
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

test("public catalog searches two-character product names and ignores one-character keywords", async () => {
    await createProduct(productInput({ name: "Keychron K2", sku: "KEYCHRON-K2" }));
    await createProduct(productInput({ name: "Logitech Mouse", sku: "LOGITECH-MOUSE" }));

    const searched = await fetch(`${baseUrl}/api/products?q=K2`);
    assert.equal(searched.status, 200);
    assert.deepEqual((await searched.json()).data.map((product) => product.name), ["Keychron K2"]);

    const short = await fetch(`${baseUrl}/api/products?q=K`);
    assert.equal(short.status, 200);
    assert.deepEqual((await short.json()).data.map((product) => product.name), ["Keychron K2", "Logitech Mouse"]);

    const maximum = await fetch(`${baseUrl}/api/products?q=${"x".repeat(120)}`);
    assert.equal(maximum.status, 200);
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

test("admin product validation bounds stock and price", async () => {
    const attempt = (variant) => createProductWithVariants({ options: [], variants: [{ sku: "BOUND-1", price: 1000, costPrice: 500, stock: 3, optionValues: {}, ...variant }] });
    const cases = [
        [{ stock: 99999999999 }, /Tồn kho .* không vượt quá 1\.000\.000/],
        [{ stock: 1_000_001 }, /Tồn kho/],
        [{ price: 10_000_000_001 }, /Giá của biến thể .* không vượt quá 10\.000\.000\.000 VND/],
        [{ costPrice: 1001 }, /Giá vốn .* không vượt quá giá bán/],
        [{ costPrice: 10_000_000_001, price: 10_000_000_000 }, /Giá vốn .* không vượt quá giá bán/],
        [{ costPrice: 10_000_000_001 }, /Giá vốn .* không vượt quá/],
        [{ costPrice: -1 }, /Giá vốn/]
    ];
    for (const [variant, message] of cases) {
        const response = await attempt(variant);
        const payload = await response.json();
        assert.equal(response.status, 400, JSON.stringify(variant));
        assert.ok(payload.errors.some((error) => message.test(error.message)), `${JSON.stringify(variant)}: ${JSON.stringify(payload.errors)}`);
    }
    assert.equal(products.length, 0);
    assert.equal((await attempt({ stock: 1_000_000, price: 10_000_000_000, costPrice: 10_000_000_000 })).status, 201);
});

test("admin product search treats % and _ as literal characters", async () => {
    await createProduct(productInput({ name: "Giảm 50% Mouse", sku: "PCT-1" }));
    await createProduct(productInput({ name: "Plain Mouse", sku: "PLAIN-1" }));
    const names = async (q) => (await (await fetch(`${baseUrl}/api/admin/products?q=${encodeURIComponent(q)}`, { headers: adminHeaders })).json()).data.map((product) => product.name);
    assert.deepEqual(await names("%"), ["Giảm 50% Mouse"]);
    assert.deepEqual(await names("_"), []);
    assert.deepEqual(await names("Pl_in"), []);
    assert.deepEqual(await names("Plain"), ["Plain Mouse"]);
});

test("SEO category pages show page 1 for unusable page numbers and keep a Vietnamese 404 for unknown pages", async () => {
    await createProduct(productInput({ name: "Mouse Page", sku: "PAGE-1" }));
    for (const page of ["abc", "0", "-1", "1.5", ""]) {
        const response = await fetch(`${baseUrl}/danh-muc/mouse?page=${page}`);
        assert.equal(response.status, 200, `page=${page}`);
        assert.match(await response.text(), /Mouse Page/);
    }
    assert.equal((await fetch(`${baseUrl}/danh-muc/mouse?page=1&page=2`)).status, 400);
    for (const url of ["/danh-muc/unknown-slug", "/hang/xyz", "/the/nope", "/khong-co-trang"]) {
        const response = await fetch(`${baseUrl}${url}`, { headers: { Accept: "text/html" } });
        assert.equal(response.status, 404, url);
        assert.match(await response.text(), /Không tìm thấy trang/, url);
    }
    const api = await fetch(`${baseUrl}/api/khong-co`);
    assert.equal(api.status, 404);
    assert.deepEqual(await api.json(), { success: false, error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên" } });
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

    const legacyBrandPage = await fetch(`${baseUrl}/the/logitech?page=2`, { redirect: "manual" });
    assert.equal(legacyBrandPage.status, 301);
    assert.equal(legacyBrandPage.headers.get("location"), "/hang/logitech?page=2");
    const brandPage = await fetch(`${baseUrl}/hang/logitech?page=2`);
    assert.equal(brandPage.status, 200);
    assert.match(await brandPage.text(), /rel="canonical" href="https:\/\/catalog\.example\.test\/hang\/logitech\?page=2"/);

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
    assert.match(sitemapXml, /https:\/\/catalog\.example\.test\/hang\/logitech\?page=2/);
    assert.match(sitemapXml, /https:\/\/catalog\.example\.test\/the\/gaming/);
    assert.doesNotMatch(sitemapXml, /\/the\/logitech/);
    assert.equal((sitemapXml.match(/product_info\.html\?id=/g) || []).length, 13);
});

test("every supported device type and brand has a server-rendered page and anything else is not found", async () => {
    for (const [slug, label] of Object.entries(DEVICE_TYPE_LABELS)) {
        const response = await fetch(`${baseUrl}/danh-muc/${slug}`);
        assert.equal(response.status, 200, slug);
        assert.match(await response.text(), new RegExp(`<h1>${label}</h1>`), slug);
    }
    for (const brand of BRANDS) {
        const response = await fetch(`${baseUrl}/hang/${brand.toLowerCase()}`);
        assert.equal(response.status, 200, brand);
        assert.match(await response.text(), new RegExp(`<h1>${brand}</h1>`), brand);
        const legacy = await fetch(`${baseUrl}/the/${brand.toLowerCase()}`, { redirect: "manual" });
        assert.equal(legacy.status, 301, brand);
        assert.equal(legacy.headers.get("location"), `/hang/${brand.toLowerCase()}`);
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
        [productInput({ deviceType: undefined }), "categoryId"]
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

test("invalid category or brand returns a field error", async () => {
    const response = await createProduct(productInput({ deviceType: "phone" }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errors[0].field, "deviceType");
    const invalidBrand = await createProduct(productInput({ brand: "Google" }));
    assert.equal(invalidBrand.status, 400);
    assert.equal((await invalidBrand.json()).errors.find(({ field }) => field === "brand").message, "Thương hiệu phải là Apple, Samsung, MSI, Aula, Logitech, Razer, Keychron hoặc Asus");
});

test("a deleted product of a retired device type cannot be restored", async () => {
    const { id } = (await (await createProduct(productInput())).json()).data;
    Object.assign(products.find((row) => row.id === id), { isDeleted: true });
    categories.find(({ slug }) => slug === "mouse").isDeleted = true;
    const response = await fetch(`${baseUrl}/api/admin/products/${id}/restore`, { method: "POST", headers: adminHeaders });
    assert.equal(response.status, 409);
    assert.equal(products.find((row) => row.id === id).isDeleted, true);
});

test("obsolete public category endpoint stays unmounted", async () => {
    const publicResponse = await fetch(`${baseUrl}/api/categories`);
    assert.equal(publicResponse.status, 404);
});
