// In-memory stand-in for the Prisma calls behind the landing page and the public catalog listing.
// It emulates the SQL of landing.repository (best sellers) and product.repository.getCatalogPage by reading the
// SQL text for which predicates are present and consuming `values` in the order the repository pushes them.
// `calls` counts the database round trips so tests can prove the landing cache works.

const createLandingFake = () => {
    const state = { products: [], variants: [], reviews: [], orders: [], orderItems: [] };
    const calls = { queryRaw: 0, findMany: 0, groupBy: 0 };

    const activeVariants = (productId) => state.variants.filter((variant) => variant.productId === productId && variant.isActive);
    const summary = (product, include) => ({
        ...product,
        variants: include?.variants ? activeVariants(product.id).map(({ price, stock }) => ({ price, stock })) : undefined
    });
    const visibleReviews = (productId) => state.reviews.filter((review) => review.productId === productId && !review.isHidden && review.rating !== null);
    const averageRating = (productId) => {
        const rows = visibleReviews(productId);
        return rows.length ? Math.round(rows.reduce((sum, review) => sum + review.rating, 0) / rows.length * 10) / 10 : null;
    };
    const minPriceOf = (productId) => {
        const prices = activeVariants(productId).map((variant) => Number(variant.price));
        return prices.length ? Math.min(...prices) : 0;
    };

    const catalogRows = (sql, values) => {
        let next = 0;
        const take = (count) => { const taken = values.slice(next, next + count); next += count; return taken; };
        const inValues = (marker) => {
            const match = sql.match(new RegExp(`${marker}\\s+IN \\(([^)]*)\\)`));
            return match ? take(match[1].split(",").length) : [];
        };
        let rows = state.products.filter((product) => !product.isDeleted);
        if (sql.includes("CHARINDEX")) take(2);
        const categories = inValues("p\\.device_type");
        const brands = inValues("p\\.brand");
        if (categories.length) rows = rows.filter((product) => categories.includes(product.deviceType));
        if (brands.length) rows = rows.filter((product) => brands.includes(product.brand));
        if (sql.includes("COALESCE(v.min_price, 0) >=")) { const [min] = take(1); rows = rows.filter((product) => minPriceOf(product.id) >= min); }
        if (sql.includes("COALESCE(v.min_price, 0) <=")) { const [max] = take(1); rows = rows.filter((product) => minPriceOf(product.id) <= max); }
        if (sql.includes("ROUND(AVG")) { const [min] = take(1); rows = rows.filter((product) => (averageRating(product.id) ?? -1) >= min); }
        return rows.sort((a, b) => a.id - b.id);
    };

    const bestSellerRows = (values) => {
        const [limit, since] = values;
        const totals = new Map();
        for (const item of state.orderItems) {
            const order = state.orders.find((candidate) => candidate.id === item.orderId);
            const variant = state.variants.find((candidate) => candidate.id === item.variantId);
            const product = state.products.find((candidate) => candidate.id === variant?.productId);
            if (!order || order.orderStatus === "CANCELLED" || !product || product.isDeleted || !activeVariants(product.id).length) continue;
            const entry = totals.get(product.id) || { id: product.id, recent_units: 0, total_units: 0 };
            entry.total_units += item.quantity;
            if (new Date(order.createdAt) >= new Date(since)) entry.recent_units += item.quantity;
            totals.set(product.id, entry);
        }
        return [...totals.values()]
            .sort((a, b) => b.recent_units - a.recent_units || b.total_units - a.total_units || a.id - b.id)
            .slice(0, limit);
    };

    const prisma = {
        $queryRaw: async (query) => {
            calls.queryRaw += 1;
            const sql = query.sql || "";
            const values = query.values || [];
            if (sql.includes("order_items")) return bestSellerRows(values);
            const rows = catalogRows(sql, values);
            if (sql.includes("COUNT(*) AS total")) return [{ total: rows.length }];
            const [offset, size] = values.slice(-2).map(Number);
            return rows.slice(offset, offset + size).map((product) => ({ id: product.id, min_price: minPriceOf(product.id) }));
        },
        product: {
            findMany: async ({ where = {}, orderBy, take, include } = {}) => {
                calls.findMany += 1;
                let rows = state.products.filter((product) => {
                    if (where.isDeleted !== undefined && product.isDeleted !== where.isDeleted) return false;
                    if (where.deviceType !== undefined && product.deviceType !== where.deviceType) return false;
                    if (where.id?.in && !where.id.in.includes(product.id)) return false;
                    if (where.variants?.some?.isActive && !activeVariants(product.id).length) return false;
                    return true;
                });
                if (Array.isArray(orderBy)) {
                    rows = rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id);
                }
                if (take !== undefined) rows = rows.slice(0, take);
                return rows.map((product) => summary(product, include));
            },
            count: async ({ where = {} } = {}) => state.products.filter((product) => where.isDeleted === undefined || product.isDeleted === where.isDeleted).length
        },
        productReview: {
            groupBy: async ({ where }) => {
                calls.groupBy += 1;
                const groups = new Map();
                for (const review of state.reviews) {
                    if (!where.productId.in.includes(review.productId) || review.isHidden || review.rating === null) continue;
                    const key = `${review.productId}:${review.rating}`;
                    const group = groups.get(key) || { productId: review.productId, rating: review.rating, _count: { _all: 0 } };
                    group._count._all += 1;
                    groups.set(key, group);
                }
                return [...groups.values()];
            }
        }
    };

    const reset = () => {
        for (const key of Object.keys(state)) state[key] = [];
        for (const key of Object.keys(calls)) calls[key] = 0;
    };

    return { prisma, state, calls, reset };
};

module.exports = { createLandingFake };
