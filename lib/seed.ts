import { query, queryOne, execute } from "./db.ts";
import { PROGRAM_SEEDS, MARKETS, type MarketCode } from "../core/markets.ts";
import { spanOf, type LadderRung } from "../core/condition.ts";
import { CHANNELS, type Channel } from "../core/channel.ts";

export const SEED_SOURCE = "worked example";

type DeviceSeed = { id: string; brand: string; model: string; storageGb: number; year: number; aliases?: string[]; usd: number };

const DEVICES: DeviceSeed[] = [
  { id: "apple-iphone-16-pro-max-512", brand: "Apple", model: "iPhone 16 Pro Max", storageGb: 512, year: 2024, aliases: ["A3296"], usd: 1180 },
  { id: "apple-iphone-16-pro-max-256", brand: "Apple", model: "iPhone 16 Pro Max", storageGb: 256, year: 2024, usd: 1050 },
  { id: "apple-iphone-16-pro-256",     brand: "Apple", model: "iPhone 16 Pro",     storageGb: 256, year: 2024, usd: 900 },
  { id: "apple-iphone-15-pro-max-512", brand: "Apple", model: "iPhone 15 Pro Max", storageGb: 512, year: 2023, aliases: ["A2849"], usd: 890 },
  { id: "apple-iphone-15-256",         brand: "Apple", model: "iPhone 15",         storageGb: 256, year: 2023, usd: 520 },
  { id: "apple-iphone-13-128gb",       brand: "Apple", model: "iPhone 13",         storageGb: 128, year: 2021, aliases: ["A2633"], usd: 400 },
  { id: "samsung-galaxy-s24-ultra-512", brand: "Samsung", model: "Galaxy S24 Ultra", storageGb: 512, year: 2024, aliases: ["SM-S928B"], usd: 760 },
  { id: "samsung-galaxy-s24-256",       brand: "Samsung", model: "Galaxy S24",       storageGb: 256, year: 2024, usd: 430 },
  { id: "google-pixel-9-pro-256",       brand: "Google", model: "Pixel 9 Pro",       storageGb: 256, year: 2024, usd: 560 },
];

function ladderFor(kind: string): LadderRung[] {
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
    if (existing.has(p.id)) {
      await execute(
        "UPDATE programs SET name=$1, market=$2, kind=$3, public_url=$4, cadence_hours=$5, note=$6 WHERE id=$7",
        [p.name, p.market, p.kind, p.publicUrl, p.cadenceHours, p.note || "", p.id]
      );
      updated++;
    } else {
      await execute(
        "INSERT INTO programs (id,name,market,kind,public_url,cadence_hours,cleared,authority,method,note) VALUES ($1,$2,$3,$4,$5,$6,0,'','',$7) ON CONFLICT (id) DO NOTHING",
        [p.id, p.name, p.market, p.kind, p.publicUrl, p.cadenceHours, p.note || ""]
      );
      await execute(
        "INSERT INTO ladders (program_id, rungs) VALUES ($1,$2) ON CONFLICT (program_id) DO NOTHING",
        [p.id, JSON.stringify(ladderFor(p.kind))]
      );
      added++;
    }
  }
  return { added, updated };
}

export async function syncDevices(): Promise<number> {
  let synced = 0;
  for (const d of DEVICES) {
    await execute(
      `INSERT INTO devices (id, brand, model, storage_gb, release_year, aliases)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [d.id, d.brand, d.model, d.storageGb, d.year, JSON.stringify(d.aliases || [])]
    );
    synced++;
  }
  return synced;
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
  } catch (err) {
    console.warn("[PriceIQ seed / syncPrograms warning]", err);
  }
  return counts();
}
