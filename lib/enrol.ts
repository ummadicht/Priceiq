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
  apple: "Apple", samsung: "Samsung", google: "Google", xiaomi: "Xiaomi",
  redmi: "Xiaomi", mi: "Xiaomi", poco: "POCO", oppo: "OPPO", vivo: "Vivo",
  realme: "realme", oneplus: "OnePlus", iqoo: "iQOO", motorola: "Motorola",
  moto: "Motorola", nokia: "Nokia", honor: "Honor", infinix: "Infinix",
  tecno: "Tecno", nothing: "Nothing", asus: "Asus", lenovo: "Lenovo",
  lg: "LG", huawei: "Huawei", sony: "Sony",
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function derive(raw: string): Derived | null {
  const text = (raw || "").trim();
  if (!text) return null;

  const storageGb = parseStorageGb(text);
  if (!storageGb) return null;

  const ramGb = parseRamGb(text) ?? undefined;

  const first = text.split(/\s+/)[0]?.toLowerCase() || "";
  const brand = BRAND_CANON[first];
  if (!brand) return null;

  const clean = text
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\b(5G|4G|LTE)\b/gi, "")
    .trim();

  const brandPat = new RegExp(`^${brand}\\s*`, "i");
  const model = clean.replace(brandPat, "").trim() || clean;

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
      await execute(
        `INSERT INTO devices (id, brand, model, storage_gb, ram_gb, release_year, aliases)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [dev.id, dev.brand, dev.model, dev.storageGb, dev.ramGb ?? null, 0, "[]"]
      );
    }
  }
  return report;
}
