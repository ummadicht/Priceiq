import { db } from "./db.ts";
import { parseStorageGb, parseRamGb } from "../core/device.ts";

/**
 * ENROLLING DEVICES FROM A SOURCE.
 *
 * A price list is also a device list. A 2,558-row exchange sheet names every
 * handset that programme quotes, in a consistent shape, which is far more
 * device knowledge than anyone will hand-type.
 *
 * But this is DELIBERATELY A SEPARATE STEP from importing prices, because
 * enrolling devices changes the identity space every future comparison resolves
 * against. Done as a side effect of a price import, one supplier's typos and
 * one supplier's naming conventions quietly become the canonical catalogue, and
 * a second source then fails to match the first. Enrolment is a decision.
 *
 * The shape this parses is "Brand Model (RAM/Storage)":
 *
 *     Apple iPhone 11 (4 GB/128 GB)      → Apple · iPhone 11 · 128GB
 *     Realme GT 7 Pro 5G (12 GB/256 GB)  → realme · GT 7 Pro 5G · 256GB
 *     Samsung Galaxy F70e 5G (4 GB/128 GB) → Samsung · Galaxy F70e 5G · 128GB
 */

export type Derived = {
  raw: string;
  brand: string;
  model: string;
  storageGb: number;
  /** Present when the source declared it — see CanonicalDevice.ramGb. */
  ramGb?: number;
  id: string;
};

/** Canonical spelling for the brand tokens this source uses. */
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

/**
 * Derive a canonical device from a source's model string.
 *
 * Returns null rather than guessing when the brand is unknown or no storage can
 * be read — an un-derivable row is reported, never enrolled as a device whose
 * identity nobody can reproduce.
 */
export function derive(raw: string): Derived | null {
  const text = (raw || "").trim();
  if (!text) return null;

  const storageGb = parseStorageGb(text);
  if (!storageGb) return null;

  // Strip the "(4 GB/128 GB)" parenthetical — it is RAM and storage, and
  // storage is already captured. Leaving it in would make the model name
  // differ for every RAM variant of the same handset.
  const withoutParens = text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  const first = withoutParens.split(/\s+/)[0]?.toLowerCase() ?? "";
  const brand = BRAND_CANON[first];
  if (!brand) return null;

  // Model is what remains after the brand token. Apple's rows read
  // "Apple iPhone 11", so dropping just the first token leaves "iPhone 11".
  const model = withoutParens.split(/\s+/).slice(1).join(" ").trim();
  if (!model) return null;

  /* RAM GOES IN THE ID when the source declares it.
   *
   * Without it, an Honor 90 256GB at 8GB and at 12GB of RAM collapse to one
   * device holding two different prices, and whichever imported last would
   * silently win. In this source that is 370 real handsets. */
  const ramGb = parseRamGb(text) ?? undefined;
  const id = ramGb
    ? `${slug(brand)}-${slug(model)}-${ramGb}-${storageGb}`
    : `${slug(brand)}-${slug(model)}-${storageGb}`;

  return { raw: text, brand, model, storageGb, ramGb, id };
}

export type EnrolReport = {
  seen: number;
  derived: number;
  added: number;
  existing: number;
  skipped: Array<{ raw: string; why: string }>;
};

/** Add any device in `models` that the catalogue does not already hold. */
export function enrolDevices(models: string[], opts: { commit: boolean }): EnrolReport {
  const d = db();
  const have = new Set(
    (d.prepare("SELECT id FROM devices").all() as Array<{ id: string }>).map((r) => r.id)
  );
  const report: EnrolReport = { seen: models.length, derived: 0, added: 0, existing: 0, skipped: [] };

  const ins = d.prepare(
    "INSERT OR IGNORE INTO devices (id, brand, model, storage_gb, ram_gb, release_year, aliases) VALUES (?,?,?,?,?,?,?)"
  );
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
    d.transaction(() => {
      for (const dev of staged.values()) {
        // Release year is unknown from a price list. Zero rather than a guess:
        // a fabricated year would look like fact on a device page.
        ins.run(dev.id, dev.brand, dev.model, dev.storageGb, dev.ramGb ?? null, 0, "[]");
      }
    })();
  }
  return report;
}
