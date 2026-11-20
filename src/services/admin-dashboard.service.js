// ===== ADMIN DASHBOARD SERVICE =====
// Simple dashboard (summary) and advanced dashboard (series). Definitions live in GLOSSARY: Revenue, Profit.
//   orders    = orders placed in the period that are not CANCELLED
//   revenue   = total price of those orders that are PAID or DELIVERED
//   profit    = per revenue order: sum(line total - unit cost x quantity) - voucher discount - points discount
//   itemsSold / deviceTypes = units on revenue orders (deviceTypes: units per product type; its keys are the distinct types sold)
//   newUsers  = customer accounts (role 'user', any status) created in the period
// Every figure is bucketed by shop time (UTC+7, weeks start Monday) and grouped in SQL; empty buckets are returned as zeros.
// getSeries also returns `previous`, the comparison period, from one extra repository call with the same grouping:
//   - range = whole calendar months (year, quarter, month, or several months): the same number of whole months right before
//     (2026 -> 2025, Q1/2026 -> Q4/2025, March -> February);
//   - any other range (custom days, year to date): the equal-length range ending the day before `from`.
//   previous = { from, to, totals, change }; totals has the same fields and units (đồng, units, accounts) as the current totals;
//   change[field] = (current - previous) / |previous| x 100, rounded to 1 decimal, or null when the previous total is 0.

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

/** Totals of one range from its aggregate rows (every row is already inside the range, so nothing is filtered). */
const totalsOf = (rows) => {
    const totals = { orders: 0, revenue: 0, profit: 0, itemsSold: 0, newUsers: 0 };
    for (const row of rows.orders) {
        totals.orders += row.orders;
        totals.revenue += row.revenue;
        totals.profit -= row.deductions;
    }
    for (const row of rows.items) {
        totals.itemsSold += row.quantity;
        totals.profit += row.lineTotal - row.cost;
    }
    for (const row of rows.users) totals.newUsers += row.newUsers;
    return totals;
};

/** Percentage change from previous to current, one decimal; null when there is nothing to compare against. */
const percentChange = (current, previous) => {
    if (!previous) return null;
    return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};

const getSeries = async (query = {}, now = new Date()) => {
    const { granularity, fromDate, toDate } = seriesRange(query, now);
    const endExclusive = period.addDays(toDate, 1);
    const before = period.previousRange(fromDate, toDate);

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
            deviceTypes: {},
            newUsers: 0
        });
    }

    const [rows, previousRows] = await Promise.all([
        repository.getSeriesRows({ granularity, from: period.toInstant(fromDate), to: period.toInstant(endExclusive) }),
        repository.getSeriesRows({ granularity, from: period.toInstant(before.fromDate), to: period.toInstant(period.addDays(before.toDate, 1)) })
    ]);

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
    for (const row of rows.users) {
        const bucket = buckets.get(bucketKey(row.bucket));
        if (bucket) bucket.newUsers += row.newUsers;
    }

    const list = [...buckets.values()];
    const totals = totalsOf(rows);
    const previousTotals = totalsOf(previousRows);
    return {
        granularity,
        from: period.isoDate(fromDate),
        to: period.isoDate(toDate),
        totals,
        buckets: list,
        deviceTypes: [...byType.values()].sort((a, b) => b.quantity - a.quantity || a.deviceType.localeCompare(b.deviceType)),
        previous: {
            from: period.isoDate(before.fromDate),
            to: period.isoDate(before.toDate),
            totals: previousTotals,
            change: Object.fromEntries(Object.keys(totals).map((field) => [field, percentChange(totals[field], previousTotals[field])]))
        }
    };
};

module.exports = { getSummary, getSeries };
