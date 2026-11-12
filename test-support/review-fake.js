// In-memory Prisma fake for the Product review code paths (customer API, Guest comments, moderation).
// `state` is mutable on purpose: tests seed and inspect it directly.

const uniqueViolation = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
const missingRow = () => Object.assign(new Error("Record not found"), { code: "P2025" });

const createReviewFake = () => {
    const state = {
        users: [],
        products: [],
        variants: [],
        orders: [],
        orderItems: [],
        reviews: [],
        audits: [],
        nextReviewId: 1,
        clock: 1000
    };

    const dated = (row) => ({ ...row, createdAt: new Date(row.createdAt * 1000), updatedAt: new Date(row.updatedAt * 1000) });
    const withRelations = (row) => ({
        ...dated(row),
        user: row.userId ? { username: state.users.find((user) => user.id === row.userId)?.username ?? null } : null,
        product: { name: state.products.find((product) => product.id === row.productId)?.name ?? null }
    });

    const matches = (row, where = {}) => {
        if (where.id !== undefined && row.id !== where.id) return false;
        if (where.productId !== undefined) {
            const { productId } = where;
            if (typeof productId === "object" ? !productId.in.includes(row.productId) : row.productId !== productId) return false;
        }
        if (where.userId !== undefined && row.userId !== where.userId) return false;
        if (where.isHidden !== undefined && row.isHidden !== where.isHidden) return false;
        if (where.rating?.not === null && row.rating === null) return false;
        if (where.comment?.not === null && row.comment === null) return false;
        return true;
    };

    const newest = (a, b) => b.createdAt - a.createdAt || b.id - a.id;

    const prisma = {
        user: {
            findUnique: async ({ where }) => {
                const row = state.users.find((user) => user.id === where.id);
                return row ? { ...row } : null;
            }
        },
        product: {
            findUnique: async ({ where }) => {
                const row = state.products.find((product) => product.id === where.id);
                return row ? { id: row.id, isDeleted: row.isDeleted } : null;
            }
        },
        orderItem: {
            findFirst: async ({ where }) => {
                const item = state.orderItems.find((candidate) => {
                    const variant = state.variants.find((row) => row.id === candidate.variantId);
                    const order = state.orders.find((row) => row.id === candidate.orderId);
                    return variant?.productId === where.variant.productId &&
                        order?.userId === where.order.userId &&
                        order?.orderStatus === where.order.orderStatus;
                });
                return item ? { id: item.id } : null;
            }
        },
        productReview: {
            findUnique: async ({ where }) => {
                const row = state.reviews.find((review) => review.id === where.id);
                return row ? withRelations(row) : null;
            },
            findFirst: async ({ where }) => {
                const row = state.reviews.find((review) => matches(review, where));
                return row ? dated(row) : null;
            },
            create: async ({ data }) => {
                // The filtered unique index only covers signed-in users.
                if (data.userId && state.reviews.some((row) => row.productId === data.productId && row.userId === data.userId)) {
                    throw uniqueViolation();
                }
                const row = {
                    id: state.nextReviewId++, isHidden: false, guestName: null,
                    createdAt: ++state.clock, updatedAt: state.clock, ...data
                };
                state.reviews.push(row);
                return dated(row);
            },
            update: async ({ where, data }) => {
                const row = state.reviews.find((review) => review.id === where.id);
                if (!row) throw missingRow();
                Object.assign(row, data, { updatedAt: ++state.clock });
                return dated(row);
            },
            deleteMany: async ({ where }) => {
                const before = state.reviews.length;
                state.reviews = state.reviews.filter((row) => !matches(row, where));
                return { count: before - state.reviews.length };
            },
            count: async ({ where }) => state.reviews.filter((row) => matches(row, where)).length,
            findMany: async ({ where, skip = 0, take }) => state.reviews
                .filter((row) => matches(row, where))
                .sort(newest)
                .slice(skip, take === undefined ? undefined : skip + take)
                .map(withRelations),
            groupBy: async ({ by, where }) => {
                const groups = new Map();
                for (const row of state.reviews.filter((candidate) => matches(candidate, where))) {
                    const key = by.map((field) => row[field]).join("|");
                    const group = groups.get(key) || { ...Object.fromEntries(by.map((field) => [field, row[field]])), _count: { _all: 0 } };
                    group._count._all += 1;
                    groups.set(key, group);
                }
                return [...groups.values()];
            }
        },
        auditLog: {
            create: async ({ data }) => {
                state.audits.push({ ...data });
                return { ...data, timestamp: new Date() };
            }
        }
    };

    return { prisma, state };
};

module.exports = { createReviewFake };
