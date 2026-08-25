import { db } from "./db.ts";
import { isoWeek, toWeekly, weekOnWeek, type WoWPoint } from "../core/week.ts";
import { MIN_CREDIBLE_SAMPLE } from "../core/channel.ts";

/**
 * HAND-ENTERED PRICES.
 *
 * The first real data this system will hold. core/collection.ts already treats
 * manual entry as a first-class collector rather than a placeholder — this is
 * that collector's storage side.
 *
 * APPEND ONLY. Correcting last week's figure means entering a new one, never
 * editing the old row. Two reasons, and the second is the important one:
 * the week-on-week series must be reconstructible, and an UPDATE erases the
 * fact that somebody once believed a different number.
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
    // A price with no stated basis is an opinion. It may still be worth
    // recording — but the number of comparables behind it is not optional,
    // because everything downstream weighs the figure by exactly that.
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

export function recordMarketPrice(i: EntryInput): EntryResult {
  const bad = validateEntry(i);
  if (bad) return { ok: false, why: bad };

  const observedAt = i.observedAt || new Date().toISOString();
  const w = isoWeek(observedAt);
  if (!w) return { ok: false, why: "that date could not be read" };

  const minor = Math.round(i.amountMajor * 100); // all three markets use 2dp
  const d = db();
  const info = d
    .prepare(
      `INSERT INTO market_prices
         (device_id, market, channel, cond_lo, cond_hi, amount_minor, currency,
          observed_at, sample_size, dispersion_pct, source, entered_by, week)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      i.deviceId, i.market, i.channel, "flawless", "good", minor,
      i.currency.toUpperCase(), observedAt, i.sampleSize, i.dispersionPct,
      i.source.trim(), i.enteredBy, w.key
    );

  d.prepare(
    "INSERT INTO entries (kind, ref_id, entered_by, week, note) VALUES ('market_price',?,?,?,?)"
  ).run(info.lastInsertRowid, i.enteredBy, w.key, (i.note || "").slice(0, 300));

  return { ok: true, id: Number(info.lastInsertRowid), week: w.key };
}

export type SeriesRow = {
  deviceId: string; deviceLabel: string; market: string; channel: string;
  points: WoWPoint[];
  latest: WoWPoint | null;
  thin: boolean;
};

/** Week-on-week series for every hand-entered device/market/channel. */
export function weeklySeries(filter?: { market?: string; channel?: string }): SeriesRow[] {
  const rows = db()
    .prepare(
      `SELECT mp.device_id, mp.market, mp.channel, mp.amount_minor, mp.currency,
              mp.observed_at, mp.entered_by, mp.sample_size,
              d.brand, d.model, d.storage_gb
         FROM market_prices mp
         JOIN devices d ON d.id = mp.device_id
        WHERE mp.entered_by != ''
          ${filter?.market ? "AND mp.market = @market" : ""}
          ${filter?.channel ? "AND mp.channel = @channel" : ""}
        ORDER BY mp.observed_at`
    )
    .all({ market: filter?.market ?? null, channel: filter?.channel ?? null }) as Array<Record<string, unknown>>;

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

/** The most recent hand-entered figure for one slot, to prefill the form. */
export function lastEntered(deviceId: string, market: string, channel: string) {
  return db()
    .prepare(
      `SELECT amount_minor, currency, sample_size, dispersion_pct, source, observed_at, week, entered_by
         FROM market_prices
        WHERE device_id=? AND market=? AND channel=? AND entered_by != ''
        ORDER BY observed_at DESC LIMIT 1`
    )
    .get(deviceId, market, channel) as
    | { amount_minor: number; currency: string; sample_size: number; dispersion_pct: number | null;
        source: string; observed_at: string; week: string; entered_by: string }
    | undefined;
}
