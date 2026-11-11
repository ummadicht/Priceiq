import { query, execute } from "./db.ts";
import { parseStorageGb, parseRamGb } from "../core/device.ts";

/**
 * ENROLLING DEVICES FROM A SOURCE.
 * Persists into PostgreSQL 'price_iq.devices'.
 */

export type Derived = {
  raw: string;
  brand: string;
  model: string;
  storageGb: number;
  ramGb?: number;
  id: string;
};

const BRAND_CANON: Record<string, string> = {
  apple: "Apple", iphone: "Apple", ipad: "Apple",
  samsung: "Samsung", galaxy: "Samsung",
  google: "Google", pixel: "Google",
  xiaomi: "Xiaomi", redmi: "Xiaomi", mi: "Xiaomi",
  poco: "POCO", oppo: "OPPO", vivo: "Vivo",
  realme: "realme", oneplus: "OnePlus", iqoo: "iQOO",
  motorola: "Motorola", moto: "Motorola",
  nokia: "Nokia", honor: "Honor", infinix: "Infinix",
  tecno: "Tecno", nothing: "Nothing", asus: "Asus",
  lenovo: "Lenovo", lg: "LG", huawei: "Huawei", sony: "Sony",
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function derive(raw: string): Derived | null {
  const text = (raw || "").trim();
  if (!text) return null;

  const storageGb = parseStorageGb(text);
  if (!storageGb) return null;

  const ramGb = parseRamGb(text) ?? undefined;

  // Strip scraper prefix ("Cashify", "Grade A/B/C/D/E", "Flawless", "Good", etc.)
  const stripped = text
    .replace(/^cashify\s+/i, "")
    .replace(/^(?:grade\s+[a-e][+-]?|flawless|good|fair|poor|broken|superb|excellent|average)\s+/i, "")
    .trim();

  const words = stripped.split(/\s+/);
  let brand: string | undefined;
  for (const w of words) {
    const cleanW = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (BRAND_CANON[cleanW]) {
      brand = BRAND_CANON[cleanW];
      break;
    }
  }
  if (!brand) return null;

  const clean = stripped
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\b\d+\s*gb\s*[/|]\s*\d+\s*(gb|tb)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(gb|tb)\b/gi, " ")
    .replace(/\b(5G|4G|LTE|Unlocked|Dual\s+SIM|Refurbished)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const brandPat = new RegExp(`^${brand}\\s*`, "i");
  let model = clean.replace(brandPat, "").trim() || clean;
  // Also strip trailing bare storage capacity if present
  model = model.replace(new RegExp(`\\b${storageGb}$`), "").trim() || model;

  const parts = [slug(brand), slug(model)];
  if (ramGb) parts.push(`${ramGb}gb`);
  parts.push(`${storageGb}gb`);
  const id = parts.join("-");

  return { raw: text, brand, model, storageGb, ramGb, id };
}

export type EnrolReport = {
  seen: number;
  derived: number;
  added: number;
  existing: number;
  skipped: Array<{ raw: string; why: string }>;
};

/** Add any device in `models` that the catalogue does not already hold in PostgreSQL. */
export async function enrolDevices(models: string[], opts: { commit: boolean }): Promise<EnrolReport> {
  const rows = await query<{ id: string }>("SELECT id FROM devices");
  const have = new Set(rows.map((r) => r.id));
  const report: EnrolReport = { seen: models.length, derived: 0, added: 0, existing: 0, skipped: [] };
  const staged = new Map<string, Derived>();

  for (const raw of models) {
    const dev = derive(raw);
    if (!dev) {
      report.skipped.push({
        raw,
        why: parseStorageGb(raw) ? "brand not recognised" : "no storage capacity in the name",
      });
      continue;
    }
    report.derived++;
    if (have.has(dev.id)) { report.existing++; continue; }
    if (!staged.has(dev.id)) staged.set(dev.id, dev);
  }
  report.added = staged.size;

  if (opts.commit) {
    for (const dev of staged.values()) {
      const aliasList = dev.raw !== `${dev.brand} ${dev.model} ${dev.storageGb}GB` ? [dev.raw] : [];
      await execute(
        `INSERT INTO devices (id, brand, model, storage_gb, ram_gb, release_year, aliases)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [dev.id, dev.brand, dev.model, dev.storageGb, dev.ramGb ?? null, 2024, JSON.stringify(aliasList)]
      );
    }
  }
  return report;
}
