import { query, queryOne, execute } from "./db.ts";
import { isoWeek, toWeekly, weekOnWeek, type WoWPoint } from "../core/week.ts";
import { MIN_CREDIBLE_SAMPLE, type MarketPrice } from "../core/channel.ts";

/**
 * HAND-ENTERED PRICES.
 * Stored directly in PostgreSQL 'price_iq' schema.
 */

export type EntryInput = {
  deviceId: string;
  market: string;
  channel: string;
  amountMajor: number;
  currency: string;
  sampleSize: number;
  dispersionPct: number | null;
  source: string;
  /** ISO date the figure is FOR. Defaults to now. */
  observedAt?: string;
  enteredBy: string;
  note?: string;
};

export type EntryResult = { ok: true; id: number; week: string } | { ok: false; why: string };

/** Reject anything that would put a meaningless number into the series. */
export function validateEntry(i: EntryInput): string | null {
  if (!i.deviceId) return "pick a device";
  if (!/^(US|AE|IN)$/.test(i.market)) return "pick a market";
  if (!/^(retail|online|wholesale|enterprise|auction)$/.test(i.channel)) return "pick a channel";
  if (!Number.isFinite(i.amountMajor) || i.amountMajor <= 0) return "enter a price above zero";
  if (!/^[A-Za-z]{3}$/.test(i.currency || "")) return "currency must be a 3-letter code";
  if (!Number.isInteger(i.sampleSize) || i.sampleSize < 1) {
    return "how many comparable sales is this based on? (1 or more)";
  }
  if (i.dispersionPct !== null && (!Number.isFinite(i.dispersionPct) || i.dispersionPct < 0 || i.dispersionPct > 200)) {
    return "spread must be between 0 and 200%";
  }
  if (!i.source || i.source.trim().length < 3) {
    return "say where this came from — 'own closed deals', a broker, a listing page";
  }
  if (!i.enteredBy) return "not signed in";
  return null;
}

export async function recordMarketPrice(i: EntryInput): Promise<EntryResult> {
  const bad = validateEntry(i);
  if (bad) return { ok: false, why: bad };

  const observedAt = i.observedAt || new Date().toISOString();
  const w = isoWeek(observedAt);
  if (!w) return { ok: false, why: "that date could not be read" };

  const minor = Math.round(i.amountMajor * 100);

  const res = await queryOne<{ id: number }>(
    `INSERT INTO market_prices
       (device_id, market, channel, cond_lo, cond_hi, amount_minor, currency,
        observed_at, sample_size, dispersion_pct, source, entered_by, week)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      i.deviceId, i.market, i.channel, "flawless", "good", minor,
      i.currency.toUpperCase(), observedAt, i.sampleSize, i.dispersionPct,
      i.source.trim(), i.enteredBy, w.key
    ]
  );

  const insertedId = res?.id ? Number(res.id) : 0;
  await execute(
    "INSERT INTO entries (kind, ref_id, entered_by, week, note) VALUES ('market_price',$1,$2,$3,$4)",
    [insertedId, i.enteredBy, w.key, (i.note || "").slice(0, 300)]
  );

  return { ok: true, id: insertedId, week: w.key };
}

export type SeriesRow = {
  deviceId: string; deviceLabel: string; market: string; channel: string;
  points: WoWPoint[];
  latest: WoWPoint | null;
  thin: boolean;
};

/** Week-on-week series for every hand-entered device/market/channel from PostgreSQL. */
export async function weeklySeries(filter?: { market?: string; channel?: string }): Promise<SeriesRow[]> {
  const params: unknown[] = [];
  let where = "WHERE mp.entered_by != ''";
  if (filter?.market) {
    params.push(filter.market);
    where += ` AND mp.market = $${params.length}`;
  }
  if (filter?.channel) {
    params.push(filter.channel);
    where += ` AND mp.channel = $${params.length}`;
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT mp.device_id, mp.market, mp.channel, mp.amount_minor, mp.currency,
            mp.observed_at, mp.entered_by, mp.sample_size,
            d.brand, d.model, d.storage_gb
       FROM market_prices mp
       JOIN devices d ON d.id = mp.device_id
      ${where}
      ORDER BY mp.observed_at`,
    params
  );

  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const k = `${r.device_id}|${r.market}|${r.channel}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const out: SeriesRow[] = [];
  for (const [k, items] of groups) {
    const [deviceId, market, channel] = k.split("|");
    const first = items[0];
    const points = weekOnWeek(
      toWeekly(items.map((r) => ({
        observedAt: String(r.observed_at),
        amountMinor: Number(r.amount_minor),
        currency: String(r.currency),
        enteredBy: String(r.entered_by || ""),
      })))
    );
    out.push({
      deviceId, market, channel,
      deviceLabel: `${first.brand} ${first.model} ${first.storage_gb}GB`,
      points,
      latest: points.length ? points[points.length - 1] : null,
      thin: items.some((r) => Number(r.sample_size) < MIN_CREDIBLE_SAMPLE),
    });
  }
  return out.sort((a, b) => a.deviceLabel.localeCompare(b.deviceLabel) || a.channel.localeCompare(b.channel));
}

/** The most recent hand-entered figure for one slot from PostgreSQL, to prefill the form. */
export async function lastEntered(deviceId: string, market: string, channel: string) {
  return queryOne<{
    amount_minor: number; currency: string; sample_size: number; dispersion_pct: number | null;
    source: string; observed_at: string; week: string; entered_by: string;
  }>(
    `SELECT amount_minor, currency, sample_size, dispersion_pct, source, observed_at, week, entered_by
       FROM market_prices
      WHERE device_id=$1 AND market=$2 AND channel=$3 AND entered_by != ''
      ORDER BY observed_at DESC LIMIT 1`,
    [deviceId, market, channel]
  );
}
