const assert = require("node:assert/strict");
const { test } = require("node:test");
const period = require("../src/services/admin-period");

const d = (iso) => period.parseIsoDate(iso);
const iso = (localDate) => period.isoDate(localDate);
const local = (instant) => iso(period.toLocalDate(new Date(instant)));

test("shop time is UTC+7: 16:59:59Z is still 31 December, 17:00:00Z is 1 January", () => {
    assert.equal(local("2025-12-31T16:59:59Z"), "2025-12-31");
    assert.equal(local("2025-12-31T17:00:00Z"), "2026-01-01");
    assert.equal(period.toInstant(d("2026-01-01")).toISOString(), "2025-12-31T17:00:00.000Z");
});

test("weeks start on Monday and a week can cross the year boundary", () => {
    const monday = (value) => iso(period.bucketStart("week", d(value)));
    assert.equal(monday("2026-01-01"), "2025-12-29", "Thursday 1 Jan");
    assert.equal(monday("2025-12-29"), "2025-12-29", "a Monday is its own week start");
    assert.equal(monday("2026-01-04"), "2025-12-29", "Sunday ends the week");
    assert.equal(monday("2026-01-05"), "2026-01-05");
    assert.equal(iso(period.nextBucketStart("week", d("2025-12-29"))), "2026-01-05");
});

test("quarters, months and years roll over at the year boundary", () => {
    assert.equal(iso(period.bucketStart("quarter", d("2025-12-31"))), "2025-10-01", "Q4");
    assert.equal(iso(period.bucketStart("quarter", d("2026-01-01"))), "2026-01-01", "Q1");
    assert.equal(iso(period.bucketStart("quarter", d("2026-03-31"))), "2026-01-01");
    assert.equal(iso(period.bucketStart("quarter", d("2026-04-01"))), "2026-04-01");
    assert.equal(iso(period.nextBucketStart("quarter", d("2025-10-01"))), "2026-01-01");
    assert.equal(iso(period.nextBucketStart("month", d("2025-12-01"))), "2026-01-01");
    assert.equal(iso(period.bucketStart("year", d("2025-12-31"))), "2025-01-01");
    assert.equal(iso(period.nextBucketStart("year", d("2025-01-01"))), "2026-01-01");
});

test("bucket labels", () => {
    assert.equal(period.bucketLabel("year", d("2025-01-01")), "2025");
    assert.equal(period.bucketLabel("quarter", d("2025-10-01")), "Q4/2025");
    assert.equal(period.bucketLabel("month", d("2025-12-01")), "T12/2025");
    assert.equal(period.bucketLabel("week", d("2025-12-29")), "29/12");
});

test("parseIsoDate accepts only real calendar dates", () => {
    assert.equal(iso(d("2024-02-29")), "2024-02-29");
    for (const bad of ["2025-02-29", "2026-02-30", "2026-13-01", "2026-2-1", "1999-12-31", "2026-01-01T00:00:00Z", "", undefined, 20260101]) {
        assert.equal(period.parseIsoDate(bad), undefined, String(bad));
    }
});

test("named ranges are exclusive-end instants in shop time", () => {
    const now = new Date("2025-12-31T17:30:00Z"); // 1 Jan 2026 00:30 in Vietnam, a Thursday
    const span = ({ from, to }) => [from.toISOString(), to.toISOString()];
    assert.deepEqual(span(period.namedRange("today", now)), ["2025-12-31T17:00:00.000Z", "2026-01-01T17:00:00.000Z"]);
    assert.deepEqual(span(period.namedRange("yesterday", now)), ["2025-12-30T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
    assert.deepEqual(span(period.namedRange("week", now)), ["2025-12-28T17:00:00.000Z", "2026-01-04T17:00:00.000Z"], "Monday 29 Dec to Monday 5 Jan");
    assert.deepEqual(span(period.namedRange("month", now)), ["2025-12-31T17:00:00.000Z", "2026-01-31T17:00:00.000Z"]);
    assert.deepEqual(span(period.namedRange("custom", now, { fromDate: d("2025-12-31"), toDate: d("2026-01-01") })), ["2025-12-30T17:00:00.000Z", "2026-01-01T17:00:00.000Z"]);
    assert.equal(period.namedRange("custom", now, { fromDate: d("2025-12-31") }).to, undefined);
    assert.equal(period.namedRange("decade", now), undefined);
});

test("previousRange: whole calendar months move back by the same number of months", () => {
    const span = (from, to) => {
        const range = period.previousRange(d(from), d(to));
        return [iso(range.fromDate), iso(range.toDate)];
    };
    assert.deepEqual(span("2026-01-01", "2026-12-31"), ["2025-01-01", "2025-12-31"], "year");
    assert.deepEqual(span("2026-01-01", "2026-03-31"), ["2025-10-01", "2025-12-31"], "Q1 -> Q4 of the previous year");
    assert.deepEqual(span("2026-04-01", "2026-06-30"), ["2026-01-01", "2026-03-31"], "Q2 -> Q1");
    assert.deepEqual(span("2026-03-01", "2026-03-31"), ["2026-02-01", "2026-02-28"], "month");
    assert.deepEqual(span("2024-03-01", "2024-03-31"), ["2024-02-01", "2024-02-29"], "leap February");
    assert.deepEqual(span("2026-01-01", "2026-01-31"), ["2025-12-01", "2025-12-31"], "January -> December");
    assert.deepEqual(span("2025-11-01", "2026-02-28"), ["2025-07-01", "2025-10-31"], "four months across two years");
});

test("previousRange: any other range is compared with the equal-length range ending the day before", () => {
    const span = (from, to) => {
        const range = period.previousRange(d(from), d(to));
        return [iso(range.fromDate), iso(range.toDate)];
    };
    assert.deepEqual(span("2026-03-16", "2026-03-16"), ["2026-03-15", "2026-03-15"], "one day");
    assert.deepEqual(span("2026-03-10", "2026-03-22"), ["2026-02-25", "2026-03-09"], "13 days");
    assert.deepEqual(span("2026-01-01", "2026-06-15"), ["2025-07-19", "2025-12-31"], "year to date: 166 days");
    assert.deepEqual(span("2026-01-05", "2026-01-11"), ["2025-12-29", "2026-01-04"], "a week across the year boundary");
    assert.deepEqual(span("2026-03-02", "2026-03-31"), ["2026-01-31", "2026-03-01"], "not starting on the 1st: 30 days");
});
