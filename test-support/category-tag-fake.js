// Fake Prisma for the category / tag tests: in-memory categories, tags, product_tags and the product columns they touch.
// It enforces what PostgreSQL enforces here (partial unique slug among undeleted rows -> P2002, product_tags primary key,
// transaction rollback) so the services' error mapping is exercised; the SQL itself is covered by test-db/.

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

const uniqueViolation = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

const pick = (row, select) => {
    if (!row) return null;
    if (!select) return copy(row);
    const result = {};
    for (const [key, enabled] of Object.entries(select)) if (enabled === true) result[key] = copy(row[key]);
    return result;
};

const orderRows = (rows, orderBy = []) => [...rows].sort((left, right) => {
    for (const clause of orderBy) {
        const [[key, direction]] = Object.entries(clause);
        const a = left[key];
        const b = right[key];
        const compared = typeof a === "string" ? a.localeCompare(b, "en") : a - b;
        if (compared !== 0) return direction === "desc" ? -compared : compared;
    }
    return 0;
});

const createCategoryTagFake = () => {
    const state = { categories: [], tags: [], productTags: [], products: [], nextCategoryId: 1, nextTagId: 1 };
    let clock = 0;
    const now = () => new Date(Date.UTC(2026, 10, 21, 0, 0, clock++));

    const productMatches = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);

    const categoryMatches = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);

    const tagMatches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
        if (key === "id" && value && typeof value === "object") return value.in.includes(row.id);
        if (key === "products") {
            return state.productTags.some((link) => link.tagId === row.id && link.productId === value.some.productId);
        }
        return row[key] === value;
    });

    const assertUniqueSlug = (rows, row, ignoreId) => {
        if (!row.isDeleted && rows.some((other) => other.id !== ignoreId && !other.isDeleted && other.slug === row.slug)) throw uniqueViolation();
    };

    const tagCount = (tag, where) => state.productTags.filter((link) => {
        if (link.tagId !== tag.id) return false;
        const product = state.products.find((candidate) => candidate.id === link.productId);
        return !where?.product || productMatches(product, where.product);
    }).length;

    const prisma = {
        category: {
            findMany: async ({ where, orderBy, select }) => orderRows(state.categories.filter((row) => categoryMatches(row, where)), orderBy).map((row) => {
                const result = pick(row, select);
                if (select?._count) {
                    result._count = { products: state.products.filter((product) => product.categoryId === row.id
                        && productMatches(product, select._count.select.products.where)).length };
                }
                return result;
            }),
            findFirst: async ({ where, select }) => pick(state.categories.find((row) => categoryMatches(row, where)), select),
            aggregate: async () => ({ _max: { sortOrder: state.categories.reduce((max, row) => (max === null || row.sortOrder > max ? row.sortOrder : max), null) } }),
            create: async ({ data, select }) => {
                const row = { id: state.nextCategoryId, sortOrder: 0, isDeleted: false, deletedAt: null, createdAt: now(), updatedAt: now(), ...data };
                assertUniqueSlug(state.categories, row);
                state.nextCategoryId += 1;
                state.categories.push(row);
                return pick(row, select);
            },
            update: async ({ where, data, select }) => {
                const row = state.categories.find((candidate) => candidate.id === where.id);
                const next = { ...row, ...data, updatedAt: now() };
                assertUniqueSlug(state.categories, next, row.id);
                Object.assign(row, next);
                return pick(row, select);
            }
        },
        tag: {
            findMany: async ({ where, orderBy, select }) => orderRows(state.tags.filter((row) => tagMatches(row, where)), orderBy).map((row) => {
                const result = pick(row, select);
                if (select?._count) result._count = { products: tagCount(row, select._count.select.products.where) };
                return result;
            }),
            findFirst: async ({ where, select }) => pick(state.tags.find((row) => tagMatches(row, where)), select),
            create: async ({ data, select }) => {
                const row = { id: state.nextTagId, isDeleted: false, deletedAt: null, createdAt: now(), updatedAt: now(), ...data };
                assertUniqueSlug(state.tags, row);
                state.nextTagId += 1;
                state.tags.push(row);
                return pick(row, select);
            },
            update: async ({ where, data, select }) => {
                const row = state.tags.find((candidate) => candidate.id === where.id);
                const next = { ...row, ...data, updatedAt: now() };
                assertUniqueSlug(state.tags, next, row.id);
                Object.assign(row, next);
                return pick(row, select);
            }
        },
        productTag: {
            deleteMany: async ({ where }) => {
                const before = state.productTags.length;
                state.productTags = state.productTags.filter((link) => !Object.entries(where).every(([key, value]) => link[key] === value));
                return { count: before - state.productTags.length };
            },
            createMany: async ({ data }) => {
                for (const link of data) {
                    if (state.productTags.some((other) => other.productId === link.productId && other.tagId === link.tagId)) throw uniqueViolation();
                    state.productTags.push({ ...link });
                }
                return { count: data.length };
            },
            findMany: async ({ where }) => state.productTags
                .filter((link) => where.productId.in.includes(link.productId)
                    && !state.tags.find((tag) => tag.id === link.tagId).isDeleted)
                .map((link) => ({ productId: link.productId, tag: pick(state.tags.find((tag) => tag.id === link.tagId), { id: true, slug: true, name: true, isDeleted: true, createdAt: true, updatedAt: true }) }))
        },
        product: {
            count: async ({ where }) => state.products.filter((row) => productMatches(row, where)).length,
            findFirst: async ({ where, select }) => pick(state.products.find((row) => productMatches(row, where)), select)
        },
        // Row locks are a no-op in memory; the statement text only decides which table to look the row up in.
        $queryRaw: async (strings, id) => {
            const text = strings.join("?");
            const rows = text.includes("FROM categories") ? state.categories
                : text.includes("FROM products") ? state.products
                    : text.includes("FROM tags") ? state.tags : [];
            return rows.filter((row) => row.id === id).map((row) => ({ id: row.id, isDeleted: row.isDeleted }));
        },
        $transaction: async (fn) => {
            const snapshot = copy({ categories: state.categories, tags: state.tags, productTags: state.productTags });
            try {
                return await fn(prisma);
            } catch (error) {
                Object.assign(state, snapshot);
                throw error;
            }
        }
    };

    const addProduct = ({ categoryId, isDeleted = false, deviceType = "keyboard" }) => {
        const id = state.products.length + 1;
        state.products.push({ id, categoryId, isDeleted, deviceType });
        return id;
    };

    return { prisma, state, addProduct };
};

module.exports = { createCategoryTagFake };
