import { resolveDevice, type CanonicalDevice } from "./device.ts";
import { mapCondition, type ProgramLadder } from "./condition.ts";
import { fromMajor, type Money } from "./money.ts";
import { type Observation } from "./observation.ts";

/**
 * INGEST — where a scraped row becomes a price, or doesn't.
 *
 * This is the only place the four core modules meet, and it exists to enforce
 * one rule that the rest of the product depends on:
 *
 *     A ROW THAT CANNOT BE RESOLVED IS QUARANTINED, NEVER APPROXIMATED.
 *
 * The tempting alternative is to attach an unresolved row to its closest
 * device, or to default an unknown condition grade to the middle of the ladder.
 * Both produce a database that looks complete and is subtly wrong, and the
 * wrongness surfaces months later as a customer disputing a number nobody can
 * reconstruct. A quarantine queue is an operational chore. A silently
 * mis-filed price is a corrupted dataset.
 *
 * Quarantined rows keep everything needed to fix them — the raw strings, the
 * reason, the run and the source URL — so clearing the queue is a catalogue
 * edit rather than a re-scrape.
 */

/** What a scraper hands over: strings, exactly as they appeared on the page. */
export type ScrapedRow = {
  /** e.g. "Apple iPhone 15 Pro Max (512 GB)" */
  deviceText: string;
  /** e.g. "Excellent" */
  conditionText: string;
  /** Major units as printed, e.g. 890. null when the page quoted no price. */
  priceMajor: number | null;
  currency: string;
  sourceUrl: string;
  /** Optional timestamp from the scraper record (e.g. scraped_at). */
  observedAt?: string;
};

export type IngestContext = {
  programId: string;
  runId: string;
  observedAt: string;
  catalogue: CanonicalDevice[];
  ladder: ProgramLadder;
};

export type QuarantineReason =
  | "device_unresolved"
  | "device_ambiguous"
  | "condition_unknown"
  | "price_invalid";

export type Quarantined = {
  reason: QuarantineReason;
  why: string;
  row: ScrapedRow;
  programId: string;
  runId: string;
  observedAt: string;
  /** Present when the device was ambiguous — the shortlist a human can pick from. */
  candidateIds?: string[];
};

export type IngestResult = {
  observations: Observation[];
  quarantined: Quarantined[];
  /** Rows that produced neither — currently impossible, kept as a tripwire. */
  dropped: number;
};

function validPrice(row: ScrapedRow): { ok: true; price: Money | null } | { ok: false; why: string } {
  if (row.priceMajor === null || row.priceMajor === undefined) {
    // A page that lists the device but quotes nothing. Legitimate, and NOT zero.
    return { ok: true, price: null };
  }
  if (!Number.isFinite(row.priceMajor)) return { ok: false, why: "price is not a number" };
  if (row.priceMajor < 0) return { ok: false, why: "price is negative" };
  if (!/^[A-Za-z]{3}$/.test(row.currency || "")) {
    return { ok: false, why: `"${row.currency}" is not an ISO currency code` };
  }
  return { ok: true, price: fromMajor(row.priceMajor, row.currency) };
}

export function ingest(rows: ScrapedRow[], ctx: IngestContext): IngestResult {
  const observations: Observation[] = [];
  const quarantined: Quarantined[] = [];
  let dropped = 0;

  const park = (reason: QuarantineReason, why: string, row: ScrapedRow, candidateIds?: string[]) =>
    quarantined.push({
      reason, why, row, candidateIds,
      programId: ctx.programId, runId: ctx.runId, observedAt: row.observedAt || ctx.observedAt,
    });

  for (const row of rows) {
    const priced = validPrice(row);
    if (!priced.ok) { park("price_invalid", priced.why, row); continue; }

    const resolved = resolveDevice(row.deviceText, ctx.catalogue);
    if (resolved.status === "unresolved") {
      park("device_unresolved", resolved.why, row);
      continue;
    }
    if (resolved.status === "ambiguous") {
      // Deliberately NOT resolved to candidates[0]. "Probably the 256GB one"
      // is how a dataset rots.
      park("device_ambiguous", resolved.why, row, resolved.candidates.map((d) => d.id));
      continue;
    }

    const span = mapCondition(ctx.ladder, row.conditionText);
    if (!span) {
      park("condition_unknown", `"${row.conditionText}" is not on ${ctx.programId}'s ladder`, row);
      continue;
    }

    observations.push({
      programId: ctx.programId,
      deviceId: resolved.device.id,
      conditionLabel: row.conditionText,
      price: priced.price,
      observedAt: row.observedAt || ctx.observedAt,
      runId: ctx.runId,
      sourceUrl: row.sourceUrl,
    });
  }

  return { observations, quarantined, dropped };
}

/**
 * Ingest health, for the run row on a program card.
 *
 * `matchRate` is the number to watch. A scraper can succeed perfectly — 200s,
 * no exceptions, thousands of rows — while the catalogue silently fails to
 * recognise a new model launch, and the only visible symptom is this ratio
 * sliding. It is reported per run so the slide is noticeable early.
 */
export function ingestHealth(r: IngestResult): {
  total: number; captured: number; quarantined: number; matchRate: number;
  byReason: Record<string, number>;
} {
  const total = r.observations.length + r.quarantined.length + r.dropped;
  const byReason: Record<string, number> = {};
  for (const q of r.quarantined) byReason[q.reason] = (byReason[q.reason] || 0) + 1;
  return {
    total,
    captured: r.observations.length,
    quarantined: r.quarantined.length,
    matchRate: total === 0 ? 1 : Math.round((r.observations.length / total) * 1000) / 1000,
    byReason,
  };
}
