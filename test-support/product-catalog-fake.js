// In-memory Prisma double for the Product catalog: products, options, variants (with cost price), product images,
// admin lookup and audit log. It mirrors the (product_id, position) unique index of product_images.
// Usage: const fake = createProductCatalogFake(); db.getPrismaClient = () => fake.prisma; fake.reset() between tests;
// read and assert on fake.tables.<name>.

const createProductCatalogFake = () => {
    const tables = {};
    const reset = () => {
        Object.assign(tables, {
            products: [],
            productOptions: [],
            productOptionValues: [],
            productVariants: [],
            variantOptionValues: [],
            productImages: [],
            audits: [],
            nextProductId: 1,
            nextOptionId: 1,
            nextOptionValueId: 1,
            nextVariantId: 1,
            nextImageId: 1
        });
    };
    reset();
    const clone = (value) => value === undefined ? undefined : structuredClone(value);
    const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
        if (key === "OR") return expected.some((clause) => matches(row, clause));
        if (expected && typeof expected === "object" && "contains" in expected) return String(row[key] ?? "").includes(expected.contains);
        return row[key] === expected;
    });
    const hydrateVariant = (row, include = {}) => {
        if (!row) return row;
        const result = clone(row);
        if (include.optionValues) {
            result.optionValues = tables.variantOptionValues
                .filter((link) => link.variantId === row.id)
                .map((link) => {
                    const optionValue = tables.productOptionValues.find((value) => value.id === link.optionValueId);
                    const option = tables.productOptions.find((candidate) => candidate.id === optionValue?.optionId);
                    return {
                        ...clone(link),
                        optionValue: optionValue ? { ...clone(optionValue), option: clone(option) } : null
                    };
                });
        }
        if (include.product) result.product = clone(tables.products.find((product) => product.id === row.productId));
        return result;
    };
    const hydrateProduct = (row, include = {}) => {
        if (!row) return row;
        const result = clone(row);
        if (include.options) {
            const spec = include.options === true ? {} : include.options;
            result.options = tables.productOptions
                .filter((option) => option.productId === row.id &&
                    (spec.where?.isActive === undefined || option.isActive === spec.where.isActive))
                .map((option) => ({
                    ...clone(option),
                    values: tables.productOptionValues
                        .filter((value) => value.optionId === option.id &&
                            (spec.include?.values?.where?.isActive === undefined ||
                                value.isActive === spec.include.values.where.isActive))
                        .map(clone)
                }));
        }
        if (include.images) {
            result.images = tables.productImages
                .filter((image) => image.productId === row.id)
                .sort((left, right) => left.position - right.position)
                .map(clone);
        }
        if (include.variants) {
            const spec = include.variants === true ? {} : include.variants;
            result.variants = tables.productVariants
                .filter((variant) => variant.productId === row.id &&
                    (spec.where?.isActive === undefined || variant.isActive === spec.where.isActive))
                .map((variant) => hydrateVariant(variant, spec.include || {}));
        }
        return result;
    };
    const fakePrisma = {
        $transaction: async (work) => work(fakePrisma),
        product: {
            findMany: async ({ where = {}, orderBy, include } = {}) => {
                const rows = tables.products.filter((row) => matches(row, where));
                if (orderBy?.id === "asc") rows.sort((a, b) => a.id - b.id);
                return rows.map((row) => hydrateProduct(row, include));
            },
            findUnique: async ({ where, include }) =>
                hydrateProduct(tables.products.find((row) => matches(row, where)), include),
            create: async ({ data }) => {
                const row = { id: tables.nextProductId++, ...clone(data) };
                tables.products.push(row);
                return clone(row);
            },
            update: async ({ where, data }) => {
                const row = tables.products.find((candidate) => matches(candidate, where));
                if (!row) throw new Error("product not found");
                Object.assign(row, clone(data));
                return clone(row);
            },
            updateMany: async ({ where, data }) => {
                const row = tables.products.find((candidate) => matches(candidate, where));
                if (!row) return { count: 0 };
                Object.assign(row, clone(data));
                return { count: 1 };
            }
        },
        productOption: {
            findMany: async ({ where }) => tables.productOptions
                .filter((option) => matches(option, where))
                .map((option) => ({
                    ...clone(option),
                    values: tables.productOptionValues.filter((value) => value.optionId === option.id).map(clone)
                })),
            create: async ({ data }) => {
                const row = { id: tables.nextOptionId++, ...clone(data) };
                tables.productOptions.push(row);
                return clone(row);
            },
            update: async ({ where, data }) => {
                const row = tables.productOptions.find((option) => matches(option, where));
                Object.assign(row, clone(data));
                return clone(row);
            }
        },
        productOptionValue: {
            create: async ({ data }) => {
                const row = { id: tables.nextOptionValueId++, ...clone(data) };
                tables.productOptionValues.push(row);
                return clone(row);
            },
            update: async ({ where, data }) => {
                const row = tables.productOptionValues.find((value) => matches(value, where));
                Object.assign(row, clone(data));
                return clone(row);
            }
        },
        productVariant: {
            findUnique: async ({ where, include }) => {
                const row = where.sku
                    ? tables.productVariants.find((variant) => variant.sku === where.sku)
                    : where.productId_combinationKey
                        ? tables.productVariants.find((variant) =>
                            variant.productId === where.productId_combinationKey.productId &&
                            variant.combinationKey === where.productId_combinationKey.combinationKey)
                        : tables.productVariants.find((variant) => matches(variant, where));
                return row ? hydrateVariant(row, include) : null;
            },
            findMany: async ({ where = {}, take }) => {
                const rows = tables.productVariants.filter((variant) => matches(variant, where));
                return rows.slice(0, take).map((row) => clone(row));
            },
            create: async ({ data }) => {
                const row = { id: tables.nextVariantId++, ...clone(data) };
                tables.productVariants.push(row);
                return clone(row);
            },
            update: async ({ where, data }) => {
                const row = tables.productVariants.find((variant) => matches(variant, where));
                Object.assign(row, clone(data));
                return clone(row);
            }
        },
        productVariantOptionValue: {
            deleteMany: async ({ where }) => {
                const before = tables.variantOptionValues.length;
                tables.variantOptionValues = tables.variantOptionValues.filter((link) => !matches(link, where));
                return { count: before - tables.variantOptionValues.length };
            },
            create: async ({ data }) => {
                const row = clone(data);
                tables.variantOptionValues.push(row);
                return row;
            }
        },
        productImage: {
            deleteMany: async ({ where }) => {
                const before = tables.productImages.length;
                tables.productImages = tables.productImages.filter((image) =>
                    !(image.productId === where.productId && where.id.in.includes(image.id)));
                return { count: before - tables.productImages.length };
            },
            update: async ({ where, data }) => {
                const row = tables.productImages.find((image) => image.id === where.id);
                if (!row) throw new Error("product image not found");
                const next = { ...row, ...clone(data) };
                // Mirror the (product_id, position) unique index so the repository's two-step reorder is really exercised.
                if (tables.productImages.some((image) => image.id !== row.id && image.productId === next.productId && image.position === next.position)) {
                    throw new Error("unique constraint product_images_product_id_position_key");
                }
                Object.assign(row, next);
                return clone(row);
            },
            create: async ({ data }) => {
                if (tables.productImages.some((image) => image.productId === data.productId && image.position === data.position)) {
                    throw new Error("unique constraint product_images_product_id_position_key");
                }
                const row = { id: tables.nextImageId++, ...clone(data) };
                tables.productImages.push(row);
                return clone(row);
            }
        },
        productReview: { groupBy: async () => [] },
        user: {
            findUnique: async ({ where }) => where.id === "catalog-admin"
                ? { id: "catalog-admin", role: "admin", status: "ACTIVE", authVersion: 1, forcePasswordChange: false }
                : null
        },
        auditLog: { create: async ({ data }) => { const row = clone(data); tables.audits.push(row); return row; } }
    };

    return { prisma: fakePrisma, tables, reset };
};

module.exports = { createProductCatalogFake };
