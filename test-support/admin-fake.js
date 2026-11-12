// Fake Prisma for the admin integration tests (users, order list, dashboard aggregates).
// `$queryRawUnsafe` does not parse SQL: it recognises the three dashboard statements by their text and computes the
// same aggregates in JavaScript from the in-memory rows (its own bucketing, independent of src/services/admin-period).
// So these tests prove the wiring, the period boundaries and the profit arithmetic, not the T-SQL itself.

const OFFSET_MS = 7 * 3600e3;

const ci = (value) => (typeof value === "string" ? value.toLowerCase() : value);

const matchField = (actual, condition) => {
    if (condition === null || typeof condition !== "object" || condition instanceof Date) {
        return actual instanceof Date && condition instanceof Date ? actual.getTime() === condition.getTime() : ci(actual) === ci(condition);
    }
    for (const [op, value] of Object.entries(condition)) {
        if (op === "contains") { if (typeof actual !== "string" || !ci(actual).includes(ci(value))) return false; }
        else if (op === "not") { if (matchField(actual, value)) return false; }
        else if (op === "in") { if (!value.includes(actual)) return false; }
        else if (op === "gte") { if (!(actual >= value)) return false; }
        else if (op === "lt") { if (!(actual < value)) return false; }
        else throw new Error(`Fake Prisma: unsupported operator ${op}`);
    }
    return true;
};

const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((branch) => matches(row, branch));
    return matchField(row[key], condition);
});

const newest = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const isRevenue = (order) => order.orderStatus !== "CANCELLED" && (order.paymentStatus === "PAID" || order.orderStatus === "DELIVERED");

const bucketOf = (granularity, instant) => {
    const local = new Date(instant.getTime() + OFFSET_MS);
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    if (granularity === "year") return new Date(Date.UTC(y, 0, 1));
    if (granularity === "quarter") return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
    if (granularity === "month") return new Date(Date.UTC(y, m, 1));
    const day = new Date(Date.UTC(y, m, local.getUTCDate()));
    return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400e3);
};

const granularityOf = (sql) => {
    if (sql.includes("DATEDIFF(day, '19000101'")) return "week";
    if (sql.includes("DATEPART(quarter")) return "quarter";
    if (sql.includes("MONTH(")) return "month";
    return "year";
};

/**
 * @param state { users, orders, orderItems, variants, products, refreshSessions, auditLogs, calls } arrays, swapped freely by tests
 */
