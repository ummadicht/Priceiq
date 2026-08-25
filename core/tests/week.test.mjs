// Week-on-week is the headline of a manually-entered dataset, and manual entry
// is irregular. These tests are about the two ways an irregular series lies:
// averaging two entries in one week, and calling a fortnight's drift a
// week-on-week move.

import assert from "node:assert/strict";
import { isoWeek, weekStart, weeksBetween, toWeekly, weekOnWeek, wowLabel, currentWeek } from "../week.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

console.log("ISO weeks");
t("a mid-year date lands in the right week", () => {
  assert.equal(isoWeek("2026-08-25T12:00:00Z").key, "2026-W35");
});
t("the week starts on Monday", () => {
  // 2026-08-24 is a Monday; the Sunday before belongs to the previous week.
  assert.equal(isoWeek("2026-08-24T00:00:00Z").key, "2026-W35");
  assert.equal(isoWeek("2026-08-23T23:59:59Z").key, "2026-W34");
});
t("NEW YEAR ROLLOVER follows ISO, not the calendar", () => {
  // 2026-12-31 is a Thursday, so it belongs to 2026-W53.
  assert.equal(isoWeek("2026-12-31T00:00:00Z").key, "2026-W53");
  // 2027-01-01 is a Friday — still 2026-W53.
  assert.equal(isoWeek("2027-01-01T00:00:00Z").key, "2026-W53");
  // 2025-12-29 is a Monday and belongs to 2026-W01.
  assert.equal(isoWeek("2025-12-29T00:00:00Z").key, "2026-W01");
});
t("weekStart round-trips", () => {
  for (const k of ["2026-W01", "2026-W35", "2026-W53"]) {
    const s = weekStart(k);
    assert.ok(s, k);
    assert.equal(isoWeek(s + "T00:00:00Z").key, k, `${k} -> ${s}`);
    assert.equal(new Date(s + "T00:00:00Z").getUTCDay(), 1, `${s} is not a Monday`);
  }
});
t("garbage in gives null, not a wrong week", () => {
  assert.equal(isoWeek("not-a-date"), null);
  assert.equal(weekStart("2026-W99"), null);
  assert.equal(weekStart("nonsense"), null);
});
t("weeksBetween counts whole weeks and signs them", () => {
  assert.equal(weeksBetween("2026-W30", "2026-W33"), 3);
  assert.equal(weeksBetween("2026-W33", "2026-W30"), -3);
  assert.equal(weeksBetween("2026-W35", "2026-W35"), 0);
});

console.log("\ncollapsing entries into weeks");
const e = (at, amt, cur = "USD", by = "") => ({ observedAt: at, amountMinor: amt, currency: cur, enteredBy: by });

t("TWO ENTRIES IN ONE WEEK: the last wins, and the count is kept", () => {
  // Averaging would invent a price nobody quoted. A later manual entry is a
  // correction, not a second independent sample.
  const w = toWeekly([
    e("2026-08-25T09:00:00Z", 90000, "USD", "ammar"),
    e("2026-08-27T16:00:00Z", 92500, "USD", "ammar"),
  ]);
  assert.equal(w.length, 1);
  assert.equal(w[0].amountMinor, 92500);
  assert.equal(w[0].entries, 2);
});
t("out-of-order entries still resolve to the latest", () => {
  const w = toWeekly([
    e("2026-08-27T16:00:00Z", 92500),
    e("2026-08-25T09:00:00Z", 90000),
  ]);
  assert.equal(w[0].amountMinor, 92500);
});
t("weeks come back in order", () => {
  const w = toWeekly([e("2026-08-25T00:00:00Z", 100), e("2026-08-04T00:00:00Z", 200), e("2026-08-11T00:00:00Z", 300)]);
  assert.deepEqual(w.map((x) => x.week), ["2026-W32", "2026-W33", "2026-W35"]);
});
t("an undated entry is dropped rather than bucketed wrongly", () => {
  assert.equal(toWeekly([e("nope", 100)]).length, 0);
});

console.log("\nweek on week");
t("the first week is 'first', not a rise from zero", () => {
  const r = weekOnWeek(toWeekly([e("2026-08-25T00:00:00Z", 90000)]));
  assert.equal(r[0].kind, "first");
  assert.equal(r[0].pctChange, null);
  assert.equal(r[0].deltaMinor, 0);
});
t("consecutive weeks give a true week-on-week move", () => {
  const r = weekOnWeek(toWeekly([
    e("2026-08-18T00:00:00Z", 90000),
    e("2026-08-25T00:00:00Z", 85500),
  ]));
  assert.equal(r[1].kind, "down");
  assert.equal(r[1].deltaMinor, -4500);
  assert.equal(r[1].pctChange, -5);
  assert.equal(r[1].spanWeeks, 1);
  assert.equal(r[1].spansGap, false);
  assert.match(wowLabel(r[1]), /week on week/);
});
t("A GAP IS MARKED — a fortnight's drift is not a week-on-week move", () => {
  const r = weekOnWeek(toWeekly([
    e("2026-08-04T00:00:00Z", 100000),
    e("2026-08-25T00:00:00Z", 95000),   // three weeks later
  ]));
  assert.equal(r[1].spanWeeks, 3);
  assert.equal(r[1].spansGap, true);
  assert.equal(r[1].pctChange, -5);
  assert.match(wowLabel(r[1]), /over 3 weeks/);
  assert.doesNotMatch(wowLabel(r[1]), /week on week/);
});
t("RE-ENTERING THE SAME PRICE IS 'unchanged', not a change", () => {
  const r = weekOnWeek(toWeekly([
    e("2026-08-18T00:00:00Z", 90000),
    e("2026-08-25T00:00:00Z", 90000),
  ]));
  assert.equal(r[1].kind, "unchanged");
  assert.equal(r[1].deltaMinor, 0);
  assert.equal(r[1].pctChange, 0);
});
t("A CURRENCY SWITCH IS NOT A COLLAPSE", () => {
  const r = weekOnWeek(toWeekly([
    e("2026-08-18T00:00:00Z", 90000, "USD"),
    e("2026-08-25T00:00:00Z", 7500000, "INR"),
  ]));
  assert.equal(r[1].kind, "currency_changed");
  assert.equal(r[1].pctChange, null);
  assert.match(wowLabel(r[1]), /not a price move/);
});
t("a move away from zero has no percentage rather than Infinity", () => {
  const r = weekOnWeek(toWeekly([
    e("2026-08-18T00:00:00Z", 0),
    e("2026-08-25T00:00:00Z", 5000),
  ]));
  assert.equal(r[1].kind, "up");
  assert.equal(r[1].pctChange, null);
});
t("an empty series does not throw", () => {
  assert.deepEqual(weekOnWeek([]), []);
  assert.deepEqual(toWeekly([]), []);
});
t("the form defaults to a real current week", () => {
  assert.match(currentWeek(new Date("2026-08-25T00:00:00Z")), /^2026-W\d\d$/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
