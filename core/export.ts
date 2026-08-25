import { convert, minorDigits, toMajor, type FxRate, type Money } from "./money.ts";

/**
 * EXPORTS — every price in its own currency AND in USD.
 *
 * A price list in rupees is the truth of what an Indian programme pays. A price
 * list in dollars is what makes it comparable to Dubai and the US. Both belong
 * in the same file, side by side, because forcing the reader to pick one means
 * half of them convert it themselves at whatever rate their browser found that
 * morning — and then two people quote different dollar figures from one source.
 *
 * THE RATE TRAVELS WITH THE ROW. Every converted figure carries the rate used
 * and the date that rate was for. Without them an export is a snapshot nobody
 * can reproduce: open it next month, recompute, get a different number, and
 * there is no way to tell whether the price moved or the currency did.
 *
 * A ROW THAT CANNOT BE CONVERTED STILL EXPORTS, with an empty USD column and a
 * stated reason. A blank that means "no rate available" must never be
 * indistinguishable from a blank that means zero.
 */

export type ExportInput = {
  programId: string;
  programName: string;
  market: string;
  deviceId: string;
  brand: string;
  model: string;
  sku: string;
  ramGb?: number;
  storageGb: number;
  grade: string;
  conditionSpan: string;
  price: Money;
  observedAt: string;
  week: string;
  source: string;
};

export type ExportRow = ExportInput & {
  localAmount: number;
  localCurrency: string;
  usdAmount: number | null;
  /**
   * LOCAL UNITS PER USD — the way a rate is actually quoted (95.3545 INR/USD),
   * not the multiplier applied internally (0.010487).
   *
   * This is the ACTUAL rate applied, so it is identical on every row from the
   * same day. Deriving it per row from the rounded amounts instead made it
   * wobble in the fourth decimal — 95.3587, 95.3531, 95.3569 down one column —
   * which reads as three different rates rather than one rate and some
   * rounding. Dividing the printed amounts will land within a cent of it; that
   * gap is the USD column being rounded to cents, and is normal.
   */
  usdRate: number | null;
  usdRateAsOf: string | null;
  usdRateStale: boolean;
  usdNote: string;
};

export const EXPORT_COLUMNS = [
  "programme", "programme_id", "market",
  "brand", "model", "sku", "ram_gb", "storage_gb", "device_id",
  "grade", "condition",
  "local_amount", "local_currency",
  "usd_amount", "local_per_usd", "rate_as_of", "rate_stale", "usd_note",
  "observed_at", "week", "source",
] as const;

export function buildRows(items: ExportInput[], rates: FxRate[]): ExportRow[] {
  return items.map((i) => {
    const c = convert(i.price, "USD", i.observedAt, rates);
    if (!c.ok) {
      return {
        ...i,
        localAmount: toMajor(i.price),
        localCurrency: i.price.currency,
        usdAmount: null, usdRate: null, usdRateAsOf: null, usdRateStale: false,
        usdNote: c.why,
      };
    }
    const localAmount = toMajor(i.price);
    const usdAmount = toMajor(c.value.money);
    // rateUsed converts local -> USD; the conventional quote is its inverse.
    const perUsd = c.value.rateUsed > 0 ? 1 / c.value.rateUsed : null;
    return {
      ...i,
      localAmount,
      localCurrency: i.price.currency,
      usdAmount,
      usdRate: perUsd === null ? null : Math.round(perUsd * 10000) / 10000,
      usdRateAsOf: c.value.rateAsOf,
      usdRateStale: c.value.stale,
      usdNote: c.value.stale ? `rate is ${c.value.rateAgeDays} days from the observation` : "",
    };
  });
}

/** RFC-4180 escaping: quotes doubled, and any field with a delimiter quoted. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportRow[]): string {
  const head = EXPORT_COLUMNS.join(",");
  const body = rows.map((r) => {
    const d = minorDigits(r.localCurrency);
    return [
      r.programName, r.programId, r.market,
      r.brand, r.model, r.sku, r.ramGb ?? "", r.storageGb, r.deviceId,
      r.grade, r.conditionSpan,
      r.localAmount.toFixed(d), r.localCurrency,
      r.usdAmount === null ? "" : r.usdAmount.toFixed(2),
      r.usdRate ?? "", r.usdRateAsOf ?? "", r.usdRateStale ? "yes" : "",
      r.usdNote,
      r.observedAt, r.week, r.source,
    ].map(csvCell).join(",");
  });
  return [head, ...body].join("\n");
}

/** Totals a reader checks before trusting the file. */
export function exportSummary(rows: ExportRow[]) {
  const converted = rows.filter((r) => r.usdAmount !== null);
  return {
    rows: rows.length,
    converted: converted.length,
    unconverted: rows.length - converted.length,
    stale: rows.filter((r) => r.usdRateStale).length,
    currencies: [...new Set(rows.map((r) => r.localCurrency))].sort(),
    rateRange: converted.length
      ? { lo: Math.min(...converted.map((r) => r.usdRate!)), hi: Math.max(...converted.map((r) => r.usdRate!)) }
      : null,
  };
}
