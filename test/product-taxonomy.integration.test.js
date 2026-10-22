const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
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
        findMany: async ({ where = {}, include = {}, orderBy } = {}) => {
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
            return rows;
        },
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
    user: {
        findUnique: async ({ where }) => where.id === "catalog-admin"
            ? { id: "catalog-admin", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false }
            : null
    },
    auditLog: {
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
    name: "iPhone 17",
    brand: "Apple",
    deviceType: "phone",
    sku: "IP17-256",
    price: 999,
    stock: 7,
    image: "https://catalog.example.test/iphone.png",
    description: "A new phone",
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
        name: "Samsung Galaxy S",
        brand: "Samsung",
        deviceType: "phone",
        description: "Galaxy with selectable configurations",
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
    assert.equal(createdPayload.data.brand, "Apple");
    assert.equal(createdPayload.data.deviceType, "phone");

    const response = await fetch(`${baseUrl}/api/products`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(
        { brand: payload.data[0].brand, deviceType: payload.data[0].deviceType },
        { brand: "Apple", deviceType: "phone" }
    );
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
            slug: "iphone-17",
            name: "iPhone 17",
            brand: "Apple",
            deviceType: "phone",
            price: 999,
            stock: 7,
            description: "A new phone"
        }
    );
    assert.match(payload.data.image, /^\/uploads\/products\/[a-f0-9-]+\.png$/);
});

test("product create reports missing and unsupported taxonomy with field errors", async () => {
    for (const [input, field] of [
        [productInput({ brand: "Google" }), "brand"],
        [productInput({ deviceType: "watch" }), "deviceType"],
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
        [{ deviceType: "watch" }, "deviceType"],
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

test("the remaining supported Samsung and tablet values persist through HTTP", async () => {
    const response = await createProduct(productInput({
        name: "Samsung Galaxy Tab",
        brand: "Samsung",
        deviceType: "tablet",
        sku: "SG-TAB-1"
    }));
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.deepEqual(
        { brand: payload.data.brand, deviceType: payload.data.deviceType },
        { brand: "Samsung", deviceType: "tablet" }
    );
});

test("legacy category APIs are no longer mounted", async () => {
    const publicResponse = await fetch(`${baseUrl}/api/categories`);
    assert.equal(publicResponse.status, 404);
    const adminResponse = await fetch(`${baseUrl}/api/admin/categories`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ name: "Phones" })
    });
    assert.equal(adminResponse.status, 404);
});
