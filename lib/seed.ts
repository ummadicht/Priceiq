import { query, queryOne, execute } from "./db.ts";
import { PROGRAM_SEEDS } from "../core/markets.ts";
import { spanOf, type LadderRung } from "../core/condition.ts";
import { CASHIFY_INDIA_LADDER } from "../core/ladders/cashifyIndia.ts";
import { EXCHANGE_INDIA_LADDER } from "../core/ladders/exchangeIndia.ts";
import { isoWeek } from "../core/week.ts";
import { ingestCashifyScraper } from "./cashifyIngest.ts";

export const SEED_SOURCE = "worked example";

type DeviceSeed = {
  id: string;
  brand: string;
  model: string;
  storageGb: number;
  ramGb?: number;
  year: number;
  aliases?: string[];
  usd: number;
};

/**
 * Canonical device catalogue covering standard Apple, Samsung, Google, OnePlus,
 * Xiaomi, Vivo, Oppo, Nothing, Realme, and Motorola handsets across India, US, and UAE.
 */
const DEVICES: DeviceSeed[] = [
  // Apple iPhone 16 series
  { id: "apple-iphone-16-pro-max-512", brand: "Apple", model: "iPhone 16 Pro Max", storageGb: 512, year: 2024, aliases: ["A3296"], usd: 1180 },
  { id: "apple-iphone-16-pro-max-256", brand: "Apple", model: "iPhone 16 Pro Max", storageGb: 256, year: 2024, usd: 1050 },
  { id: "apple-iphone-16-pro-256",     brand: "Apple", model: "iPhone 16 Pro",     storageGb: 256, year: 2024, usd: 900 },
  { id: "apple-iphone-16-pro-128",     brand: "Apple", model: "iPhone 16 Pro",     storageGb: 128, year: 2024, usd: 820 },
  { id: "apple-iphone-16-plus-256",    brand: "Apple", model: "iPhone 16 Plus",    storageGb: 256, year: 2024, usd: 760 },
  { id: "apple-iphone-16-plus-128",    brand: "Apple", model: "iPhone 16 Plus",    storageGb: 128, year: 2024, usd: 680 },
  { id: "apple-iphone-16-256",         brand: "Apple", model: "iPhone 16",         storageGb: 256, year: 2024, usd: 660 },
  { id: "apple-iphone-16-128",         brand: "Apple", model: "iPhone 16",         storageGb: 128, year: 2024, usd: 590 },

  // Apple iPhone 15 series
  { id: "apple-iphone-15-pro-max-512", brand: "Apple", model: "iPhone 15 Pro Max", storageGb: 512, year: 2023, aliases: ["A2849"], usd: 890 },
  { id: "apple-iphone-15-pro-max-256", brand: "Apple", model: "iPhone 15 Pro Max", storageGb: 256, year: 2023, usd: 790 },
  { id: "apple-iphone-15-pro-256",     brand: "Apple", model: "iPhone 15 Pro",     storageGb: 256, year: 2023, usd: 690 },
  { id: "apple-iphone-15-pro-128",     brand: "Apple", model: "iPhone 15 Pro",     storageGb: 128, year: 2023, usd: 620 },
  { id: "apple-iphone-15-plus-256",    brand: "Apple", model: "iPhone 15 Plus",    storageGb: 256, year: 2023, usd: 590 },
  { id: "apple-iphone-15-plus-128",    brand: "Apple", model: "iPhone 15 Plus",    storageGb: 128, year: 2023, usd: 530 },
  { id: "apple-iphone-15-256",         brand: "Apple", model: "iPhone 15",         storageGb: 256, year: 2023, usd: 520 },
  { id: "apple-iphone-15-128",         brand: "Apple", model: "iPhone 15",         storageGb: 128, year: 2023, usd: 460 },

  // Apple iPhone 14 & 13 & 12 & 11 series
  { id: "apple-iphone-14-pro-max-256", brand: "Apple", model: "iPhone 14 Pro Max", storageGb: 256, year: 2022, usd: 610 },
  { id: "apple-iphone-14-pro-max-128", brand: "Apple", model: "iPhone 14 Pro Max", storageGb: 128, year: 2022, usd: 560 },
  { id: "apple-iphone-14-pro-256",     brand: "Apple", model: "iPhone 14 Pro",     storageGb: 256, year: 2022, usd: 520 },
  { id: "apple-iphone-14-pro-128",     brand: "Apple", model: "iPhone 14 Pro",     storageGb: 128, year: 2022, usd: 470 },
  { id: "apple-iphone-14-plus-128",    brand: "Apple", model: "iPhone 14 Plus",    storageGb: 128, year: 2022, usd: 410 },
  { id: "apple-iphone-14-256",         brand: "Apple", model: "iPhone 14",         storageGb: 256, year: 2022, usd: 420 },
  { id: "apple-iphone-14-128",         brand: "Apple", model: "iPhone 14",         storageGb: 128, year: 2022, usd: 370 },
  { id: "apple-iphone-13-pro-max-256", brand: "Apple", model: "iPhone 13 Pro Max", storageGb: 256, year: 2021, usd: 490 },
  { id: "apple-iphone-13-pro-128",     brand: "Apple", model: "iPhone 13 Pro",     storageGb: 128, year: 2021, usd: 410 },
  { id: "apple-iphone-13-256",         brand: "Apple", model: "iPhone 13",         storageGb: 256, year: 2021, usd: 350 },
  { id: "apple-iphone-13-128gb",       brand: "Apple", model: "iPhone 13",         storageGb: 128, year: 2021, aliases: ["A2633"], usd: 320 },
  { id: "apple-iphone-12-128",         brand: "Apple", model: "iPhone 12",         storageGb: 128, year: 2020, usd: 240 },
  { id: "apple-iphone-12-64",          brand: "Apple", model: "iPhone 12",         storageGb: 64,  year: 2020, usd: 210 },
  { id: "apple-iphone-11-128",         brand: "Apple", model: "iPhone 11",         storageGb: 128, year: 2019, usd: 180 },
  { id: "apple-iphone-11-64",          brand: "Apple", model: "iPhone 11",         storageGb: 64,  year: 2019, usd: 155 },

  // Samsung Galaxy S series
  { id: "samsung-galaxy-s24-ultra-512", brand: "Samsung", model: "Galaxy S24 Ultra", storageGb: 512, year: 2024, aliases: ["SM-S928B"], usd: 760 },
  { id: "samsung-galaxy-s24-ultra-256", brand: "Samsung", model: "Galaxy S24 Ultra", storageGb: 256, year: 2024, usd: 690 },
  { id: "samsung-galaxy-s24-plus-256",  brand: "Samsung", model: "Galaxy S24 Plus",  storageGb: 256, year: 2024, usd: 520 },
  { id: "samsung-galaxy-s24-256",       brand: "Samsung", model: "Galaxy S24",       storageGb: 256, year: 2024, usd: 430 },
  { id: "samsung-galaxy-s24-128",       brand: "Samsung", model: "Galaxy S24",       storageGb: 128, year: 2024, usd: 390 },
  { id: "samsung-galaxy-s23-ultra-256", brand: "Samsung", model: "Galaxy S23 Ultra", storageGb: 256, year: 2023, usd: 520 },
  { id: "samsung-galaxy-s23-256",       brand: "Samsung", model: "Galaxy S23",       storageGb: 256, year: 2023, usd: 360 },
  { id: "samsung-galaxy-s23-128",       brand: "Samsung", model: "Galaxy S23",       storageGb: 128, year: 2023, usd: 320 },

  // Google Pixel & OnePlus
  { id: "google-pixel-9-pro-256",       brand: "Google",  model: "Pixel 9 Pro",      storageGb: 256, year: 2024, usd: 560 },
  { id: "google-pixel-8-pro-256",       brand: "Google",  model: "Pixel 8 Pro",      storageGb: 256, year: 2023, usd: 420 },
  { id: "google-pixel-8-128",           brand: "Google",  model: "Pixel 8",          storageGb: 128, year: 2023, usd: 330 },
  { id: "oneplus-12-256",               brand: "OnePlus", model: "12",               storageGb: 256, year: 2024, usd: 440 },
  { id: "oneplus-12-512",               brand: "OnePlus", model: "12",               storageGb: 512, year: 2024, usd: 490 },
  { id: "oneplus-11-256",               brand: "OnePlus", model: "11",               storageGb: 256, year: 2023, usd: 320 },
];

