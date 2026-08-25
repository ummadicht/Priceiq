import { db, j } from "./db.ts";
import { MARKETS, type MarketCode } from "../core/markets.ts";
import { lastChangeAt, since, type Observation } from "../core/observation.ts";
import { money, type FxRate, type Money } from "../core/money.ts";
import { spanOf, type LadderRung, type ConditionSpan, mapCondition } from "../core/condition.ts";
import { computeSpread, summariseByChannel, type Spread } from "../core/spread.ts";
import { CHANNELS, type Channel, type MarketPrice } from "../core/channel.ts";

/**
 * The layer between storage and the domain.
 *
 * It does no arithmetic of its own. Every number a screen shows is computed by
 * core/ from rows read here — "last change", spreads, comparability, currency
 * conversion. Keeping the maths out of the query layer is what stops the
 * dashboard slowly growing a second, subtly different implementation of rules
 * that are already tested.
 */

export type ProgramRow = {
  id: string; name: string; market: MarketCode; kind: string;
  publicUrl: string; cadenceHours: number;
  cleared: boolean; authority: string; enabled: boolean; note: string;
  priceCount: number;
  lastChangeAt: string | null;
  lastChangeAgo: string;
  lastRun: { id: string; status: string; captured: number; errors: number; quarantined: number; startedAt: string } | null;
  nextRunAt: string | null;
  ladder: LadderRung[];
};

function obsRows(where: string, params: unknown[]): Observation[] {
  return (
    db().prepare(
      `SELECT program_id, device_id, condition_label, amount_minor, currency, observed_at, run_id, source_url
         FROM observations ${where} ORDER BY observed_at`
    ).all(...(params as never[])) as Array<{
      program_id: string; device_id: string; condition_label: string;
      amount_minor: number | null; currency: string; observed_at: string;
      run_id: string; source_url: string;
    }>
  ).map((r) => ({
    programId: r.program_id, deviceId: r.device_id, conditionLabel: r.condition_label,
    price: r.amount_minor === null ? null : money(r.amount_minor, r.currency),
    observedAt: r.observed_at, runId: r.run_id, sourceUrl: r.source_url,
  }));
}

export function listPrograms(market?: MarketCode): ProgramRow[] {
  const d = db();
  const rows = (market
    ? d.prepare("SELECT * FROM programs WHERE market=? ORDER BY name").all(market)
    : d.prepare("SELECT * FROM programs ORDER BY market, name").all()) as Array<Record<string, unknown>>;

  return rows.map((p) => {
    const id = String(p.id);
    const priceCount = (d.prepare("SELECT count(*) c FROM observations WHERE program_id=?").get(id) as { c: number }).c;

    /* "Last change" is DERIVED, never stored.
     *
     * A stored field drifts from the series the moment anything backfills or
     * corrects an observation, and the drift is invisible. Deriving it means
     * the column on screen and the data underneath cannot disagree — and the
     * derivation is the tested one in core/observation, which knows that a
     * re-poll at the same price is not a change. */
    const perDevice = d.prepare("SELECT DISTINCT device_id FROM observations WHERE program_id=?").all(id) as Array<{ device_id: string }>;
    let latest: string | null = null;
    for (const { device_id } of perDevice) {
      const at = lastChangeAt(obsRows("WHERE program_id=? AND device_id=?", [id, device_id]));
      if (at && (!latest || at > latest)) latest = at;
    }

    const run = d.prepare("SELECT * FROM runs WHERE program_id=? ORDER BY started_at DESC LIMIT 1").get(id) as
      | Record<string, unknown> | undefined;

    const cadence = Number(p.cadence_hours) || 48;
    const nextRunAt = run?.started_at
      ? new Date(Date.parse(String(run.started_at)) + cadence * 3600_000).toISOString()
      : null;

    return {
      id, name: String(p.name), market: String(p.market) as MarketCode, kind: String(p.kind),
      publicUrl: String(p.public_url || ""), cadenceHours: cadence,
      cleared: !!p.cleared, authority: String(p.authority || ""), enabled: !!p.enabled,
      note: String(p.note || ""),
      priceCount,
      lastChangeAt: latest,
      lastChangeAgo: since(latest),
      lastRun: run
        ? {
            id: String(run.id), status: String(run.status), captured: Number(run.captured),
            errors: Number(run.errors), quarantined: Number(run.quarantined),
            startedAt: String(run.started_at),
          }
        : null,
      nextRunAt,
      ladder: j<LadderRung[]>(String((d.prepare("SELECT rungs FROM ladders WHERE program_id=?").get(id) as { rungs?: string })?.rungs || "[]"), []),
    };
  });
}