const createAdminFake = (state) => {
    const fake = {
        user: {
            findUnique: async ({ where, select }) => {
                const row = state.users.find((user) => user.id === where.id);
                if (!row) return null;
                const out = { ...row };
                if (select?._count) out._count = { orders: state.orders.filter((order) => order.userId === row.id).length };
                return out;
            },
            findFirst: async ({ where }) => {
                const row = state.users.find((user) => matches(user, where));
                return row ? { ...row } : null;
            },
            findMany: async ({ where, orderBy, skip = 0, take }) => {
                state.calls?.push("user.findMany");
                return state.users
                    .filter((user) => matches(user, where))
                    .sort((a, b) => newest(a, b))
                    .slice(skip, skip + take)
                    .map((user) => ({ ...user, _count: { orders: state.orders.filter((order) => order.userId === user.id).length } }));
            },
            count: async ({ where }) => state.users.filter((user) => matches(user, where)).length,
            update: async ({ where, data }) => {
                const row = state.users.find((user) => user.id === where.id);
                if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
                for (const [key, value] of Object.entries(data)) {
                    row[key] = value && typeof value === "object" && value.increment !== undefined ? (row[key] ?? 0) + value.increment : value;
                }
                return { ...row };
            }
        },
        order: {
            count: async ({ where }) => state.orders.filter((order) => matches(order, where)).length,
            aggregate: async ({ where }) => ({
                _sum: { totalPrice: state.orders.filter((order) => matches(order, where)).reduce((sum, order) => sum + order.totalPrice, 0) }
            }),
            groupBy: async ({ where }) => {
                const groups = new Map();
                for (const order of state.orders.filter((candidate) => matches(candidate, where))) {
                    groups.set(order.orderStatus, (groups.get(order.orderStatus) || 0) + 1);
                }
                return [...groups].map(([orderStatus, count]) => ({ orderStatus, _count: { _all: count } }));
            },
            findMany: async ({ where, orderBy, skip = 0, take, include }) => {
                state.calls?.push("order.findMany");
                return state.orders
                    .filter((order) => matches(order, where))
                    .sort(newest)
                    .slice(skip, skip + take)
                    .map((order) => ({
                        ...order,
                        items: state.orderItems.filter((item) => item.orderId === order.id).map((item) => ({
                            nameSnapshot: `Item ${item.variantId}`, imageSnapshot: "/img.png", skuSnapshot: `SKU-${item.variantId}`,
                            optionsSnapshot: "{}", ...item
                        })),
                        vouchers: (state.orderVouchers || []).filter((entry) => entry.orderId === order.id)
                    }));
            }
        },
        refreshSession: {
            create: async ({ data }) => { state.refreshSessions.push({ revokedAt: null, ...data }); return data; },
            updateMany: async ({ where, data }) => {
                const rows = state.refreshSessions.filter((row) => row.userId === where.userId && (where.revokedAt !== null || row.revokedAt === null));
                rows.forEach((row) => Object.assign(row, data));
                return { count: rows.length };
            }
        },
        auditLog: {
            create: async ({ data }) => {
                const row = { timestamp: new Date(), ...data };
                state.auditLogs.push(row);
                return row;
            }
        },
        $transaction: async (work) => work(fake),
        $executeRaw: async () => 1,
        $queryRawUnsafe: async (sql, ...params) => {
            state.calls?.push("$queryRawUnsafe");
            const sold = state.orderItems.filter((item) => {
                const order = state.orders.find((row) => row.id === item.orderId);
                return order && isRevenue(order);
            });
            const productOf = (item) => {
                const variant = state.variants.find((row) => row.id === item.variantId);
                return state.products.find((row) => row.id === variant.productId);
            };
            if (sql.includes("SELECT TOP 5")) {
                const byProduct = new Map();
                for (const item of sold) {
                    const product = productOf(item);
                    const row = byProduct.get(product.id) || { productId: product.id, name: product.name, quantity: 0, revenue: 0 };
                    row.quantity += item.quantity;
                    row.revenue += item.lineTotal;
                    byProduct.set(product.id, row);
                }
                return [...byProduct.values()].sort((a, b) => b.quantity - a.quantity || a.productId - b.productId).slice(0, 5);
            }
            const granularity = granularityOf(sql);
            const [from, to] = params;
            const inRange = (order) => order.createdAt >= from && order.createdAt < to;
            if (sql.includes("COUNT(*) AS orders")) {
                const groups = new Map();
                for (const order of state.orders.filter((row) => row.orderStatus !== "CANCELLED" && inRange(row))) {
                    const key = bucketOf(granularity, order.createdAt).toISOString();
                    const row = groups.get(key) || { bucket: bucketOf(granularity, order.createdAt), orders: 0, revenue: 0, deductions: 0 };
                    row.orders += 1;
                    if (isRevenue(order)) { row.revenue += order.totalPrice; row.deductions += order.discount + order.pointsDiscount; }
                    groups.set(key, row);
                }
                return [...groups.values()];
            }
            if (sql.includes("p.device_type AS deviceType")) {
                const groups = new Map();
                for (const item of sold) {
                    const order = state.orders.find((row) => row.id === item.orderId);
                    if (!inRange(order)) continue;
                    const deviceType = productOf(item).deviceType;
                    const bucket = bucketOf(granularity, order.createdAt);
                    const key = `${bucket.toISOString()}|${deviceType}`;
                    const row = groups.get(key) || { bucket, deviceType, quantity: 0, lineTotal: 0, cost: 0 };
                    row.quantity += item.quantity;
                    row.lineTotal += item.lineTotal;
                    row.cost += item.unitCost * item.quantity;
                    groups.set(key, row);
                }
                return [...groups.values()];
            }
            throw new Error(`Fake Prisma: unrecognised raw SQL: ${sql.slice(0, 80)}`);
        }
    };
    return fake;
};

module.exports = { createAdminFake };
