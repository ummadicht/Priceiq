// A spread is one subtraction and a great deal of doubt. These tests are almost
// entirely about the doubt surviving the subtraction.

import assert from "node:assert/strict";
import { computeSpread, rankByChannel, summariseByChannel, formatGross, MAX_LEG_GAP_DAYS } from "../spread.ts";
import { spanOf } from "../condition.ts";
import { fromMajor, toMajor } from "../money.ts";
import { channelSanity, MIN_CREDIBLE_SAMPLE } from "../channel.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

const AT = "2026-08-20T00:00:00Z";
const RATES = [
  { base: "USD", quote: "INR", rate: 84, asOf: "2026-08-20" },
  { base: "USD", quote: "AED", rate: 3.67, asOf: "2026-08-20" },
];

const mp = (o = {}) => ({
  deviceId: "apple-iphone-15-pro-max-512", market: "US", channel: "wholesale",
  condition: spanOf("good"), price: fromMajor(1150, "USD"), observedAt: AT,
  sampleSize: 12, dispersionPct: 6, source: "internal desk", ...o,
});
const input = (o = {}) => {
  // marketPrice is pulled out and composed LAST: spreading `o` over a
  // already-composed marketPrice would put the raw partial back, producing an
  // object with no deviceId that computeSpread rightly refuses.
  const { marketPrice, ...rest } = o;
  return {
    programId: "gazelle-us", deviceId: "apple-iphone-15-pro-max-512", market: "US",
    tradeIn: { price: fromMajor(890, "USD"), condition: spanOf("good"), observedAt: AT },
    rates: RATES,
    ...rest,
    marketPrice: mp(marketPrice),
  };
};

console.log("the arithmetic");
t("a clean spread is firm and has no caveats", () => {
  const r = computeSpread(input());
  assert.equal(r.ok, true);
  assert.equal(r.spread.confidence, "firm");
  assert.deepEqual(r.spread.caveats, []);
  assert.equal(toMajor(r.spread.buy), 890);
  assert.equal(toMajor(r.spread.sell), 1150);
  assert.equal(r.spread.grossMinor, 26000);          // $260.00
  assert.equal(r.spread.grossPct, 22.61);            // margin ON SELL
});
t("A NEGATIVE SPREAD IS REPORTED, not hidden", () => {
  // Programmes really do overpay to win an upgrade. Those are the rows worth
  // knowing about, so they must survive to the surface.
  const r = computeSpread(input({ tradeIn: { price: fromMajor(1300, "USD"), condition: spanOf("good"), observedAt: AT } }));
  assert.equal(r.ok, true);
  assert.ok(r.spread.grossMinor < 0);
  assert.ok(r.spread.grossPct < 0);
  assert.match(formatGross(r.spread), /^−USD/);
});

console.log("\nconfidence propagates from the weakest input");
t("AN APPROXIMATE CONDITION MATCH IS NEVER FIRM", () => {
  const r = computeSpread(input({ marketPrice: { condition: spanOf("flawless", "good") } }));
  assert.equal(r.spread.confidence, "indicative");
  assert.ok(r.spread.caveats.some((c) => /approximate match/i.test(c)));
});
t("A THIN SAMPLE IS NEVER FIRM", () => {
  const r = computeSpread(input({ marketPrice: { sampleSize: 2 } }));
  assert.equal(r.spread.confidence, "indicative");
  assert.ok(r.spread.caveats.some((c) => new RegExp(String(MIN_CREDIBLE_SAMPLE)).test(c)));
  // ...but the number is still produced. A rough figure beats none at a counter.
  assert.equal(r.ok, true);
  assert.equal(r.spread.grossMinor, 26000);
});
t("SCATTERED COMPARABLES ARE NEVER FIRM", () => {
  const r = computeSpread(input({ marketPrice: { dispersionPct: 40 } }));
  assert.equal(r.spread.confidence, "indicative");
  assert.ok(r.spread.caveats.some((c) => /scattered/i.test(c)));
});
t("A STALE FX RATE IS NEVER FIRM", () => {
  const r = computeSpread({
    ...input(),
    tradeIn: { price: fromMajor(74760, "INR"), condition: spanOf("good"), observedAt: "2026-06-01T00:00:00Z" },
  });
  assert.equal(r.spread.confidence, "indicative");
  assert.ok(r.spread.caveats.some((c) => /FX rate/i.test(c)));
});
t("LEGS FROM DIFFERENT WEEKS ARE NEVER FIRM", () => {
  const r = computeSpread(input({
    tradeIn: { price: fromMajor(890, "USD"), condition: spanOf("good"), observedAt: "2026-07-01T00:00:00Z" },
  }));
  assert.equal(r.spread.confidence, "indicative");
  assert.ok(r.spread.caveats.some((c) => /days apart/i.test(c)));
  assert.ok(MAX_LEG_GAP_DAYS > 0);
});
t("caveats accumulate — every reason is listed, not just the first", () => {
  const r = computeSpread(input({
    marketPrice: { condition: spanOf("flawless", "good"), sampleSize: 1, dispersionPct: 55 },
  }));
  assert.ok(r.spread.caveats.length >= 3, `only ${r.spread.caveats.length} caveats`);
});

