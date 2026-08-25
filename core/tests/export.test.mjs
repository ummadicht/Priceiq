// An export leaves the building and gets forwarded, pasted and quoted back
// months later. These tests are about it still being defensible when it does.

import assert from "node:assert/strict";
import { buildRows, toCsv, csvCell, exportSummary, EXPORT_COLUMNS } from "../export.ts";
import { fromMajor } from "../money.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

const RATES = [
  { base: "USD", quote: "INR", rate: 84.0902, asOf: "2026-08-25" },
  { base: "USD", quote: "INR", rate: 80.0,    asOf: "2026-06-01" },
];
const item = (o = {}) => ({
  programId: "exchange-in", programName: "Exchange (India)", market: "IN",
  deviceId: "apple-iphone-11-pro-max-4-512", brand: "Apple", model: "iPhone 11 Pro Max",
  sku: "4GB / 512GB", ramGb: 4, storageGb: 512,
  grade: "A", conditionSpan: "Flawless",
  price: fromMajor(17251.5, "INR"),
  observedAt: "2026-08-25T00:00:00Z", week: "2026-W35", source: "workbook",
  ...o,
});

console.log("dual currency");
t("every row carries local AND USD", () => {
  const [r] = buildRows([item()], RATES);
  assert.equal(r.localAmount, 17251.5);
  assert.equal(r.localCurrency, "INR");
  assert.equal(r.usdAmount, Math.round((17251.5 / 84.0902) * 100) / 100);
  assert.ok(r.usdAmount > 200 && r.usdAmount < 210);
});
t("THE RATE AND ITS DATE TRAVEL WITH THE ROW", () => {
  // Without them the file cannot be reproduced: recompute next month and you
  // cannot tell whether the price moved or the currency did.
  const [r] = buildRows([item()], RATES);
  assert.equal(r.usdRateAsOf, "2026-08-25");
  assert.equal(r.usdRateStale, false);
  // Quoted the way people quote it — local units per USD, ~84 not ~0.0119.
  assert.ok(r.usdRate > 80 && r.usdRate < 90, `got ${r.usdRate}`);
});

t("THE RATE RECONCILES WITH THE TWO AMOUNTS BESIDE IT", () => {
  // A reader will divide one by the other. It must land on the printed rate,
  // give or take the cent the USD column is rounded to.
  for (const obs of ["2026-08-25T00:00:00Z", "2026-06-01T00:00:00Z"]) {
    const [r] = buildRows([item({ observedAt: obs })], RATES);
    assert.ok(Math.abs(r.localAmount / r.usdAmount - r.usdRate) < 0.05, obs);
  }
});

t("ONE DAY, ONE RATE — it does not wobble down the column", () => {
  // Deriving it per row from rounded amounts printed 95.3587 / 95.3531 /
  // 95.3569, which reads as three rates rather than one and some rounding.
  const rows = buildRows(
    [item(), item({ price: fromMajor(9275, "INR") }), item({ price: fromMajor(3451.5, "INR") })],
    RATES
  );
  assert.equal(new Set(rows.map((r) => r.usdRate)).size, 1);
});
t("AN OLD OBSERVATION USES THE OLD RATE", () => {
  const [r] = buildRows([item({ observedAt: "2026-06-01T00:00:00Z" })], RATES);
  assert.equal(r.usdAmount, Math.round((17251.5 / 80) * 100) / 100);
  assert.ok(Math.abs(r.usdRate - 80) < 0.01, `got ${r.usdRate}`);
});
t("a stale rate is flagged and explained, not silently used", () => {
  const [r] = buildRows([item({ observedAt: "2026-12-01T00:00:00Z" })], RATES);
  assert.equal(r.usdRateStale, true);
  assert.match(r.usdNote, /days from the observation/);
});
t("A ROW WITH NO RATE STILL EXPORTS, with a reason", () => {
  // An empty USD cell meaning "no rate" must never look like zero.
  const [r] = buildRows([item({ price: fromMajor(100, "GBP") })], RATES);
  assert.equal(r.usdAmount, null);
  assert.equal(r.localAmount, 100);
  assert.match(r.usdNote, /no GBP→USD rate/);
});
t("a USD price converts to itself at 1", () => {
  const [r] = buildRows([item({ price: fromMajor(205.15, "USD") })], RATES);
  assert.equal(r.usdAmount, 205.15);
  assert.equal(r.usdRate, 1);   // a dollar is one dollar per dollar
});

console.log("\nCSV");
t("headers are stable and complete", () => {
  const csv = toCsv(buildRows([item()], RATES));
  assert.equal(csv.split("\n")[0], EXPORT_COLUMNS.join(","));
  assert.equal(csv.split("\n").length, 2);
});
t("QUOTES AND COMMAS ARE ESCAPED, not left to split the row", () => {
  assert.equal(csvCell('has, comma'), '"has, comma"');
  assert.equal(csvCell('has "quote"'), '"has ""quote"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
  const csv = toCsv(buildRows([item({ model: 'iPhone, "Pro" Max' })], RATES));
  assert.ok(csv.includes('"iPhone, ""Pro"" Max"'));
});
t("local amounts respect their currency's decimals", () => {
  const csv = toCsv(buildRows([item({ price: fromMajor(89000, "JPY") })], RATES));
  assert.ok(csv.includes(",89000,JPY,"), "JPY must not gain decimals");
});
t("an empty export is a header row, not an error", () => {
  assert.equal(toCsv([]), EXPORT_COLUMNS.join(","));
});

console.log("\nsummary a reader can check");
t("the summary counts what converted and what did not", () => {
  const rows = buildRows([item(), item({ price: fromMajor(100, "GBP") }), item({ observedAt: "2026-12-01T00:00:00Z" })], RATES);
  const s = exportSummary(rows);
  assert.equal(s.rows, 3);
  assert.equal(s.converted, 2);
  assert.equal(s.unconverted, 1);
  assert.equal(s.stale, 1);
  assert.deepEqual(s.currencies, ["GBP", "INR"]);
  assert.ok(s.rateRange.lo > 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
