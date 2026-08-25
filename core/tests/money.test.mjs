// Money bugs in a price-intelligence product are indistinguishable from
// insight: a yen price shown at 1/100th looks like an arbitrage opportunity.
// These tests target the two silent killers — minor-unit assumptions and
// conversion at the wrong date.

import assert from "node:assert/strict";
import {
  money, fromMajor, toMajor, minorDigits, formatMoney, convert, MAX_RATE_AGE_DAYS,
} from "../money.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

console.log("minor units");
t("NOT EVERY CURRENCY HAS HUNDREDTHS", () => {
  assert.equal(minorDigits("NZD"), 2);
  assert.equal(minorDigits("INR"), 2);
  assert.equal(minorDigits("JPY"), 0);   // Yamada Denki is a real program
  assert.equal(minorDigits("KRW"), 0);   // so is SK Telecom
  assert.equal(minorDigits("KWD"), 3);
  assert.equal(minorDigits("XYZ"), 2);   // unknown → the safe common case
});
t("a yen price survives the round trip intact", () => {
  const y = fromMajor(89000, "JPY");
  assert.equal(y.amountMinor, 89000);    // NOT 8_900_000
  assert.equal(toMajor(y), 89000);
});
t("a two-decimal price survives the round trip intact", () => {
  const n = fromMajor(890.5, "NZD");
  assert.equal(n.amountMinor, 89050);
  assert.equal(toMajor(n), 890.5);
});
t("amounts stay integral — no float dust", () => {
  for (const v of [0.1, 0.2, 1.005, 19.99, 890.555]) {
    assert.equal(Number.isInteger(fromMajor(v, "NZD").amountMinor), true, String(v));
  }
});
t("formatting respects the currency's own decimals", () => {
  assert.ok(!formatMoney(fromMajor(89000, "JPY")).includes("."));
  assert.ok(formatMoney(fromMajor(890.5, "NZD")).includes("890.50"));
});

console.log("\nconversion uses the observation date");
const RATES = [
  { base: "NZD", quote: "INR", rate: 50.0, asOf: "2026-08-01" },
  { base: "NZD", quote: "INR", rate: 52.0, asOf: "2026-08-20" },
  { base: "USD", quote: "NZD", rate: 1.6,  asOf: "2026-08-20" },
];

t("the SAME currency converts to itself without needing a rate", () => {
  const r = convert(fromMajor(890, "NZD"), "NZD", "2026-08-20", []);
  assert.equal(r.ok, true);
  assert.equal(r.value.rateUsed, 1);
});
t("AN OLD OBSERVATION USES THE OLD RATE, not today's", () => {
  // This is the whole point: a chart converted at today's rate is a currency
  // history, not a price history, and it rewrites itself overnight.
  const old = convert(fromMajor(100, "NZD"), "INR", "2026-08-01", RATES);
  assert.equal(old.value.rateUsed, 50.0);
  assert.equal(toMajor(old.value.money), 5000);

  const recent = convert(fromMajor(100, "NZD"), "INR", "2026-08-20", RATES);
  assert.equal(recent.value.rateUsed, 52.0);
  assert.equal(toMajor(recent.value.money), 5200);
});
t("every conversion records the rate and date that produced it", () => {
  const r = convert(fromMajor(100, "NZD"), "INR", "2026-08-20", RATES);
  assert.equal(r.value.rateAsOf, "2026-08-20");
  assert.equal(r.value.rateUsed, 52);
  assert.equal(r.value.stale, false);
});
t("A STALE RATE IS FLAGGED rather than silently used", () => {
  const r = convert(fromMajor(100, "NZD"), "INR", "2026-09-30", RATES);
  assert.equal(r.ok, true);
  assert.equal(r.value.stale, true);
  assert.ok(r.value.rateAgeDays > MAX_RATE_AGE_DAYS);
});
t("a weekend observation is NOT flagged stale", () => {
  // Rates are not published at weekends; refusing them would hole every chart.
  const r = convert(fromMajor(100, "NZD"), "INR", "2026-08-22", RATES);
  assert.equal(r.value.stale, false);
});
t("an inverted pair is used correctly", () => {
  const r = convert(fromMajor(160, "NZD"), "USD", "2026-08-20", RATES);
  assert.equal(r.ok, true);
  assert.equal(Math.round(toMajor(r.value.money)), 100);   // 160 / 1.6
});
t("CROSSING MINOR-UNIT SHAPES does not shift the decimal point", () => {
  // NZD (2dp) → JPY (0dp). Moving integers directly would 100x the result.
  const r = convert(fromMajor(10, "NZD"), "JPY", "2026-08-20",
    [{ base: "NZD", quote: "JPY", rate: 90, asOf: "2026-08-20" }]);
  assert.equal(toMajor(r.value.money), 900);
  assert.equal(r.value.money.amountMinor, 900);
});

console.log("\nfailing safely");
t("a missing pair fails the row, not the comparison", () => {
  const r = convert(fromMajor(100, "NZD"), "EUR", "2026-08-20", RATES);
  assert.equal(r.ok, false);
  assert.match(r.why, /no NZD→EUR rate/);
});
t("a nonsense rate is refused rather than producing a number", () => {
  for (const bad of [0, -5, NaN, Infinity]) {
    const r = convert(fromMajor(100, "NZD"), "INR", "2026-08-20",
      [{ base: "NZD", quote: "INR", rate: bad, asOf: "2026-08-20" }]);
    assert.equal(r.ok, false, `rate ${bad} was accepted`);
  }
});
t("a rate with an unparseable date is not used", () => {
  const r = convert(fromMajor(100, "NZD"), "INR", "2026-08-20",
    [{ base: "NZD", quote: "INR", rate: 52, asOf: "not-a-date" }]);
  assert.equal(r.ok, false);
});
t("no target currency is a refusal", () => {
  assert.equal(convert(fromMajor(100, "NZD"), "", "2026-08-20", RATES).ok, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