console.log("\nrefusing outright");
t("NON-OVERLAPPING CONDITIONS PRODUCE NO NUMBER AT ALL", () => {
  // A flawless market price minus a broken trade-in offer is a wonderful
  // margin describing nothing that exists.
  const r = computeSpread(input({ marketPrice: { condition: spanOf("broken") } }));
  assert.equal(r.ok, false);
  assert.match(r.why, /do not overlap/);
});
t("a missing FX pair refuses rather than guessing", () => {
  const r = computeSpread({
    ...input(),
    tradeIn: { price: fromMajor(3270, "AED"), condition: spanOf("good"), observedAt: AT },
    rates: [],
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /trade-in leg/);
});
t("a mismatched device or market refuses", () => {
  assert.equal(computeSpread(input({ deviceId: "something-else" })).ok, false);
  assert.equal(computeSpread({ ...input(), market: "IN" }).ok, false);
});

console.log("\ncross-currency spreads");
t("an Indian trade-in against a US wholesale price converts both legs", () => {
  const r = computeSpread({
    ...input(),
    tradeIn: { price: fromMajor(74760, "INR"), condition: spanOf("good"), observedAt: AT },
    reportIn: "USD",
  });
  assert.equal(r.ok, true);
  assert.equal(r.spread.currency, "USD");
  assert.equal(toMajor(r.spread.buy), 890);          // 74760 / 84
  assert.equal(r.spread.grossMinor, 26000);
});

console.log("\nsorting by channel");
const sp = (channel, grossPct, confidence, programId) => ({
  deviceId: "d", market: "US", channel, programId, currency: "USD",
  buy: fromMajor(100, "USD"), sell: fromMajor(100 + grossPct, "USD"),
  grossMinor: grossPct * 100, grossPct, confidence, caveats: confidence === "firm" ? [] : ["x"],
});
t("ranking is per channel and ignores other channels entirely", () => {
  const all = [sp("wholesale", 22, "firm", "a"), sp("retail", 40, "firm", "b"), sp("wholesale", 30, "firm", "c")];
  const w = rankByChannel(all, "wholesale");
  assert.equal(w.length, 2);
  assert.deepEqual(w.map((s) => s.programId), ["c", "a"]);
});
t("A FIRM SPREAD ALWAYS OUTRANKS A BIGGER INDICATIVE ONE", () => {
  // Sorting on margin alone sends the buyer at the row the system is least
  // sure about — which quietly discards the entire confidence model.
  const all = [sp("wholesale", 30, "indicative", "risky"), sp("wholesale", 22, "firm", "solid")];
  assert.deepEqual(rankByChannel(all, "wholesale").map((s) => s.programId), ["solid", "risky"]);
});
t("channel summaries carry the best row, the counts and a median", () => {
  const all = [
    sp("wholesale", 20, "firm", "a"), sp("wholesale", 30, "indicative", "b"),
    sp("retail", 45, "firm", "c"),
  ];
  const rows = summariseByChannel(all, ["retail", "wholesale", "auction"]);
  assert.equal(rows.length, 3);
  const w = rows.find((r) => r.channel === "wholesale");
  assert.equal(w.count, 2);
  assert.equal(w.firmCount, 1);
  assert.equal(w.best.programId, "a");             // firm first
  assert.equal(w.medianGrossPct, 25);
  const empty = rows.find((r) => r.channel === "auction");
  assert.equal(empty.best, null);
  assert.equal(empty.medianGrossPct, null);
});

console.log("\ndataset sanity");
t("wholesale priced above retail is REPORTED, never silently reordered", () => {
  const problems = channelSanity([
    mp({ channel: "retail", price: fromMajor(900, "USD") }),
    mp({ channel: "wholesale", price: fromMajor(1150, "USD") }),
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Wholesale is priced above Retail/);
});
t("a sane ladder reports nothing", () => {
  assert.deepEqual(channelSanity([
    mp({ channel: "retail", price: fromMajor(1400, "USD") }),
    mp({ channel: "wholesale", price: fromMajor(1150, "USD") }),
    mp({ channel: "auction", price: fromMajor(900, "USD") }),
  ]), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
