// Condition mapping is what makes a cross-program price table honest. These
// tests target the ways it would quietly mislead: inventing precision a program
// never offered, and ranking two prices that describe different conditions.

import assert from "node:assert/strict";
import {
  spanOf, spanWidth, describeSpan, mapCondition, comparability,
  comparabilityNote, validateLadder, CANONICAL_ORDER,
} from "../condition.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

// A five-rung carrier ladder: one rung per canonical condition.
const CARRIER = { programId: "carrier", rungs: [
  { label: "Flawless", span: spanOf("flawless") },
  { label: "Excellent", span: spanOf("good") },
  { label: "Good", span: spanOf("fair") },
  { label: "Fair", span: spanOf("poor") },
  { label: "Broken", span: spanOf("broken") },
]};

// A two-rung manufacturer ladder. It cannot express five-rung precision.
const OEM = { programId: "oem", rungs: [
  { label: "Good condition", span: spanOf("flawless", "good") },
  { label: "Damaged", span: spanOf("fair", "broken") },
]};

console.log("spans");
t("a span never inverts, however it is written", () => {
  assert.deepEqual(spanOf("broken", "flawless"), { lo: "flawless", hi: "broken" });
  assert.equal(spanWidth(spanOf("flawless", "broken")), CANONICAL_ORDER.length);
  assert.equal(spanWidth(spanOf("good")), 1);
});
t("a span describes itself for a human", () => {
  assert.equal(describeSpan(spanOf("good")), "Good");
  assert.equal(describeSpan(spanOf("flawless", "good")), "Flawless–Good");
});

console.log("\nmapping a program's own words");
t("labels match regardless of case, spacing or punctuation", () => {
  for (const s of ["Good condition", "good condition", "GOOD  CONDITION", "good-condition"]) {
    assert.deepEqual(mapCondition(OEM, s), spanOf("flawless", "good"), s);
  }
});
t("A TRAILING MODIFIER SURVIVES; AN INTERNAL HYPHEN DOES NOT", () => {
  // "B-" is a different rung from "B". "good-condition" is the same label as
  // "good condition". Position is what tells them apart.
  const l = { programId: "x", rungs: [
    { label: "B",  span: spanOf("flawless", "good") },
    { label: "B-", span: spanOf("good") },
    { label: "Good condition", span: spanOf("fair", "broken") },
  ]};
  assert.deepEqual(mapCondition(l, "B-"), spanOf("good"));
  assert.deepEqual(mapCondition(l, "b -"), spanOf("good"));
  assert.deepEqual(mapCondition(l, "B"), spanOf("flawless", "good"));
  assert.deepEqual(mapCondition(l, "good-condition"), spanOf("fair", "broken"));
  assert.deepEqual(mapCondition(l, "GOOD CONDITION"), spanOf("fair", "broken"));
});

t("AN UNKNOWN GRADE MAPS TO NOTHING — never to a default", () => {
  // Defaulting an unrecognised grade would attach a fabricated condition to a
  // real price, which is worse than having no price at all.
  assert.equal(mapCondition(CARRIER, "Pristine"), null);
  assert.equal(mapCondition(CARRIER, ""), null);
});

console.log("\ncomparability — the honest bit");
t("identical spans are exact", () => {
  assert.equal(comparability(spanOf("good"), spanOf("good")), "exact");
});
t("A COARSE LADDER IS ONLY EVER APPROXIMATE against a fine one", () => {
  // The OEM's "Good condition" covers flawless AND good. It is not the same
  // claim as the carrier's "Excellent", and must never be shown as if it were.
  const oem = mapCondition(OEM, "Good condition");
  const carrier = mapCondition(CARRIER, "Excellent");
  assert.equal(comparability(oem, carrier), "approximate");
  assert.notEqual(comparability(oem, carrier), "exact");
});
t("NON-OVERLAPPING GRADES ARE INCOMPARABLE, not merely different", () => {
  const flawless = mapCondition(CARRIER, "Flawless");
  const damaged = mapCondition(OEM, "Damaged");
  assert.equal(comparability(flawless, damaged), "incomparable");
});
t("comparability is symmetric", () => {
  const a = spanOf("flawless", "good"), b = spanOf("good");
  assert.equal(comparability(a, b), comparability(b, a));
});
t("touching at a single rung still counts as overlap", () => {
  assert.equal(comparability(spanOf("flawless", "good"), spanOf("good", "broken")), "approximate");
});
t("every verdict comes with a sentence a user can read", () => {
  const a = mapCondition(OEM, "Good condition"), b = mapCondition(CARRIER, "Excellent");
  assert.match(comparabilityNote(a, b), /coarser/i);
  assert.match(comparabilityNote(spanOf("flawless"), spanOf("broken")), /do not overlap/i);
  assert.match(comparabilityNote(spanOf("good"), spanOf("good")), /Both quoted/i);
});

