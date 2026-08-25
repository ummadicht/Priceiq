// "Last change" is the dashboard's most valuable column. These tests exist to
// keep it true — which mostly means keeping re-scrapes from counting as changes.

import assert from "node:assert/strict";
import { classify, changeLog, lastChangeAt, isMovement, since, runHeadline } from "../observation.ts";
import { fromMajor } from "../money.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

const obs = (at, major, currency = "NZD") => ({
  programId: "apple-nz", deviceId: "apple-iphone-15-pro-max-512",
  conditionLabel: "Good", price: major === null ? null : fromMajor(major, currency),
  observedAt: at, runId: "r-" + at, sourceUrl: "https://example.test/x",
});

console.log("classifying one step");
t("the first observation is first_seen, not an increase from nothing", () => {
  const e = classify(null, obs("2026-08-01T00:00:00Z", 890));
  assert.equal(e.kind, "first_seen");
  assert.equal(e.deltaMinor, 0);
});
t("A RE-SCRAPE AT THE SAME PRICE IS NOT A CHANGE", () => {
  // The cheapest possible bug, and it destroys the product's core signal.
  const e = classify(obs("2026-08-01T00:00:00Z", 890), obs("2026-08-03T00:00:00Z", 890));
  assert.equal(e.kind, "unchanged");
  assert.equal(isMovement(e.kind), false);
});
t("increases and decreases carry signed delta and percentage", () => {
  const up = classify(obs("2026-08-01T00:00:00Z", 800), obs("2026-08-03T00:00:00Z", 890));
  assert.equal(up.kind, "increase");
  assert.equal(up.deltaMinor, 9000);
  assert.equal(up.pctChange, 11.25);

  const down = classify(obs("2026-08-01T00:00:00Z", 890), obs("2026-08-03T00:00:00Z", 800));
  assert.equal(down.kind, "decrease");
  assert.equal(down.deltaMinor, -9000);
  assert.ok(down.pctChange < 0);
});
t("A NULL IS NOT A ZERO — delisting is its own event", () => {
  const gone = classify(obs("2026-08-01T00:00:00Z", 890), obs("2026-08-03T00:00:00Z", null));
  assert.equal(gone.kind, "delisted");
  const zero = classify(obs("2026-08-01T00:00:00Z", 890), obs("2026-08-03T00:00:00Z", 0));
  assert.equal(zero.kind, "decrease");
  assert.notEqual(zero.kind, gone.kind);
});
t("coming back is relisted, not first_seen", () => {
  const back = classify(obs("2026-08-03T00:00:00Z", null), obs("2026-08-05T00:00:00Z", 850));
  assert.equal(back.kind, "relisted");
});
t("A CURRENCY SWITCH IS NOT A 98% PRICE CUT", () => {
  // NZD 890 → INR 45000 is a re-denomination. Treating it as a movement
  // produces a spectacular fake alert.
  const e = classify(obs("2026-08-01T00:00:00Z", 890, "NZD"), obs("2026-08-03T00:00:00Z", 45000, "INR"));
  assert.equal(e.kind, "currency_changed");
  assert.equal(e.pctChange, null);
  assert.equal(isMovement(e.kind), false);
});
t("a move away from zero has no percentage rather than Infinity", () => {
  const e = classify(obs("2026-08-01T00:00:00Z", 0), obs("2026-08-03T00:00:00Z", 500));
  assert.equal(e.kind, "increase");
  assert.equal(e.pctChange, null);
});

console.log("\nseries");
const SERIES = [
  obs("2026-05-01T00:00:00Z", 950),
  obs("2026-05-03T00:00:00Z", 950),
  obs("2026-05-05T00:00:00Z", 950),
  obs("2026-06-01T00:00:00Z", 890),   // the only real move
  obs("2026-06-03T00:00:00Z", 890),
  obs("2026-08-20T00:00:00Z", 890),
];
t("a flat series logs its start and its one movement, nothing else", () => {
  const log = changeLog(SERIES);
  assert.equal(log.length, 2);
  assert.equal(log[0].kind, "first_seen");
  assert.equal(log[1].kind, "decrease");
});
t("LAST CHANGE IS THE LAST MOVE, not the last scrape", () => {
  assert.equal(lastChangeAt(SERIES), "2026-06-01T00:00:00Z");
});
t("a never-moved price has NO last change", () => {
  // "Last change: today" on a brand-new listing would be a lie.
  const flat = [obs("2026-08-01T00:00:00Z", 890), obs("2026-08-03T00:00:00Z", 890)];
  assert.equal(lastChangeAt(flat), null);
});
t("out-of-order observations are sorted before classification", () => {
  const shuffled = [SERIES[3], SERIES[0], SERIES[5], SERIES[1]];
  assert.equal(lastChangeAt(shuffled), "2026-06-01T00:00:00Z");
});
t("an empty series does not throw", () => {
  assert.deepEqual(changeLog([]), []);
  assert.equal(lastChangeAt([]), null);
});

console.log("\ndashboard formatting");
t("elapsed time reads the way the cards do", () => {
  const now = Date.parse("2026-08-20T12:00:00Z");
  assert.equal(since("2026-08-20T04:00:00Z", now), "8h");
  assert.equal(since("2026-08-06T12:00:00Z", now), "2w");
  assert.equal(since("2026-05-20T12:00:00Z", now), "3mo");
  assert.equal(since(null, now), "—");
  assert.equal(since("nonsense", now), "—");
});
t("UNMATCHED ROWS ARE REPORTED SEPARATELY FROM ERRORS", () => {
  // A scraper error and an incomplete catalogue need different people. Rolling
  // them together hides whichever one is quietly growing.
  const h = runHeadline({ runId: "r1", programId: "p", startedAt: "", finishedAt: null,
    status: "succeeded", captured: 1425, errors: 1, quarantined: 12 });
  assert.match(h, /succeeded 1425\/1/);
  assert.match(h, /12 unmatched/);
  const clean = runHeadline({ runId: "r2", programId: "p", startedAt: "", finishedAt: null,
    status: "succeeded", captured: 17, errors: 0, quarantined: 0 });
  assert.equal(clean, "succeeded 17/0");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
