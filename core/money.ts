/**
 * MONEY AND CROSS-CURRENCY COMPARISON.
 *
 * Two decisions here, both of which are cheap now and very expensive later.
 *
 * 1. AMOUNTS ARE INTEGERS IN MINOR UNITS. Floating point money drifts, and a
 *    price-intelligence product whose totals disagree with themselves has no
 *    reason to exist. NZD 890.50 is 89050. And minor units are NOT always
 *    hundredths: JPY has none at all, so ¥890 is 890, and a table that assumes
 *    two decimals everywhere shows a Japanese program's prices at 1/100th of
 *    reality — a mistake that looks like an incredible deal.
 *
 * 2. CONVERSION USES THE RATE FROM THE OBSERVATION DATE, and stores it. A chart
 *    built by converting historical prices at today's rate is not a price
 *    history — it is a currency history wearing one. Yesterday's comparison
 *    would silently change overnight because the yen moved, and nobody could
 *    reproduce a number they screenshotted last week. So every converted figure
 *    carries the rate that produced it and the date that rate was for.
 */

/** Minor-unit digits. Anything not listed is assumed to have two. */
const MINOR_DIGITS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[(currency || "").toUpperCase()] ?? 2;
}

export type Money = {
  /** Integer, in the currency's smallest unit. */
  amountMinor: number;
  /** ISO 4217, uppercase. */
  currency: string;
};

export function money(amountMinor: number, currency: string): Money {
  return { amountMinor: Math.round(amountMinor), currency: (currency || "").toUpperCase() };
}

/** Build Money from a human figure, e.g. fromMajor(890, "NZD") → 89000 minor. */
export function fromMajor(major: number, currency: string): Money {
  const d = minorDigits(currency);
  return money(Math.round(major * 10 ** d), currency);
}

export function toMajor(m: Money): number {
  return m.amountMinor / 10 ** minorDigits(m.currency);
}

export function formatMoney(m: Money, locale = "en"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: m.currency,
      minimumFractionDigits: minorDigits(m.currency),
      maximumFractionDigits: minorDigits(m.currency),
    }).format(toMajor(m));
  } catch {
    return `${m.currency} ${toMajor(m)}`;
  }
}

/** One quoted rate: 1 unit of `base` buys `rate` units of `quote`, on `asOf`. */
export type FxRate = { base: string; quote: string; rate: number; asOf: string };

/**
 * How far out of date a rate may be before a conversion stops being honest.
 *
 * Two days rather than zero: rates are not published at weekends, and refusing
 * to convert a Saturday observation would leave holes in every chart. Beyond
 * that the number is a guess, and the caller is told so rather than shown a
 * confident figure built on a stale quote.
 */
export const MAX_RATE_AGE_DAYS = 2;

export type Converted = {
  money: Money;
  rateUsed: number;
  rateAsOf: string;
  /** Days between the observation and the rate that priced it. */
  rateAgeDays: number;
  /** True when the rate was older than MAX_RATE_AGE_DAYS. */
  stale: boolean;
};

export type ConvertResult = { ok: true; value: Converted } | { ok: false; why: string };

const DAY = 86_400_000;

function dayDiff(a: string, b: string): number | null {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / DAY;
}

/**
 * Convert an observed price into another currency, as of the observation date.
 *
 * Returns a failure rather than throwing, because one missing rate must not
 * take down a comparison of forty programs — the row simply reports that it
 * could not be converted.
 */
export function convert(
  m: Money,
  to: string,
  observedAt: string,
  rates: FxRate[]
): ConvertResult {
  const target = (to || "").toUpperCase();
  if (!target) return { ok: false, why: "no target currency" };
  if (m.currency === target) {
    return { ok: true, value: { money: m, rateUsed: 1, rateAsOf: observedAt, rateAgeDays: 0, stale: false } };
  }

  const candidates = rates.filter(
    (r) =>
      (r.base === m.currency && r.quote === target) ||
      (r.base === target && r.quote === m.currency)
  );
  if (!candidates.length) return { ok: false, why: `no ${m.currency}→${target} rate available` };

  // Nearest quote to the observation date, not the newest available.
  let best: FxRate | null = null;
  let bestAge = Infinity;
  for (const r of candidates) {
    const age = dayDiff(r.asOf, observedAt);
    if (age === null) continue;
    if (age < bestAge) { bestAge = age; best = r; }
  }
  if (!best) return { ok: false, why: "no rate with a usable date" };

  const direct = best.base === m.currency;
  const rate = direct ? best.rate : 1 / best.rate;
  if (!Number.isFinite(rate) || rate <= 0) return { ok: false, why: "rate is not a usable number" };

  // Convert through major units so differing minor-unit digits are handled:
  // NZD 890.00 → JPY must not become ¥89000 by moving integers around.
  const majorOut = toMajor(m) * rate;
  return {
    ok: true,
    value: {
      money: fromMajor(majorOut, target),
      rateUsed: rate,
      rateAsOf: best.asOf,
      rateAgeDays: Math.round(bestAge * 10) / 10,
      stale: bestAge > MAX_RATE_AGE_DAYS,
    },
  };
}
