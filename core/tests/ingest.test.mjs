// Ingest is the gate. Everything downstream trusts that a stored price really
// is for the device and condition it claims, so these tests are about what the
// gate REFUSES — and about it never quietly picking a winner.

import assert from "node:assert/strict";
import { ingest, ingestHealth } from "../ingest.ts";
import { spanOf } from "../condition.ts";
import { toMajor } from "../money.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

const CAT = [
  { id: "apple-iphone-15-pro-max-256", brand: "Apple", model: "iPhone 15 Pro Max", storageGb: 256, releaseYear: 2023, aliases: [] },
  { id: "apple-iphone-15-pro-max-512", brand: "Apple", model: "iPhone 15 Pro Max", storageGb: 512, releaseYear: 2023, aliases: [] },
  { id: "apple-iphone-15-256", brand: "Apple", model: "iPhone 15", storageGb: 256, releaseYear: 2023, aliases: [] },
];
const LADDER = { programId: "apple-nz", rungs: [
  { label: "Excellent", span: spanOf("flawless", "good") },
  { label: "Damaged", span: spanOf("fair", "broken") },
]};
const CTX = {
  programId: "apple-nz", runId: "run-1", observedAt: "2026-08-20T00:00:00Z",
  catalogue: CAT, ladder: LADDER,
};
const row = (o) => ({
  deviceText: "Apple iPhone 15 Pro Max 512GB", conditionText: "Excellent",
  priceMajor: 890, currency: "NZD", sourceUrl: "https://example.test/p", ...o,
});

console.log("the happy path");
t("a clean row becomes one observation", () => {
  const r = ingest([row()], CTX);
  assert.equal(r.observations.length, 1);
  assert.equal(r.quarantined.length, 0);
  const o = r.observations[0];
  assert.equal(o.deviceId, "apple-iphone-15-pro-max-512");
  assert.equal(o.programId, "apple-nz");
  assert.equal(toMajor(o.price), 890);
  assert.equal(o.sourceUrl, "https://example.test/p");
});
t("a listed-but-unquoted device stores a NULL price, not zero", () => {
  const r = ingest([row({ priceMajor: null })], CTX);
  assert.equal(r.observations.length, 1);
  assert.equal(r.observations[0].price, null);
});

console.log("\nthe gate: nothing is ever approximated");
t("AN UNKNOWN DEVICE IS QUARANTINED, not attached to the nearest one", () => {
  const r = ingest([row({ deviceText: "Apple iPhone 42 Pro 256GB" })], CTX);
  assert.equal(r.observations.length, 0);
  assert.equal(r.quarantined[0].reason, "device_unresolved");
});
t("AN AMBIGUOUS DEVICE IS QUARANTINED WITH ITS SHORTLIST", () => {
  // No storage in the listing. "Probably the 256" is how a dataset rots.
  const r = ingest([row({ deviceText: "Apple iPhone 15 Pro Max" })], CTX);
  assert.equal(r.observations.length, 0);
  assert.equal(r.quarantined[0].reason, "device_ambiguous");
  assert.deepEqual(r.quarantined[0].candidateIds.sort(), [
    "apple-iphone-15-pro-max-256", "apple-iphone-15-pro-max-512",
  ]);
});
t("AN UNKNOWN CONDITION IS QUARANTINED, not defaulted to mid-ladder", () => {
  const r = ingest([row({ conditionText: "Pristine" })], CTX);
  assert.equal(r.observations.length, 0);
  assert.equal(r.quarantined[0].reason, "condition_unknown");
  assert.match(r.quarantined[0].why, /Pristine/);
});
t("a negative or non-numeric price is refused", () => {
  for (const bad of [-1, NaN, Infinity]) {
    const r = ingest([row({ priceMajor: bad })], CTX);
    assert.equal(r.observations.length, 0, String(bad));
    assert.equal(r.quarantined[0].reason, "price_invalid");
  }
});
t("a junk currency code is refused", () => {
  const r = ingest([row({ currency: "Dollars" })], CTX);
  assert.equal(r.quarantined[0].reason, "price_invalid");
});
t("every quarantined row keeps what is needed to fix it", () => {
  const r = ingest([row({ deviceText: "Nokia 3310" })], CTX);
  const q = r.quarantined[0];
  assert.equal(q.row.deviceText, "Nokia 3310");
  assert.equal(q.runId, "run-1");
  assert.equal(q.programId, "apple-nz");
  assert.ok(q.row.sourceUrl);
  assert.ok(q.why.length > 5);
});

console.log("\nbatches and health");
t("one bad row does not take down the batch", () => {
  const r = ingest([
    row(),
    row({ deviceText: "Nokia 3310" }),
    row({ deviceText: "Apple iPhone 15 256GB", priceMajor: 500 }),
    row({ conditionText: "Mint" }),
  ], CTX);
  assert.equal(r.observations.length, 2);
  assert.equal(r.quarantined.length, 2);
});
t("MATCH RATE IS THE NUMBER THAT CATCHES A SILENT CATALOGUE GAP", () => {
  // A scraper can return 200s and thousands of rows while a new model launch
  // goes unrecognised. This ratio is the only visible symptom.
  const r = ingest([row(), row(), row({ deviceText: "Nokia 3310" }), row({ deviceText: "Nokia 3310" })], CTX);
  const h = ingestHealth(r);
  assert.equal(h.total, 4);
  assert.equal(h.captured, 2);
  assert.equal(h.quarantined, 2);
  assert.equal(h.matchRate, 0.5);
  assert.equal(h.byReason.device_unresolved, 2);
});
t("an empty run reports a perfect rate rather than dividing by zero", () => {
  const h = ingestHealth(ingest([], CTX));
  assert.equal(h.total, 0);
  assert.equal(h.matchRate, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
