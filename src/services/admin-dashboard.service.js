// ===== ADMIN DASHBOARD SERVICE =====
// Simple dashboard (summary) and advanced dashboard (series). Definitions live in GLOSSARY: Revenue, Profit.
//   orders  = orders placed in the period that are not CANCELLED
//   revenue = total price of those orders that are PAID or DELIVERED
//   profit  = per revenue order: sum(line total - unit cost x quantity) - voucher discount - points discount
//   itemsSold / deviceTypes = units on revenue orders

const repository = require("../repositories/admin-dashboard.repository");
const period = require("./admin-period");

const NEW_USER_DAYS = 7;
const MAX_BUCKETS = 400;

const invalidFilter = (message = "Bộ lọc không hợp lệ") => {
    const error = new Error(message);
    error.code = "INVALID_FILTER";
    error.statusCode = 400;
    return error;
};

const getSummary = async (now = new Date()) => {
    const newUsersSince = new Date(now.getTime() - NEW_USER_DAYS * 86400e3);
    return await repository.getSummary({ newUsersSince });
};

const bucketKey = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return period.isoDate(date);
};

/** The inclusive local-date range of a query; defaults to the current calendar year. */
const seriesRange = (query, now) => {
    for (const key of ["granularity", "from", "to"]) {
        if (query[key] !== undefined && typeof query[key] !== "string") throw invalidFilter();
    }
    const granularity = query.granularity === undefined ? "month" : query.granularity;
    if (!period.GRANULARITIES.includes(granularity)) throw invalidFilter("Chu kỳ thống kê không hợp lệ");

    const today = period.startOfLocalDay(period.toLocalDate(now));
    const year = today.getUTCFullYear();
    const fromDate = query.from === undefined ? new Date(Date.UTC(year, 0, 1)) : period.parseIsoDate(query.from);
    const toDate = query.to === undefined ? new Date(Date.UTC(year, 11, 31)) : period.parseIsoDate(query.to);
    if (!fromDate || !toDate || fromDate > toDate) throw invalidFilter("Khoảng thời gian không hợp lệ");
    return { granularity, fromDate, toDate };
};

const getSeries = async (query = {}, now = new Date()) => {
    const { granularity, fromDate, toDate } = seriesRange(query, now);
    const endExclusive = period.addDays(toDate, 1);

    const buckets = new Map();
    for (let start = period.bucketStart(granularity, fromDate); start < endExclusive; start = period.nextBucketStart(granularity, start)) {
        if (buckets.size >= MAX_BUCKETS) throw invalidFilter("Khoảng thời gian quá dài cho chu kỳ đã chọn");
        const key = period.isoDate(start);
        buckets.set(key, {
            key,
            label: period.bucketLabel(granularity, start),
            orders: 0,
            revenue: 0,
            profit: 0,
            itemsSold: 0,
            deviceTypes: {}
        });
    }

    const rows = await repository.getSeriesRows({
        granularity,
        from: period.toInstant(fromDate),
        to: period.toInstant(endExclusive)
    });

    for (const row of rows.orders) {
        const bucket = buckets.get(bucketKey(row.bucket));
        if (!bucket) continue;
        bucket.orders += row.orders;
        bucket.revenue += row.revenue;
        bucket.profit -= row.deductions;
    }
    const byType = new Map();
    for (const row of rows.items) {
        const bucket = buckets.get(bucketKey(row.bucket));
        if (!bucket) continue;
        bucket.itemsSold += row.quantity;
        bucket.profit += row.lineTotal - row.cost;
        bucket.deviceTypes[row.deviceType] = (bucket.deviceTypes[row.deviceType] || 0) + row.quantity;
        const total = byType.get(row.deviceType) || { deviceType: row.deviceType, quantity: 0, revenue: 0 };
        total.quantity += row.quantity;
        total.revenue += row.lineTotal;
        byType.set(row.deviceType, total);
    }

    const list = [...buckets.values()];
    const sum = (field) => list.reduce((total, bucket) => total + bucket[field], 0);
    return {
        granularity,
        from: period.isoDate(fromDate),
        to: period.isoDate(toDate),
        totals: { orders: sum("orders"), revenue: sum("revenue"), profit: sum("profit"), itemsSold: sum("itemsSold") },
        buckets: list,
        deviceTypes: [...byType.values()].sort((a, b) => b.quantity - a.quantity || a.deviceType.localeCompare(b.deviceType))
    };
};

module.exports = { getSummary, getSeries };