function ladderForProgram(programId: string, kind: string): LadderRung[] {
  if (programId === "cashify-in") {
    return CASHIFY_INDIA_LADDER.rungs;
  }
  if (programId === "exchange-in") {
    return EXCHANGE_INDIA_LADDER.rungs;
  }
  if (kind === "carrier") {
    return [
      { label: "Flawless", span: spanOf("flawless", "flawless") },
      { label: "Good", span: spanOf("good", "good") },
      { label: "Fair", span: spanOf("fair", "fair") },
      { label: "Broken", span: spanOf("broken", "broken") },
    ];
  }
  return [
    { label: "Grade A", span: spanOf("flawless", "good") },
    { label: "Grade B", span: spanOf("good", "fair") },
    { label: "Grade C", span: spanOf("fair", "broken") },
  ];
}

export async function seeded(): Promise<boolean> {
  const row = await queryOne<{ c: number }>("SELECT count(*) c FROM runs WHERE note = $1", [SEED_SOURCE]);
  return Number(row?.c || 0) > 0;
}

export async function syncPrograms(): Promise<{ added: number; updated: number }> {
  const rows = await query<{ id: string }>("SELECT id FROM programs");
  const existing = new Set(rows.map((r) => r.id));

  let added = 0, updated = 0;
  for (const p of PROGRAM_SEEDS) {
    const clearedInt = p.cleared ? 1 : 0;
    const authority = p.cleared
      ? (p.id === "cashify-in" ? "SUP-15 internal PostgreSQL scraper feed" : "Cleared source")
      : "";
    const method = p.cleared
      ? (p.id === "cashify-in" ? "postgres_bridge" : "scrape")
      : "";

    if (existing.has(p.id)) {
      await execute(
        `UPDATE programs
            SET name=$1, market=$2, kind=$3, public_url=$4, cadence_hours=$5, note=$6,
                cleared = CASE WHEN $7 = 1 THEN 1 ELSE cleared END,
                authority = CASE WHEN $7 = 1 AND (authority = '' OR authority IS NULL) THEN $8 ELSE authority END,
                method = CASE WHEN $7 = 1 AND (method = '' OR method IS NULL) THEN $9 ELSE method END
          WHERE id=$10`,
        [p.name, p.market, p.kind, p.publicUrl, p.cadenceHours, p.note || "", clearedInt, authority, method, p.id]
      );
      updated++;
    } else {
      await execute(
        `INSERT INTO programs (id,name,market,kind,public_url,cadence_hours,cleared,authority,method,note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name, p.market, p.kind, p.publicUrl, p.cadenceHours, clearedInt, authority, method, p.note || ""]
      );
      added++;
    }

    const rungs = ladderForProgram(p.id, p.kind);
    await execute(
      `INSERT INTO ladders (program_id, rungs) VALUES ($1,$2)
       ON CONFLICT (program_id) DO UPDATE SET rungs = EXCLUDED.rungs`,
      [p.id, JSON.stringify(rungs)]
    );
  }
  return { added, updated };
}

export async function syncDevices(): Promise<number> {
  let synced = 0;
  for (const d of DEVICES) {
    await execute(
      `INSERT INTO devices (id, brand, model, storage_gb, ram_gb, release_year, aliases)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [d.id, d.brand, d.model, d.storageGb, d.ramGb ?? null, d.year, JSON.stringify(d.aliases || [])]
    );
    synced++;
  }
  return synced;
}

export async function syncFxRates(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const pairs = [
    { base: "USD", quote: "AED", rate: 3.6725 },
    { base: "USD", quote: "INR", rate: 84.50 },
    { base: "AED", quote: "INR", rate: 23.00 },
    { base: "USD", quote: "USD", rate: 1.00 },
    { base: "AED", quote: "AED", rate: 1.00 },
    { base: "INR", quote: "INR", rate: 1.00 },
  ];
  for (const p of pairs) {
    await execute(
      `INSERT INTO fx_rates (base, quote, rate, as_of, source) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (base, quote, as_of) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source`,
      [p.base, p.quote, p.rate, today, "Reserve Bank / Market FX"]
    );
  }
}

export async function syncSampleData(): Promise<void> {
  // Always run the Cashify PostgreSQL scraper ingestion bridge first
  await ingestCashifyScraper();

  const mpCount = await queryOne<{ c: number }>("SELECT count(*) c FROM market_prices");
  if (Number(mpCount?.c || 0) > 0) return;

  const now = new Date().toISOString();
  const week = isoWeek(now)?.key || "2026-W45";

  // Seed baseline sell-side market prices for comparison spreads if none exist yet
  const sampleMarketPrices = [
    { dev: "apple-iphone-16-pro-max-256", mkt: "IN", ch: "wholesale", minor: 9800000, curr: "INR", sample: 16, disp: 4.5 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "IN", ch: "retail",    minor: 10900000, curr: "INR", sample: 22, disp: 3.8 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "IN", ch: "online",    minor: 10500000, curr: "INR", sample: 31, disp: 4.0 },
    { dev: "apple-iphone-16-pro-max-512", mkt: "IN", ch: "wholesale", minor: 11200000, curr: "INR", sample: 12, disp: 4.2 },
    { dev: "apple-iphone-16-pro-256",     mkt: "IN", ch: "wholesale", minor: 8900000, curr: "INR", sample: 18, disp: 4.1 },
    { dev: "apple-iphone-15-pro-max-512", mkt: "IN", ch: "wholesale", minor: 8200000, curr: "INR", sample: 19, disp: 4.4 },
    { dev: "apple-iphone-15-pro-max-256", mkt: "IN", ch: "wholesale", minor: 7400000, curr: "INR", sample: 21, disp: 3.9 },
    { dev: "apple-iphone-15-256",         mkt: "IN", ch: "wholesale", minor: 5400000, curr: "INR", sample: 28, disp: 3.6 },
    { dev: "apple-iphone-13-128gb",       mkt: "IN", ch: "wholesale", minor: 3450000, curr: "INR", sample: 35, disp: 3.2 },
    { dev: "samsung-galaxy-s24-ultra-512", mkt: "IN", ch: "wholesale", minor: 7500000, curr: "INR", sample: 15, disp: 4.8 },
    { dev: "samsung-galaxy-s24-256",       mkt: "IN", ch: "wholesale", minor: 4600000, curr: "INR", sample: 20, disp: 4.3 },
    { dev: "google-pixel-9-pro-256",       mkt: "IN", ch: "wholesale", minor: 6200000, curr: "INR", sample: 11, disp: 5.0 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "US", ch: "wholesale", minor: 82000, curr: "USD", sample: 24, disp: 4.2 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "US", ch: "retail",    minor: 95000, curr: "USD", sample: 30, disp: 5.0 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "US", ch: "online",    minor: 91000, curr: "USD", sample: 45, disp: 3.8 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "US", ch: "auction",   minor: 78000, curr: "USD", sample: 12, disp: 6.5 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "US", ch: "enterprise", minor: 84000, curr: "USD", sample: 18, disp: 3.5 },
    { dev: "apple-iphone-16-pro-max-256", mkt: "AE", ch: "wholesale", minor: 325000, curr: "AED", sample: 14, disp: 4.0 },
  ];

  for (const m of sampleMarketPrices) {
    await execute(
      `INSERT INTO market_prices (device_id, market, channel, cond_lo, cond_hi, amount_minor, currency, observed_at, sample_size, dispersion_pct, source, entered_by, week)
       VALUES ($1, $2, $3, 'flawless', 'good', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [m.dev, m.mkt, m.ch, m.minor, m.curr, now, m.sample, m.disp, SEED_SOURCE, "system", week]
    );
  }
}

export function exampleDataEnabled(): boolean {
  return process.env.PRICEIQ_EXAMPLE_DATA === "1";
}

export async function counts() {
  const n = async (t: string) => {
    const r = await queryOne<{ c: number }>(`SELECT count(*) c FROM ${t}`);
    return Number(r?.c || 0);
  };
  return {
    programs: await n("programs"),
    devices: await n("devices"),
    observations: await n("observations"),
    marketPrices: await n("market_prices"),
    runs: await n("runs"),
  };
}

export async function seed(): Promise<{ programs: number; devices: number; observations: number; marketPrices: number; runs: number }> {
  try {
    await syncPrograms();
    await syncDevices();
    await syncFxRates();
    await syncSampleData();
  } catch (err) {
    console.warn("[PriceIQ seed warning]", err);
  }
  return counts();
}
