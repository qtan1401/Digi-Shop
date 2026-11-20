// ===== ADMIN PERIOD HELPERS =====
// The shop works in Vietnam time (UTC+7, no daylight saving). Order timestamps are stored in UTC, so every
// "today / this week / this year" boundary used by the admin order list and dashboard is computed here, once.
// Weeks start on Monday. All range ends are exclusive instants.

const OFFSET_MS = 7 * 3600e3;
const DAY_MS = 86400e3;

// A "local date" is a Date whose UTC fields hold the shop-local calendar fields (a pure calendar value).
const toLocalDate = (instant) => new Date(instant.getTime() + OFFSET_MS);
const toInstant = (localDate) => new Date(localDate.getTime() - OFFSET_MS);
const startOfLocalDay = (localDate) =>
    new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()));
const addDays = (localDate, days) => new Date(localDate.getTime() + days * DAY_MS);

const mondayOf = (localDate) => {
    const day = startOfLocalDay(localDate);
    const sinceMonday = (day.getUTCDay() + 6) % 7;
    return addDays(day, -sinceMonday);
};

const GRANULARITIES = Object.freeze(["year", "quarter", "month", "week"]);

const bucketStart = (granularity, localDate) => {
    const year = localDate.getUTCFullYear();
    const month = localDate.getUTCMonth();
    if (granularity === "year") return new Date(Date.UTC(year, 0, 1));
    if (granularity === "quarter") return new Date(Date.UTC(year, month - (month % 3), 1));
    if (granularity === "month") return new Date(Date.UTC(year, month, 1));
    return mondayOf(localDate);
};

const nextBucketStart = (granularity, start) => {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth();
    if (granularity === "year") return new Date(Date.UTC(year + 1, 0, 1));
    if (granularity === "quarter") return new Date(Date.UTC(year, month + 3, 1));
    if (granularity === "month") return new Date(Date.UTC(year, month + 1, 1));
    return addDays(start, 7);
};

const two = (value) => String(value).padStart(2, "0");
const isoDate = (localDate) =>
    `${localDate.getUTCFullYear()}-${two(localDate.getUTCMonth() + 1)}-${two(localDate.getUTCDate())}`;

const bucketLabel = (granularity, start) => {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth();
    if (granularity === "year") return String(year);
    if (granularity === "quarter") return `Q${Math.floor(month / 3) + 1}/${year}`;
    if (granularity === "month") return `T${month + 1}/${year}`;
    return `${two(start.getUTCDate())}/${two(month + 1)}`;
};

/** Parses YYYY-MM-DD into a local date, or undefined when it is not a real calendar date. */
const parseIsoDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 2000 || year > 2200) return undefined;
    const date = new Date(Date.UTC(year, month - 1, day));
    return isoDate(date) === value ? date : undefined;
};

/**
 * The range compared against an inclusive local-date range [fromDate, toDate] ("previous period").
 * - Whole calendar months (from on the 1st, to on the last day of a month; so a calendar month, quarter or year, or
 *   any run of whole months): the same number of whole months immediately before, e.g. 2026 -> 2025,
 *   Q1/2026 -> Q4/2025, March 2026 -> February 2026, Nov 2025 - Feb 2026 -> Jul - Oct 2025.
 * - Anything else (custom day ranges, year to date): the equal-length range ending the day before `fromDate`.
 * Returns inclusive local dates { fromDate, toDate }.
 */
const previousRange = (fromDate, toDate) => {
    const previousTo = addDays(fromDate, -1);
    const wholeMonths = fromDate.getUTCDate() === 1 && addDays(toDate, 1).getUTCDate() === 1;
    if (wholeMonths) {
        const months = (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 + toDate.getUTCMonth() - fromDate.getUTCMonth() + 1;
        return { fromDate: new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() - months, 1)), toDate: previousTo };
    }
    const days = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
    return { fromDate: addDays(previousTo, -(days - 1)), toDate: previousTo };
};

/**
 * Named range -> { from, to } instants (to exclusive). `custom` takes inclusive local dates (either may be missing).
 * Returns undefined for an unknown name.
 */
const namedRange = (name, now = new Date(), { fromDate, toDate } = {}) => {
    const today = startOfLocalDay(toLocalDate(now));
    if (name === "today") return { from: toInstant(today), to: toInstant(addDays(today, 1)) };
    if (name === "yesterday") return { from: toInstant(addDays(today, -1)), to: toInstant(today) };
    if (name === "week") {
        const monday = mondayOf(today);
        return { from: toInstant(monday), to: toInstant(addDays(monday, 7)) };
    }
    if (name === "month") {
        const first = bucketStart("month", today);
        return { from: toInstant(first), to: toInstant(nextBucketStart("month", first)) };
    }
    if (name === "custom") {
        return {
            from: fromDate ? toInstant(fromDate) : undefined,
            to: toDate ? toInstant(addDays(toDate, 1)) : undefined
        };
    }
    return undefined;
};

module.exports = {
    GRANULARITIES,
    OFFSET_MS,
    toLocalDate,
    toInstant,
    startOfLocalDay,
    addDays,
    bucketStart,
    nextBucketStart,
    bucketLabel,
    isoDate,
    parseIsoDate,
    previousRange,
    namedRange
};
