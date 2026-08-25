// The clearance gate is a compliance decision expressed as code. These tests
// keep it from decaying into a comment nobody reads.

import assert from "node:assert/strict";
import { MARKETS, PROGRAM_SEEDS, programsIn, REQUIRED_PAIRS } from "../markets.ts";
import { checkClearance, manualCollector } from "../collection.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

console.log("scope");
t("exactly three markets, each with a real currency and zone", () => {
  assert.deepEqual(Object.keys(MARKETS).sort(), ["AE", "IN", "US"]);
  for (const m of Object.values(MARKETS)) {
    assert.match(m.currency, /^[A-Z]{3}$/);
    assert.ok(m.timezone.includes("/"));
  }
});
t("every programme belongs to one of those three markets", () => {
  for (const p of PROGRAM_SEEDS) assert.ok(MARKETS[p.market], `${p.id} has market ${p.market}`);
  assert.ok(programsIn("US").length >= 5);
  assert.ok(programsIn("AE").length >= 5);
  assert.ok(programsIn("IN").length >= 5);
});
t("programme ids are unique", () => {
  const ids = PROGRAM_SEEDS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
t("every programme has a cadence and a public URL", () => {
  for (const p of PROGRAM_SEEDS) {
    assert.ok(p.cadenceHours > 0, p.id);
    assert.match(p.publicUrl, /^https:\/\//, p.id);
  }
});
t("the currency pairs needed to compare these markets are declared", () => {
  const need = new Set(Object.values(MARKETS).map((m) => m.currency));
  const covered = new Set(REQUIRED_PAIRS.flat());
  for (const c of need) assert.ok(covered.has(c), `${c} has no declared pair`);
});

console.log("\nthe clearance gate");
t("EVERY PROGRAMME SHIPS UNCLEARED", () => {
  // If this ever fails, someone has enabled collection without recording how
  // it is permitted. That is the failure this test exists to catch.
  for (const p of PROGRAM_SEEDS) assert.equal(p.cleared, false, `${p.id} ships cleared`);
});
t("an uncleared programme is refused, with an actionable reason", () => {
  const p = PROGRAM_SEEDS[0];
  const r = checkClearance(p, new Map());
  assert.equal(r.allowed, false);
  assert.match(r.why, /not cleared/i);
  assert.match(r.why, /record the authority/i);
});
t("cleared but unimplemented is still refused", () => {
  const p = { ...PROGRAM_SEEDS[0], cleared: true };
  const r = checkClearance(p, new Map());
  assert.equal(r.allowed, false);
  assert.match(r.why, /no collector/i);
});
t("CLEARED WITH NO STATED AUTHORITY IS REFUSED", () => {
  // A cleared flag with no reason attached is how a compliance decision gets
  // lost the moment the person who made it leaves.
  const p = { ...PROGRAM_SEEDS[0], cleared: true };
  const naked = { programId: p.id, method: "permitted_crawl", authority: "", collect: async () => [] };
  assert.equal(checkClearance(p, new Map([[p.id, naked]])).allowed, false);
});
t("a cleared programme with a documented collector is allowed", () => {
  const p = { ...PROGRAM_SEEDS[0], cleared: true };
  const c = manualCollector(p.id, "an analyst");
  const r = checkClearance(p, new Map([[p.id, c]]));
  assert.equal(r.allowed, true);
  assert.match(r.why, /manual_entry/);
});
t("manual entry is a real collector, not a stub that pretends", () => {
  const c = manualCollector("apple-us", "an analyst");
  assert.equal(c.method, "manual_entry");
  assert.ok(c.authority.length > 8);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
