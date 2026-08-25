import { db } from "./db.ts";
import { PROGRAM_SEEDS, MARKETS, type MarketCode } from "../core/markets.ts";
import { spanOf, type LadderRung } from "../core/condition.ts";
import { CHANNELS, type Channel } from "../core/channel.ts";

/**
 * A WORKED EXAMPLE DATASET — explicitly not observed prices.
 *
 * Nothing in core/markets.ts is cleared for collection, so the application has
 * no real data by design. Rather than show empty screens, this seeds a
 * consistent illustrative dataset so the whole pipeline can be exercised and
 * demonstrated end to end.
 *
 * Every seeded figure is stamped `source: "worked example"` and the UI says so
 * on every screen that shows a number. That labelling is not decoration: a
 * price-intelligence product whose demo data is indistinguishable from its real
 * data is one screenshot away from someone trading on a figure nobody observed.
 *
 * The numbers are deterministic — same seed, same dataset — so screenshots and
 * tests stay stable.
 */

export const SEED_SOURCE = "worked example";

/** Deterministic PRNG. Never Math.random(): a demo that shifts is not a demo. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type DeviceSeed = { id: string; brand: string; model: string; storageGb: number; year: number; aliases?: string[]; usd: number };

/**
 * A deliberately small catalogue. Breadth is the easy axis; these eight cover
 * three brands, two generations and the storage-variant trap that device
 * resolution exists to handle.
 */
const DEVICES: DeviceSeed[] = [
  { id: "apple-iphone-16-pro-max-512", brand: "Apple", model: "iPhone 16 Pro Max", storageGb: 512, year: 2024, aliases: ["A3296"], usd: 1180 },
  { id: "apple-iphone-16-pro-max-256", brand: "Apple", model: "iPhone 16 Pro Max", storageGb: 256, year: 2024, usd: 1050 },
  { id: "apple-iphone-16-pro-256",     brand: "Apple", model: "iPhone 16 Pro",     storageGb: 256, year: 2024, usd: 900 },
  { id: "apple-iphone-15-pro-max-512", brand: "Apple", model: "iPhone 15 Pro Max", storageGb: 512, year: 2023, aliases: ["A2849"], usd: 890 },
  { id: "apple-iphone-15-256",         brand: "Apple", model: "iPhone 15",         storageGb: 256, year: 2023, usd: 520 },
  { id: "samsung-galaxy-s24-ultra-512", brand: "Samsung", model: "Galaxy S24 Ultra", storageGb: 512, year: 2024, aliases: ["SM-S928B"], usd: 760 },
  { id: "samsung-galaxy-s24-256",       brand: "Samsung", model: "Galaxy S24",       storageGb: 256, year: 2024, usd: 430 },
  { id: "google-pixel-9-pro-256",       brand: "Google", model: "Pixel 9 Pro",       storageGb: 256, year: 2024, usd: 560 },
];

/**
 * Ladders by programme kind — the reason condition spans exist.
 *
 * An OEM programme really does collapse the whole scale into two rungs, and a
 * recycler really does slice it five ways. Comparing them is therefore
 * approximate, and the seed makes that visible rather than tidying it away.
 */
function ladderFor(kind: string): LadderRung[] {
  if (kind === "oem") {
    return [
      { label: "Good", span: spanOf("flawless", "good") },
      { label: "Damaged", span: spanOf("fair", "broken") },
    ];
  }
  if (kind === "carrier") {
    return [
      { label: "Excellent", span: spanOf("flawless", "good") },
      { label: "Good", span: spanOf("fair") },
      { label: "Damaged", span: spanOf("poor", "broken") },
    ];
  }
  return [
    { label: "Flawless", span: spanOf("flawless") },
    { label: "Excellent", span: spanOf("good") },
    { label: "Good", span: spanOf("fair") },
    { label: "Fair", span: spanOf("poor") },
    { label: "Broken", span: spanOf("broken") },
  ];
}

/** What each kind typically pays, as a fraction of the device's USD reference. */
const KIND_FACTOR: Record<string, number> = {
  oem: 0.52, carrier: 0.62, retailer: 0.5, recycler: 0.46, marketplace: 0.58,
};
/** Market realisation by channel, as a fraction of the USD reference. */
const CHANNEL_FACTOR: Record<Channel, number> = {
  retail: 1.0, online: 0.88, wholesale: 0.74, enterprise: 0.79, auction: 0.62,
};
/** Local price levels relative to the USD reference. */
const MARKET_FACTOR: Record<MarketCode, number> = { US: 1.0, AE: 0.96, IN: 0.82 };