export type DeviceRow = { id: string; brand: string; model: string; storageGb: number; ramGb?: number; releaseYear: number; aliases: string[] };

export function listDevices(): DeviceRow[] {
  return (db().prepare("SELECT * FROM devices ORDER BY brand, release_year DESC, model, storage_gb").all() as Array<Record<string, unknown>>)
    .map((r) => ({
      id: String(r.id), brand: String(r.brand), model: String(r.model),
      storageGb: Number(r.storage_gb),
      ramGb: r.ram_gb === null || r.ram_gb === undefined ? undefined : Number(r.ram_gb),
      releaseYear: Number(r.release_year),
      aliases: j<string[]>(String(r.aliases || "[]"), []),
    }));
}

export function fxRates(): FxRate[] {
  return (db().prepare("SELECT base, quote, rate, as_of FROM fx_rates").all() as Array<Record<string, unknown>>)
    .map((r) => ({ base: String(r.base), quote: String(r.quote), rate: Number(r.rate), asOf: String(r.as_of) }));
}

function marketPrices(deviceId: string, market: MarketCode): MarketPrice[] {
  return (db().prepare(
    "SELECT * FROM market_prices WHERE device_id=? AND market=? ORDER BY observed_at DESC"
  ).all(deviceId, market) as Array<Record<string, unknown>>).map((r) => ({
    deviceId: String(r.device_id), market: String(r.market) as MarketCode,
    channel: String(r.channel) as Channel,
    condition: spanOf(String(r.cond_lo) as never, String(r.cond_hi) as never),
    price: money(Number(r.amount_minor), String(r.currency)),
    observedAt: String(r.observed_at), sampleSize: Number(r.sample_size),
    dispersionPct: r.dispersion_pct === null ? null : Number(r.dispersion_pct),
    source: String(r.source || ""),
  }));
}

/** The latest quote from each programme in a market for one device. */
function latestQuotes(deviceId: string, market: MarketCode) {
  return db().prepare(
    `SELECT o.program_id, p.name, o.condition_label, o.amount_minor, o.currency, o.observed_at
       FROM observations o
       JOIN programs p ON p.id = o.program_id
      WHERE o.device_id = ? AND p.market = ? AND o.amount_minor IS NOT NULL
        AND o.observed_at = (
          SELECT MAX(o2.observed_at) FROM observations o2
           WHERE o2.program_id = o.program_id AND o2.device_id = o.device_id
        )
      GROUP BY o.program_id`
  ).all(deviceId, market) as Array<{
    program_id: string; name: string; condition_label: string;
    amount_minor: number; currency: string; observed_at: string;
  }>;
}

export type CompareRow = {
  programId: string; programName: string;
  quote: Money; conditionLabel: string; conditionSpan: ConditionSpan | null;
  observedAt: string;
  spread: Spread | null;
  refusal: string | null;
};

export type CompareResult = {
  deviceId: string;
  market: MarketCode;
  channel: Channel;
  reportIn: string;
  rows: CompareRow[];
  channelSummary: ReturnType<typeof summariseByChannel>;
  marketPrice: MarketPrice | null;
};

/**
 * The comparison view: every programme's quote for one device, against the
 * market price for one channel.
 *
 * Rows that cannot be compared keep their refusal reason instead of vanishing.
 * A programme silently missing from a comparison table is indistinguishable
 * from a programme that does not quote the device, and those are very different
 * facts to a buyer.
 */
