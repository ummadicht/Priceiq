/**
 * FINDING ONE DEVICE AMONG THOUSANDS.
 *
 * The picker was a row of chips, which is a perfectly good control for eight
 * devices and a catastrophe for 2,566 — the compare page shipped 1.5 MB of
 * markup, every byte of it a device nobody was looking for.
 *
 * The replacement is the shape the domain already has:
 *
 *     MANUFACTURER  →  MODEL  →  SKU
 *     Samsung          Galaxy S24 Ultra   12GB / 512GB
 *
 * A SKU is where the price actually lives. Two SKUs of one model can be worth
 * very different money — 370 real RAM variants in the Indian list are priced
 * apart — so the third level is not a detail, it is the thing being priced.
 *
 * Free text cuts across all three, because people know what they are looking
 * for and do not want to walk a tree to reach it.
 */

export type SearchableDevice = {
  id: string;
  brand: string;
  model: string;
  storageGb: number;
  ramGb?: number;
};

/** How a variant is written for a human: "12GB / 512GB" or just "512GB". */
export function skuLabel(d: SearchableDevice): string {
  const storage = d.storageGb >= 1024 && d.storageGb % 1024 === 0
    ? `${d.storageGb / 1024}TB`
    : `${d.storageGb}GB`;
  return d.ramGb ? `${d.ramGb}GB / ${storage}` : storage;
}

export function fullLabel(d: SearchableDevice): string {
  return `${d.brand} ${d.model} ${skuLabel(d)}`;
}

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function brandsOf(devices: SearchableDevice[]): Array<{ brand: string; count: number }> {
  const m = new Map<string, number>();
  for (const d of devices) m.set(d.brand, (m.get(d.brand) || 0) + 1);
  return [...m.entries()]
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

export function modelsOf(devices: SearchableDevice[], brand: string): Array<{ model: string; count: number }> {
  const m = new Map<string, number>();
  for (const d of devices) if (d.brand === brand) m.set(d.model, (m.get(d.model) || 0) + 1);
  return [...m.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }));
}

export function skusOf(devices: SearchableDevice[], brand: string, model: string): SearchableDevice[] {
  return devices
    .filter((d) => d.brand === brand && d.model === model)
    // Smallest first — a variant list reads as a ladder, not a jumble.
    .sort((a, b) => (a.ramGb ?? 0) - (b.ramGb ?? 0) || a.storageGb - b.storageGb);
}

export type Hit = { device: SearchableDevice; score: number };

/**
 * Free-text search across manufacturer, model and SKU.
 *
 * Ranked so the obvious answer is first: EVERY term must appear (typing more
 * words narrows, never widens), and a term matching the start of a word beats
 * one buried inside it — "s24" should surface the Galaxy S24 before something
 * that merely contains those characters. Exact full-label equality wins
 * outright, so pasting a device name lands on it.
 */
export function searchDevices(devices: SearchableDevice[], query: string, limit = 40): Hit[] {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(" ").filter(Boolean);

  const hits: Hit[] = [];
  for (const d of devices) {
    const label = norm(fullLabel(d));
    const words = label.split(" ");
    let score = 0;
    let all = true;

    for (const t of terms) {
      if (words.some((w) => w === t)) { score += 10; continue; }        // whole word
      if (words.some((w) => w.startsWith(t))) { score += 6; continue; } // prefix
      if (label.includes(t)) { score += 2; continue; }                  // anywhere
      all = false;
      break;
    }
    if (!all) continue;

    if (label === q) score += 100;
    // A shorter label containing the same terms is the more specific answer.
    score -= Math.min(6, Math.floor(label.length / 12));
    hits.push({ device: d, score });
  }

  return hits
    .sort((a, b) => b.score - a.score || fullLabel(a.device).localeCompare(fullLabel(b.device), undefined, { numeric: true }))
    .slice(0, limit);
}
