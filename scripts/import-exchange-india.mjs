/**
 * Import the Indian exchange price list.
 *
 * These are TRADE-IN prices — what the programme pays — so they land in
 * `observations`, not `market_prices`. Confusing the two would put a buyback
 * offer on the wrong side of every spread and turn a 40% margin into a 140% one.
 *
 *   node --experimental-strip-types scripts/import-exchange-india.mjs <file.tsv> [--commit]
 *
 * Reads the flattened "device / grade / price" TSV produced from the workbook.
 * Previews unless --commit is given.
 */
import fs from "node:fs";
import { db } from "../lib/db.ts";
import { seed } from "../lib/seed.ts";
import { enrolDevices } from "../lib/enrol.ts";
import { listDevices } from "../lib/repo.ts";
import { resolveDevice } from "../core/device.ts";
import { EXCHANGE_INDIA_LADDER } from "../core/ladders/exchangeIndia.ts";
import { mapCondition } from "../core/condition.ts";
import { fromMajor } from "../core/money.ts";
import { isoWeek } from "../core/week.ts";

const PROGRAM_ID = "exchange-in";
const file = process.argv[2];
const commit = process.argv.includes("--commit");
if (!file) { console.error("usage: import-exchange-india.mjs <file.tsv> [--commit]"); process.exit(1); }

seed();
const d = db();

const rows = fs.readFileSync(file, "utf8").trim().split("\n").slice(1)
  .map((l) => l.split("\t"))
  .filter((c) => c.length >= 3);

const models = [...new Set(rows.map((c) => c[0]))];
const enrol = enrolDevices(models, { commit });
console.log(`  devices: ${enrol.derived} derived, ${enrol.added} ${commit ? "added" : "would add"}, ${enrol.skipped.length} skipped`);

const cat = listDevices().map((x) => ({
  id: x.id, brand: x.brand, model: x.model, storageGb: x.storageGb,
  ramGb: x.ramGb, releaseYear: x.releaseYear, aliases: x.aliases,
}));

const observedAt = new Date().toISOString();
const week = isoWeek(observedAt).key;
const runId = `${PROGRAM_ID}-import-${week}`;

let ok = 0, quarantined = 0, badGrade = 0, badPrice = 0;
const staged = [];

for (const [deviceText, grade, priceRaw] of rows) {
  const res = resolveDevice(deviceText, cat);
  if (res.status !== "matched") { quarantined++; continue; }
  if (!mapCondition(EXCHANGE_INDIA_LADDER, grade)) { badGrade++; continue; }
  const major = Number(priceRaw);
  if (!Number.isFinite(major) || major <= 0) { badPrice++; continue; }
  staged.push([res.device.id, grade, fromMajor(major, "INR").amountMinor]);
  ok++;
}

console.log(`  prices : ${ok} importable, ${quarantined} unresolved device, ${badGrade} unknown grade, ${badPrice} bad price`);

if (!commit) {
  console.log("\n  DRY RUN — nothing written. Re-run with --commit.");
  process.exit(0);
}

d.transaction(() => {
  d.prepare(
    `INSERT INTO programs (id,name,market,kind,public_url,cadence_hours,cleared,authority,method,note)
     VALUES (?,?,?,?,?,?,0,'','',?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, note=excluded.note`
  ).run(PROGRAM_ID, "Exchange (India)", "IN", "retailer", "", 168,
        "Supplied as a monthly workbook. Manual import — no automated collection.");
  d.prepare("INSERT OR REPLACE INTO ladders (program_id, rungs) VALUES (?,?)")
   .run(PROGRAM_ID, JSON.stringify(EXCHANGE_INDIA_LADDER.rungs));

  const ins = d.prepare(
    `INSERT INTO observations (program_id, device_id, condition_label, amount_minor, currency, observed_at, run_id, source_url)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const [deviceId, grade, minor] of staged) {
    ins.run(PROGRAM_ID, deviceId, grade, minor, "INR", observedAt, runId, "");
  }
  d.prepare(
    `INSERT OR REPLACE INTO runs (id, program_id, started_at, finished_at, status, captured, errors, quarantined, note)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(runId, PROGRAM_ID, observedAt, new Date().toISOString(), "succeeded",
        ok, badPrice + badGrade, quarantined, `manual import · ${file.split("/").pop()}`);
})();

console.log(`\n  WROTE ${ok} observations for ${PROGRAM_ID}, week ${week}`);