console.log("\nladder definitions catch their own bugs");
t("a complete ladder validates", () => {
  assert.equal(validateLadder(CARRIER).ok, true);
  assert.equal(validateLadder(OEM).ok, true);
});
t("PLUS AND MINUS ARE PART OF THE GRADE, not punctuation", () => {
  // "B-" collapsing onto "B" meant every B- price was filed a grade too high.
  const seven = { programId: "x", rungs: [
    { label: "A",  span: spanOf("flawless") },
    { label: "B",  span: spanOf("flawless", "good") },
    { label: "B-", span: spanOf("good") },
    { label: "C",  span: spanOf("good", "fair") },
    { label: "C-", span: spanOf("fair", "poor") },
    { label: "D",  span: spanOf("poor") },
    { label: "E",  span: spanOf("broken") },
  ]};
  assert.deepEqual(validateLadder(seven).duplicates, []);
  assert.deepEqual(mapCondition(seven, "B-"), spanOf("good"));
  assert.deepEqual(mapCondition(seven, "B"), spanOf("flawless", "good"));
  assert.notDeepEqual(mapCondition(seven, "B-"), mapCondition(seven, "B"));
  assert.notDeepEqual(mapCondition(seven, "C-"), mapCondition(seven, "C"));
});
t("A FINER LADDER OVERLAPS AND IS STILL VALID", () => {
  // Seven rungs cannot map onto five canonical without straddling boundaries.
  // Rejecting that would mean rejecting the most detailed sources.
  const seven = { programId: "x", rungs: [
    { label: "A",  span: spanOf("flawless") },
    { label: "B",  span: spanOf("flawless", "good") },
    { label: "B-", span: spanOf("good") },
    { label: "C",  span: spanOf("good", "fair") },
    { label: "C-", span: spanOf("fair", "poor") },
    { label: "D",  span: spanOf("poor") },
    { label: "E",  span: spanOf("broken") },
  ]};
  const v = validateLadder(seven);
  assert.equal(v.ok, true, "a finer ladder must not be rejected");
  assert.deepEqual(v.gaps, []);
  assert.ok(v.overlaps.length > 0, "overlaps must still be reported");
});
t("A GAP IS REPORTED — some real condition would have no price", () => {
  const gappy = { programId: "x", rungs: [
    { label: "Top", span: spanOf("flawless") },
    { label: "Bottom", span: spanOf("poor", "broken") },
  ]};
  const v = validateLadder(gappy);
  assert.equal(v.ok, false);
  assert.ok(v.gaps.some((p) => /Good/.test(p)));
  assert.ok(v.gaps.some((p) => /Fair/.test(p)));
});
t("AN OVERLAP IS REPORTED — one condition would have two prices", () => {
  const overlapping = { programId: "x", rungs: [
    { label: "A", span: spanOf("flawless", "fair") },
    { label: "B", span: spanOf("good", "broken") },
  ]};
  // An overlap alone no longer fails a ladder — it is how a finer scale maps
  // onto a coarser canonical one — but it is always reported.
  const v = validateLadder(overlapping);
  assert.ok(v.overlaps.some((p) => /priced by 2 rungs/.test(p)));
  assert.deepEqual(v.gaps, []);
});
t("duplicate labels are caught", () => {
  const dup = { programId: "x", rungs: [
    { label: "Good", span: spanOf("flawless", "good") },
    { label: "good", span: spanOf("fair", "broken") },
  ]};
  assert.ok(validateLadder(dup).duplicates.length > 0);
  assert.equal(validateLadder(dup).ok, false);
});
t("an empty ladder is invalid, not vacuously fine", () => {
  assert.equal(validateLadder({ programId: "x", rungs: [] }).ok, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
