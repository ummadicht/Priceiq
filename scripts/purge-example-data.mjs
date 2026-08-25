/**
 * Remove every worked-example price.
 *
 *   node --experimental-strip-types scripts/purge-example-data.mjs [--commit]
 *
 * The example dataset existed so empty screens could demonstrate the pipeline.
 * Once real prices arrived it became a liability: a comparison mixing a
 * measured price with a generated one is worse than one with a visible gap.
 *
 * Deletes only rows stamped as examples. Real observations, the programme
 * registry, the device catalogue and any attributed FX rate are untouched —
 * and the counts are printed before and after so that is checkable rather than
 * a promise.
 */
import { db } from "../lib/db.ts";
import { SEED_SOURCE } from "../lib/seed.ts";

const commit = process.argv.includes("--commit");
const d = db();
const n = (q, ...p) => d.prepare(q).get(...p).c;

const before = {
  observations: n("SELECT count(*) c FROM observations"),
  exampleObs: n("SELECT count(*) c FROM observations WHERE run_id IN (SELECT id FROM runs WHERE note = ?)", SEED_SOURCE),
  runs: n("SELECT count(*) c FROM runs"),
  exampleRuns: n("SELECT count(*) c FROM runs WHERE note = ?", SEED_SOURCE),
  marketPrices: n("SELECT count(*) c FROM market_prices"),
  exampleMp: n("SELECT count(*) c FROM market_prices WHERE source = ?", SEED_SOURCE),
  fx: n("SELECT count(*) c FROM fx_rates"),
  exampleFx: n("SELECT count(*) c FROM fx_rates WHERE source = ? OR source = ''", SEED_SOURCE),
  devices: n("SELECT count(*) c FROM devices"),
};

console.log("  before:");
console.log(`    observations  ${before.observations}  (${before.exampleObs} example)`);
console.log(`    runs          ${before.runs}  (${before.exampleRuns} example)`);
console.log(`    market prices ${before.marketPrices}  (${before.exampleMp} example)`);
console.log(`    fx rates      ${before.fx}  (${before.exampleFx} unattributed or example)`);
console.log(`    devices       ${before.devices}`);

if (!commit) {
  console.log("\n  DRY RUN — nothing deleted. Re-run with --commit.");
  process.exit(0);
}

d.transaction(() => {
  d.prepare("DELETE FROM observations WHERE run_id IN (SELECT id FROM runs WHERE note = ?)").run(SEED_SOURCE);
  d.prepare("DELETE FROM runs WHERE note = ?").run(SEED_SOURCE);
  d.prepare("DELETE FROM market_prices WHERE source = ?").run(SEED_SOURCE);
  // Unattributed rates go too. A rate with no stated origin is exactly how a
  // 13% error hid here once already.
  d.prepare("DELETE FROM fx_rates WHERE source = ? OR source = ''").run(SEED_SOURCE);
  // Devices left with no price at all were catalogue entries the example data
  // invented a need for. Anything a real source named is kept by definition.
  d.prepare(`DELETE FROM devices WHERE NOT EXISTS (SELECT 1 FROM observations o WHERE o.device_id = devices.id)
                                AND NOT EXISTS (SELECT 1 FROM market_prices m WHERE m.device_id = devices.id)`).run();
})();

console.log("\n  after:");
console.log(`    observations  ${n("SELECT count(*) c FROM observations")}`);
console.log(`    runs          ${n("SELECT count(*) c FROM runs")}`);
console.log(`    market prices ${n("SELECT count(*) c FROM market_prices")}`);
console.log(`    fx rates      ${n("SELECT count(*) c FROM fx_rates")}`);
console.log(`    devices       ${n("SELECT count(*) c FROM devices")}`);
console.log(`    programmes    ${n("SELECT count(*) c FROM programs")}  (registry kept)`);