const FX = [
  { base: "USD", quote: "AED", rate: 3.6725 },
  { base: "USD", quote: "INR", rate: 84.2 },
  { base: "AED", quote: "INR", rate: 22.93 },
];

const iso = (d: Date) => d.toISOString();
const day = (back: number) => new Date(Date.UTC(2026, 7, 25) - back * 86400000);

export function seeded(): boolean {
  return (db().prepare("SELECT count(*) c FROM programs").get() as { c: number }).c > 0;
}

/**
 * Keep the programme registry in step with core/markets.ts.
 *
 * The registry is REFERENCE DATA owned by the code, not user data owned by the
 * database — but `seed()` only ran against an empty table, so programmes added
 * later never appeared. Twenty-four India programmes were written and nine were
 * live, with nothing to indicate the gap.
 *
 * So descriptive fields are synced on every start: name, URL, cadence, note.
 * Operational state is NOT — `cleared`, `authority`, `method` and `enabled`
 * are decisions somebody made about a programme, and a deploy must never quietly
 * re-clear something that was deliberately switched off, or un-clear one that
 * was signed off.
 */
export function syncPrograms(): { added: number; updated: number } {
  const d = db();
  const existing = new Set(
    (d.prepare("SELECT id FROM programs").all() as Array<{ id: string }>).map((r) => r.id)
  );
  const ins = d.prepare(
    "INSERT INTO programs (id,name,market,kind,public_url,cadence_hours,cleared,authority,method,note) VALUES (?,?,?,?,?,?,0,'','',?)"
  );
  const upd = d.prepare(
    "UPDATE programs SET name=?, market=?, kind=?, public_url=?, cadence_hours=?, note=? WHERE id=?"
  );
  const insLadder = d.prepare("INSERT OR IGNORE INTO ladders (program_id, rungs) VALUES (?,?)");

  let added = 0, updated = 0;
  d.transaction(() => {
    for (const p of PROGRAM_SEEDS) {
      if (existing.has(p.id)) {
        upd.run(p.name, p.market, p.kind, p.publicUrl, p.cadenceHours, p.note || "", p.id);
        updated++;
      } else {
        ins.run(p.id, p.name, p.market, p.kind, p.publicUrl, p.cadenceHours, p.note || "");
        insLadder.run(p.id, JSON.stringify(ladderFor(p.kind)));
        added++;
      }
    }
  })();
  return { added, updated };
}

