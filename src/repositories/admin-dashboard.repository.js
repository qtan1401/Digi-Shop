// ===== ADMIN DASHBOARD REPOSITORY =====
// Aggregates only: nothing here loads orders into the application. Grouping is done in PostgreSQL.
// A "revenue order" is not CANCELLED and is PAID or DELIVERED (see GLOSSARY: Revenue).

const { getPrismaClient } = require("../db/prisma");

const REVENUE_WHERE = Object.freeze({
    orderStatus: { not: "CANCELLED" },
    OR: [{ paymentStatus: "PAID" }, { orderStatus: "DELIVERED" }]
});
const REVENUE_SQL = "(o.payment_status = 'PAID' OR o.order_status = 'DELIVERED')";

// Bucket start as a calendar date in shop time (UTC+7). PostgreSQL date_trunc('week', ...) starts on Monday.
// Convert timestamptz to a timezone-independent local timestamp before truncating, then return a date at UTC midnight.
// These are whitelisted constants chosen by granularity, never user input.
const bucketSql = (alias) => {
    const local = `((${alias}.created_at AT TIME ZONE 'UTC') + interval '7 hours')`;
    return Object.freeze({
        year: `date_trunc('year', ${local})::date`,
        quarter: `date_trunc('quarter', ${local})::date`,
        month: `date_trunc('month', ${local})::date`,
        week: `date_trunc('week', ${local})::date`
    });
};
const ORDER_BUCKET_SQL = bucketSql("o");
const USER_BUCKET_SQL = bucketSql("u");

const num = (value) => (value === null || value === undefined ? 0 : Number(value));

/** Headline numbers for the simple dashboard. */
const getSummary = async ({ newUsersSince }) => {
    const client = getPrismaClient();
    const [totalUsers, newUsers, orders, pendingOrders, revenue, topRows] = await Promise.all([
        client.user.count({ where: { role: "user" } }),
        client.user.count({ where: { role: "user", createdAt: { gte: newUsersSince } } }),
        client.order.count({ where: { orderStatus: { not: "CANCELLED" } } }),
        client.order.count({ where: { orderStatus: "PENDING" } }),
        client.order.aggregate({ _sum: { totalPrice: true }, where: REVENUE_WHERE }),
        client.$queryRawUnsafe(
            `SELECT p.id AS "productId", p.name AS name, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN product_variants v ON v.id = oi.variant_id
             JOIN products p ON p.id = v.product_id
             WHERE o.order_status <> 'CANCELLED' AND ${REVENUE_SQL}
             GROUP BY p.id, p.name
             ORDER BY SUM(oi.quantity) DESC, p.id ASC
             LIMIT 5`
        )
    ]);
    return {
        totalUsers,
        newUsers,
        orders,
        pendingOrders,
        revenue: num(revenue._sum.totalPrice),
        topProducts: topRows.map((row) => ({
            productId: num(row.productId),
            name: row.name,
            quantity: num(row.quantity),
            revenue: num(row.revenue)
        }))
    };
};

/**
 * Per-bucket aggregates between two instants (to exclusive), every one a single GROUP BY:
 *  orders: non-cancelled orders placed, revenue orders' total and voucher+points deductions;
 *  items: revenue orders' lines per bucket and device type (units, line totals, cost at purchase);
 *  users: customer accounts (role 'user') created per bucket.
 */
const getSeriesRows = async ({ granularity, from, to }) => {
    const bucket = ORDER_BUCKET_SQL[granularity];
    const userBucket = USER_BUCKET_SQL[granularity];
    const client = getPrismaClient();
    const [orders, items, users] = await Promise.all([
        client.$queryRawUnsafe(
            `SELECT ${bucket} AS bucket,
                    COUNT(*) AS orders,
                    SUM(CASE WHEN ${REVENUE_SQL} THEN o.total_price ELSE 0 END) AS revenue,
                    SUM(CASE WHEN ${REVENUE_SQL} THEN o.discount + o.points_discount ELSE 0 END) AS deductions
             FROM orders o
             WHERE o.order_status <> 'CANCELLED' AND o.created_at >= $1 AND o.created_at < $2
             GROUP BY ${bucket}`,
            from,
            to
        ),
        client.$queryRawUnsafe(
            `SELECT ${bucket} AS bucket,
                    p.device_type AS "deviceType",
                    SUM(oi.quantity) AS quantity,
                    SUM(oi.line_total) AS "lineTotal",
                    SUM(oi.unit_cost * oi.quantity) AS cost
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN product_variants v ON v.id = oi.variant_id
             JOIN products p ON p.id = v.product_id
             WHERE o.order_status <> 'CANCELLED' AND ${REVENUE_SQL} AND o.created_at >= $1 AND o.created_at < $2
             GROUP BY ${bucket}, p.device_type`,
            from,
            to
        ),
        client.$queryRawUnsafe(
            `SELECT ${userBucket} AS bucket, COUNT(*) AS "newUsers"
             FROM users u
             WHERE u.role = 'user' AND u.created_at >= $1 AND u.created_at < $2
             GROUP BY ${userBucket}`,
            from,
            to
        )
    ]);
    return {
        orders: orders.map((row) => ({ bucket: row.bucket, orders: num(row.orders), revenue: num(row.revenue), deductions: num(row.deductions) })),
        items: items.map((row) => ({
            bucket: row.bucket,
            deviceType: row.deviceType,
            quantity: num(row.quantity),
            lineTotal: num(row.lineTotal),
            cost: num(row.cost)
        })),
        users: users.map((row) => ({ bucket: row.bucket, newUsers: num(row.newUsers) }))
    };
};

module.exports = { getSummary, getSeriesRows };
