// ===== ADMIN DASHBOARD REPOSITORY =====
// Aggregates only: nothing here loads orders into the application. Grouping is done in SQL Server.
// A "revenue order" is not CANCELLED and is PAID or DELIVERED (see GLOSSARY: Revenue).

const { getPrismaClient } = require("../db/prisma");

const REVENUE_WHERE = Object.freeze({
    orderStatus: { not: "CANCELLED" },
    OR: [{ paymentStatus: "PAID" }, { orderStatus: "DELIVERED" }]
});
const REVENUE_SQL = "(o.payment_status = N'PAID' OR o.order_status = N'DELIVERED')";

// Bucket start as a calendar date in shop time (UTC+7). Weeks start on Monday (1900-01-01 was a Monday).
// These are whitelisted constants chosen by granularity, never user input.
const LOCAL = "DATEADD(hour, 7, o.created_at)";
const BUCKET_SQL = Object.freeze({
    year: `DATEFROMPARTS(YEAR(${LOCAL}), 1, 1)`,
    quarter: `DATEFROMPARTS(YEAR(${LOCAL}), ((DATEPART(quarter, ${LOCAL}) - 1) * 3) + 1, 1)`,
    month: `DATEFROMPARTS(YEAR(${LOCAL}), MONTH(${LOCAL}), 1)`,
    week: `DATEADD(day, -(DATEDIFF(day, '19000101', CAST(${LOCAL} AS date)) % 7), CAST(${LOCAL} AS date))`
});

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
            `SELECT TOP 5 p.id AS productId, p.name AS name, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN product_variants v ON v.id = oi.variant_id
             JOIN products p ON p.id = v.product_id
             WHERE o.order_status <> N'CANCELLED' AND ${REVENUE_SQL}
             GROUP BY p.id, p.name
             ORDER BY SUM(oi.quantity) DESC, p.id ASC`
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
 * Per-bucket aggregates between two instants (to exclusive):
 *  orders: non-cancelled orders placed, revenue orders' total and voucher+points deductions;
 *  items: revenue orders' lines per bucket and device type (units, line totals, cost at purchase).
 */
const getSeriesRows = async ({ granularity, from, to }) => {
    const bucket = BUCKET_SQL[granularity];
    const client = getPrismaClient();
    const [orders, items] = await Promise.all([
        client.$queryRawUnsafe(
            `SELECT ${bucket} AS bucket,
                    COUNT(*) AS orders,
                    SUM(CASE WHEN ${REVENUE_SQL} THEN o.total_price ELSE 0 END) AS revenue,
                    SUM(CASE WHEN ${REVENUE_SQL} THEN o.discount + o.points_discount ELSE 0 END) AS deductions
             FROM orders o
             WHERE o.order_status <> N'CANCELLED' AND o.created_at >= @P1 AND o.created_at < @P2
             GROUP BY ${bucket}`,
            from,
            to
        ),
        client.$queryRawUnsafe(
            `SELECT ${bucket} AS bucket,
                    p.device_type AS deviceType,
                    SUM(oi.quantity) AS quantity,
                    SUM(oi.line_total) AS lineTotal,
                    SUM(oi.unit_cost * oi.quantity) AS cost
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN product_variants v ON v.id = oi.variant_id
             JOIN products p ON p.id = v.product_id
             WHERE o.order_status <> N'CANCELLED' AND ${REVENUE_SQL} AND o.created_at >= @P1 AND o.created_at < @P2
             GROUP BY ${bucket}, p.device_type`,
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
        }))
    };
};

module.exports = { getSummary, getSeriesRows };