export function seed(): { programs: number; devices: number; observations: number; marketPrices: number; runs: number } {
  const d = db();
  if (seeded()) {
    // Already seeded — but the registry may have grown since.
    syncPrograms();
    return counts();
  }
  const r = rng(20260825);

  const insProgram = d.prepare(
    "INSERT INTO programs (id,name,market,kind,public_url,cadence_hours,cleared,authority,method,note) VALUES (?,?,?,?,?,?,0,'','',?)"
  );
  const insLadder = d.prepare("INSERT INTO ladders (program_id, rungs) VALUES (?,?)");
  const insDevice = d.prepare("INSERT INTO devices (id,brand,model,storage_gb,release_year,aliases) VALUES (?,?,?,?,?,?)");
  const insObs = d.prepare(
    "INSERT INTO observations (program_id,device_id,condition_label,amount_minor,currency,observed_at,run_id,source_url) VALUES (?,?,?,?,?,?,?,?)"
  );
  const insMp = d.prepare(
    "INSERT INTO market_prices (device_id,market,channel,cond_lo,cond_hi,amount_minor,currency,observed_at,sample_size,dispersion_pct,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  const insFx = d.prepare("INSERT OR REPLACE INTO fx_rates (base,quote,rate,as_of) VALUES (?,?,?,?)");
  const insRun = d.prepare(
    "INSERT INTO runs (id,program_id,started_at,finished_at,status,captured,errors,quarantined,note) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  const insQuar = d.prepare(
    "INSERT INTO quarantine (program_id,run_id,reason,why,device_text,condition_text,price_major,currency,source_url,candidate_ids,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );

  d.transaction(() => {
    for (const dev of DEVICES) {
      insDevice.run(dev.id, dev.brand, dev.model, dev.storageGb, dev.year, JSON.stringify(dev.aliases || []));
    }

    // FX for every day in the window, drifting slightly so a historical
    // conversion genuinely differs from today's.
    for (let back = 0; back <= 120; back++) {
      const asOf = day(back).toISOString().slice(0, 10);
      for (const f of FX) {
        const drift = 1 + (r() - 0.5) * 0.012;
        insFx.run(f.base, f.quote, Math.round(f.rate * drift * 10000) / 10000, asOf);
      }
    }

    for (const p of PROGRAM_SEEDS) {
      insProgram.run(p.id, p.name, p.market, p.kind, p.publicUrl, p.cadenceHours, p.note || "");
      const rungs = ladderFor(p.kind);
      insLadder.run(p.id, JSON.stringify(rungs));

      const cur = MARKETS[p.market].currency;
      const kindFactor = KIND_FACTOR[p.kind] ?? 0.5;
      // A per-programme bias so programmes are genuinely more and less generous.
      const bias = 0.88 + r() * 0.26;

      // Each programme quotes a subset of the catalogue.
      const covered = DEVICES.filter(() => r() > 0.22);
      const topRung = rungs[0].label;

      let captured = 0;
      // Six polls at the programme's cadence. Most are confirmations; a couple
      // are real moves. That mix is the point of the change-detection module.
      const polls = 6;
      for (const dev of covered) {
        const localRef = dev.usd * MARKET_FACTOR[p.market] * (p.market === "US" ? 1 : p.market === "AE" ? 3.6725 : 84.2);
        let level = localRef * kindFactor * bias;
        const moveAt = 1 + Math.floor(r() * (polls - 2));
        for (let i = polls - 1; i >= 0; i--) {
          const back = i * (p.cadenceHours / 24);
          if (i === moveAt) level *= 0.92 + r() * 0.05;   // a genuine reprice
          const minor = Math.round(level * 100);
          insObs.run(p.id, dev.id, topRung, minor, cur, iso(day(back)), `${p.id}-r${i}`, p.publicUrl);
          captured++;
        }
      }

      // Runs, newest last, with an honest headline.
      for (let i = polls - 1; i >= 0; i--) {
        const started = day(i * (p.cadenceHours / 24));
        const quar = i === 0 && r() > 0.6 ? 1 + Math.floor(r() * 3) : 0;
        insRun.run(
          `${p.id}-r${i}`, p.id, iso(started),
          iso(new Date(started.getTime() + 42000)),
          "succeeded", covered.length, 0, quar,
          SEED_SOURCE
        );
        if (quar) {
          // A realistic quarantine: a model the catalogue has not learned yet.
          insQuar.run(
            p.id, `${p.id}-r${i}`, "device_unresolved",
            'no Apple model matches "Apple iPhone 17 Pro Max 1TB"',
            "Apple iPhone 17 Pro Max 1TB", rungs[0].label, 999, cur, p.publicUrl, "[]",
            iso(started)
          );
        }
      }
      void captured;
    }

    // Market prices: every device, every market, every channel.
    for (const dev of DEVICES) {
      for (const code of Object.keys(MARKETS) as MarketCode[]) {
        const cur = MARKETS[code].currency;
        const fxToLocal = code === "US" ? 1 : code === "AE" ? 3.6725 : 84.2;
        for (const ch of CHANNELS) {
          const level = dev.usd * MARKET_FACTOR[code] * CHANNEL_FACTOR[ch.id] * fxToLocal * (0.97 + r() * 0.06);
          const sample = ch.id === "auction" ? 2 + Math.floor(r() * 4) : 6 + Math.floor(r() * 30);
          const dispersion = Math.round((4 + r() * (ch.id === "auction" ? 30 : 12)) * 10) / 10;
          insMp.run(
            dev.id, code, ch.id, "flawless", "good",
            Math.round(level * 100), cur, iso(day(Math.floor(r() * 5))),
            sample, dispersion, SEED_SOURCE
          );
        }
      }
    }
  })();

  return counts();
}

export function counts() {
  const d = db();
  const n = (t: string) => (d.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
  return {
    programs: n("programs"), devices: n("devices"), observations: n("observations"),
    marketPrices: n("market_prices"), runs: n("runs"),
  };
}