export function compareDevice(deviceId: string, market: MarketCode, channel: Channel): CompareResult {
  const rates = fxRates();
  const prices = marketPrices(deviceId, market);
  const forChannel = prices.find((p) => p.channel === channel) ?? null;
  const reportIn = MARKETS[market].currency;

  const rows: CompareRow[] = [];
  const allSpreads: Spread[] = [];

  for (const q of latestQuotes(deviceId, market)) {
    const rungs = j<LadderRung[]>(
      String((db().prepare("SELECT rungs FROM ladders WHERE program_id=?").get(q.program_id) as { rungs?: string })?.rungs || "[]"),
      []
    );
    const span = mapCondition({ programId: q.program_id, rungs }, q.condition_label);
    const quote = money(q.amount_minor, q.currency);

    let spread: Spread | null = null;
    let refusal: string | null = null;

    if (!span) {
      refusal = `"${q.condition_label}" is not on this programme's ladder`;
    } else if (!forChannel) {
      refusal = `no ${channel} market price for this device in ${MARKETS[market].name}`;
    } else {
      const r = computeSpread({
        programId: q.program_id, deviceId, market,
        tradeIn: { price: quote, condition: span, observedAt: q.observed_at },
        marketPrice: forChannel, reportIn, rates,
      });
      if (r.ok) { spread = r.spread; allSpreads.push(r.spread); }
      else refusal = r.why;
    }

    rows.push({
      programId: q.program_id, programName: q.name, quote,
      conditionLabel: q.condition_label, conditionSpan: span,
      observedAt: q.observed_at, spread, refusal,
    });
  }

  // Every channel, so the summary strip can show where the best exit is.
  const everyChannel: Spread[] = [];
  for (const mp of prices) {
    for (const row of rows) {
      if (!row.conditionSpan) continue;
      const r = computeSpread({
        programId: row.programId, deviceId, market,
        tradeIn: { price: row.quote, condition: row.conditionSpan, observedAt: row.observedAt },
        marketPrice: mp, reportIn, rates,
      });
      if (r.ok) everyChannel.push(r.spread);
    }
  }

  rows.sort((a, b) => {
    if (!a.spread && !b.spread) return 0;
    if (!a.spread) return 1;
    if (!b.spread) return -1;
    if (a.spread.confidence !== b.spread.confidence) return a.spread.confidence === "firm" ? -1 : 1;
    return b.spread.grossPct - a.spread.grossPct;
  });

  return {
    deviceId, market, channel, reportIn, rows,
    channelSummary: summariseByChannel(everyChannel, CHANNELS.map((c) => c.id)),
    marketPrice: forChannel,
  };
}

export function quarantineCount(): number {
  return (db().prepare("SELECT count(*) c FROM quarantine WHERE resolved_at IS NULL").get() as { c: number }).c;
}

export type Coverage = {
  /** Quotes per market for this device: which markets actually have data. */
  quotes: Array<{ market: MarketCode; programs: number; quotes: number }>;
  /** Channels with a market (sell-side) price in the given market. */
  channels: Channel[];
  totalQuotes: number;
};

/**
 * WHERE THIS DEVICE HAS DATA.
 *
 * A market-scoped comparison shows nothing when the device is not quoted in
 * that market — which is correct, and indistinguishable from a broken page.
 * "Empty because you are looking at the wrong market" and "empty because
 * nobody has this data" are very different facts and the screen owed the
 * reader both.
 */
export function coverageFor(deviceId: string, market: MarketCode): Coverage {
  const d = db();
  const quotes = d.prepare(
    `SELECT p.market, count(DISTINCT o.program_id) programs, count(*) quotes
       FROM observations o JOIN programs p ON p.id = o.program_id
      WHERE o.device_id = ? AND o.amount_minor IS NOT NULL
      GROUP BY p.market ORDER BY quotes DESC`
  ).all(deviceId) as Array<{ market: MarketCode; programs: number; quotes: number }>;

  const channels = (d.prepare(
    "SELECT DISTINCT channel FROM market_prices WHERE device_id = ? AND market = ?"
  ).all(deviceId, market) as Array<{ channel: Channel }>).map((r) => r.channel);

  return { quotes, channels, totalQuotes: quotes.reduce((t, q) => t + q.quotes, 0) };
}

/**
 * A sensible landing device — the one with the most quotes.
 *
 * `devices[0]` was alphabetical, which out of 2,566 devices meant the compare
 * page opened on something arbitrary that usually had no data at all.
 */
export function busiestDeviceId(): string | null {
  const r = db().prepare(
    `SELECT device_id, count(*) n FROM observations
      WHERE amount_minor IS NOT NULL GROUP BY device_id ORDER BY n DESC LIMIT 1`
  ).get() as { device_id: string } | undefined;
  return r?.device_id ?? null;
}
