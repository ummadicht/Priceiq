import { query, queryOne, execute, j } from "./db.ts";
import { MARKETS, type MarketCode } from "../core/markets.ts";
import { lastChangeAt, since, type Observation } from "../core/observation.ts";
import { money, type FxRate, type Money } from "../core/money.ts";
import { spanOf, type LadderRung, type ConditionSpan, mapCondition, comparability } from "../core/condition.ts";
import { computeSpread, summariseByChannel, type Spread } from "../core/spread.ts";
import { CHANNELS, type Channel, type MarketPrice } from "../core/channel.ts";

/**
 * The layer between PostgreSQL 'price_iq' storage and the domain.
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

async function obsRows(where: string, params: unknown[]): Promise<Observation[]> {
  const rows = await query<{
    program_id: string; device_id: string; condition_label: string;
    amount_minor: number | null; currency: string; observed_at: string;
    run_id: string; source_url: string;
  }>(
    `SELECT program_id, device_id, condition_label, amount_minor, currency, observed_at, run_id, source_url
       FROM observations ${where} ORDER BY observed_at`,
    params
  );

  return rows.map((r) => ({
    programId: String(r.program_id), deviceId: String(r.device_id), conditionLabel: String(r.condition_label),
    price: r.amount_minor === null ? null : money(Number(r.amount_minor), String(r.currency)),
    observedAt: String(r.observed_at), runId: String(r.run_id), sourceUrl: String(r.source_url),
  }));
}

export async function listPrograms(market?: MarketCode): Promise<ProgramRow[]> {
  const rows = market
    ? await query("SELECT * FROM programs WHERE market=$1 ORDER BY name", [market])
    : await query("SELECT * FROM programs ORDER BY market, name");

  const programs: ProgramRow[] = [];
  for (const p of rows) {
    const id = String(p.id);
    const priceCountRow = await queryOne<{ c: number }>("SELECT count(*) c FROM observations WHERE program_id=$1", [id]);
    const priceCount = Number(priceCountRow?.c || 0);

    const perDevice = await query<{ device_id: string }>("SELECT DISTINCT device_id FROM observations WHERE program_id=$1", [id]);
    let latest: string | null = null;
    for (const { device_id } of perDevice) {
      const at = lastChangeAt(await obsRows("WHERE program_id=$1 AND device_id=$2", [id, device_id]));
      if (at && (!latest || at > latest)) latest = at;
    }

    const run = await queryOne("SELECT * FROM runs WHERE program_id=$1 ORDER BY started_at DESC LIMIT 1", [id]);

    const cadence = Number(p.cadence_hours) || 48;
    const nextRunAt = run?.started_at
      ? new Date(Date.parse(String(run.started_at)) + cadence * 3600_000).toISOString()
      : null;

    const ladderRow = await queryOne<{ rungs?: string }>("SELECT rungs FROM ladders WHERE program_id=$1", [id]);

    programs.push({
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
      ladder: j<LadderRung[]>(typeof ladderRow?.rungs === "string" ? ladderRow.rungs : JSON.stringify(ladderRow?.rungs || []), []),
    });
  }
  return programs;
}

export type DeviceRow = { id: string; brand: string; model: string; storageGb: number; ramGb?: number; releaseYear: number; aliases: string[] };

export async function listDevices(): Promise<DeviceRow[]> {
  const rows = await query("SELECT * FROM devices ORDER BY brand, release_year DESC, model, storage_gb");
  return rows.map((r) => ({
    id: String(r.id), brand: String(r.brand), model: String(r.model),
    storageGb: Number(r.storage_gb),
    ramGb: r.ram_gb === null || r.ram_gb === undefined ? undefined : Number(r.ram_gb),
    releaseYear: Number(r.release_year),
    aliases: j<string[]>(typeof r.aliases === "string" ? r.aliases : JSON.stringify(r.aliases || []), []),
  }));
}

export async function fxRates(): Promise<FxRate[]> {
  const rows = await query("SELECT base, quote, rate, as_of FROM fx_rates");
  return rows.map((r) => ({ base: String(r.base), quote: String(r.quote), rate: Number(r.rate), asOf: String(r.as_of) }));
}

export type RateRow = { base: string; quote: string; rate: number; asOf: string; source: string };

/** The rate that would be used for a pair on a date, queried from PostgreSQL. */
export async function rateInForce(base: string, quote: string, onDate: string): Promise<RateRow | null> {
  const r = await queryOne(
    `SELECT base, quote, rate, as_of, source FROM fx_rates
      WHERE base=$1 AND quote=$2
      ORDER BY ABS(EXTRACT(EPOCH FROM as_of::timestamp) - EXTRACT(EPOCH FROM $3::timestamp)) LIMIT 1`,
    [base, quote, onDate.slice(0, 10)]
  );
  return r ? { base: String(r.base), quote: String(r.quote), rate: Number(r.rate),
               asOf: String(r.as_of), source: String(r.source || "") } : null;
}

/** Record a real rate in PostgreSQL. Overwrites whatever was there for that date. */
export async function setRate(base: string, quote: string, rate: number, asOf: string, source: string): Promise<void> {
  await execute(
    `INSERT INTO fx_rates (base, quote, rate, as_of, source) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (base, quote, as_of) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source`,
    [base.toUpperCase(), quote.toUpperCase(), rate, asOf.slice(0, 10), source]
  );
}

async function marketPrices(deviceId: string, market: MarketCode): Promise<MarketPrice[]> {
  const rows = await query(
    "SELECT * FROM market_prices WHERE device_id=$1 AND market=$2 ORDER BY observed_at DESC",
    [deviceId, market]
  );
  return rows.map((r) => ({
    deviceId: String(r.device_id), market: String(r.market) as MarketCode,
    channel: String(r.channel) as Channel,
    condition: spanOf(String(r.cond_lo) as never, String(r.cond_hi) as never),
    price: money(Number(r.amount_minor), String(r.currency)),
    observedAt: String(r.observed_at), sampleSize: Number(r.sample_size),
    dispersionPct: r.dispersion_pct === null ? null : Number(r.dispersion_pct),
    source: String(r.source || ""),
  }));
}

/** The latest quote for each (programme, grade) in a market for one device. */
async function latestQuotes(deviceId: string, market: MarketCode) {
  return await query<{
    program_id: string; name: string; condition_label: string;
    amount_minor: number; currency: string; observed_at: string;
  }>(
    `SELECT DISTINCT ON (o.program_id, o.condition_label)
            o.program_id, p.name, o.condition_label, o.amount_minor, o.currency, o.observed_at
       FROM observations o
       JOIN programs p ON p.id = o.program_id
      WHERE o.device_id = $1 AND p.market = $2 AND o.amount_minor IS NOT NULL
      ORDER BY o.program_id, o.condition_label, o.observed_at DESC`,
    [deviceId, market]
  );
}

export type CompareGradeQuote = {
  conditionLabel: string;
  conditionSpan: ConditionSpan | null;
  quote: Money;
  observedAt: string;
  spread: Spread | null;
  refusal: string | null;
};

export type CompareRow = {
  programId: string; programName: string;
  quote: Money; conditionLabel: string; conditionSpan: ConditionSpan | null;
  observedAt: string;
  spread: Spread | null;
  refusal: string | null;
  grades: CompareGradeQuote[];
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

export async function compareDevice(deviceId: string, market: MarketCode, channel: Channel): Promise<CompareResult> {
  const rates = await fxRates();
  const prices = await marketPrices(deviceId, market);
  const forChannel = prices.find((p) => p.channel === channel) ?? null;
  const reportIn = MARKETS[market].currency;
  const targetSpan = forChannel?.condition ?? spanOf("flawless", "good");

  const rows: CompareRow[] = [];
  const allSpreads: Spread[] = [];

  const quotes = await latestQuotes(deviceId, market);
  const byProgram = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const list = byProgram.get(q.program_id) || [];
    list.push(q);
    byProgram.set(q.program_id, list);
  }

  for (const [programId, progQuotes] of byProgram.entries()) {
    const programName = progQuotes[0].name;
    const ladderRow = await queryOne<{ rungs?: string }>("SELECT rungs FROM ladders WHERE program_id=$1", [programId]);
    const rungs = j<LadderRung[]>(
      typeof ladderRow?.rungs === "string" ? ladderRow.rungs : JSON.stringify(ladderRow?.rungs || []),
      []
    );

    const evaluatedGrades: Array<CompareGradeQuote & { cmpScore: number }> = progQuotes.map((q) => {
      const span = mapCondition({ programId, rungs }, q.condition_label);
      const quote = money(Number(q.amount_minor), q.currency);
      let spread: Spread | null = null;
      let refusal: string | null = null;
      let cmpScore = 0;

      if (!span) {
        refusal = `"${q.condition_label}" is not on this programme's ladder`;
      } else {
        const cmp = comparability(span, targetSpan);
        if (cmp === "exact") cmpScore = 3;
        else if (cmp === "approximate") cmpScore = 2;
        else cmpScore = 1;

        if (!forChannel) {
          refusal = `no ${channel} market price for this device in ${MARKETS[market].name}`;
        } else {
          const r = computeSpread({
            programId, deviceId, market,
            tradeIn: { price: quote, condition: span, observedAt: q.observed_at },
            marketPrice: forChannel, reportIn, rates,
          });
          if (r.ok) spread = r.spread;
          else refusal = r.why;
        }
      }

      return {
        conditionLabel: q.condition_label,
        conditionSpan: span,
        quote,
        observedAt: q.observed_at,
        spread,
        refusal,
        cmpScore,
      };
    });

    // Sort candidate grades: exact span match first, then overlapping span, then highest quote
    evaluatedGrades.sort((a, b) => {
      if (a.spread && !b.spread) return -1;
      if (!a.spread && b.spread) return 1;
      if (a.spread && b.spread && a.spread.confidence !== b.spread.confidence) {
        return a.spread.confidence === "firm" ? -1 : 1;
      }
      if (b.cmpScore !== a.cmpScore) return b.cmpScore - a.cmpScore;
      return b.quote.amountMinor - a.quote.amountMinor;
    });

    const primary = evaluatedGrades[0];
    if (primary.spread) {
      allSpreads.push(primary.spread);
    }

    rows.push({
      programId,
      programName,
      quote: primary.quote,
      conditionLabel: primary.conditionLabel,
      conditionSpan: primary.conditionSpan,
      observedAt: primary.observedAt,
      spread: primary.spread,
      refusal: primary.refusal,
      grades: evaluatedGrades
        .slice()
        .sort((a, b) => b.quote.amountMinor - a.quote.amountMinor)
        .map(({ cmpScore: _c, ...rest }) => rest),
    });
  }

  const everyChannel: Spread[] = [];
  for (const mp of prices) {
    for (const row of rows) {
      // Pick the best matching grade for this channel's market price condition
      let bestForMp: Spread | null = null;
      for (const g of row.grades) {
        if (!g.conditionSpan) continue;
        const r = computeSpread({
          programId: row.programId, deviceId, market,
          tradeIn: { price: g.quote, condition: g.conditionSpan, observedAt: g.observedAt },
          marketPrice: mp, reportIn, rates,
        });
        if (r.ok) {
          if (
            !bestForMp ||
            (r.spread.confidence === "firm" && bestForMp.confidence !== "firm") ||
            (r.spread.confidence === bestForMp.confidence && r.spread.grossPct > bestForMp.grossPct)
          ) {
            bestForMp = r.spread;
          }
        }
      }
      if (bestForMp) everyChannel.push(bestForMp);
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

export async function quarantineCount(): Promise<number> {
  const r = await queryOne<{ c: number }>("SELECT count(*) c FROM quarantine WHERE resolved_at IS NULL");
  return Number(r?.c || 0);
}

export type Coverage = {
  quotes: Array<{ market: MarketCode; programs: number; quotes: number }>;
  channels: Channel[];
  totalQuotes: number;
};

export async function coverageFor(deviceId: string, market: MarketCode): Promise<Coverage> {
  const quotes = await query<{ market: MarketCode; programs: number; quotes: number }>(
    `SELECT p.market, count(DISTINCT o.program_id) programs, count(*) quotes
       FROM observations o JOIN programs p ON p.id = o.program_id
      WHERE o.device_id = $1 AND o.amount_minor IS NOT NULL
      GROUP BY p.market ORDER BY quotes DESC`,
    [deviceId]
  );

  const channelsRows = await query<{ channel: Channel }>(
    "SELECT DISTINCT channel FROM market_prices WHERE device_id = $1 AND market = $2",
    [deviceId, market]
  );
  const channels = channelsRows.map((r) => r.channel);

  return {
    quotes: quotes.map((q) => ({ market: q.market, programs: Number(q.programs), quotes: Number(q.quotes) })),
    channels,
    totalQuotes: quotes.reduce((t, q) => t + Number(q.quotes), 0),
  };
}

export async function busiestDeviceId(): Promise<string | null> {
  const r = await queryOne<{ device_id: string }>(
    `SELECT device_id FROM observations
      WHERE amount_minor IS NOT NULL GROUP BY device_id ORDER BY count(*) DESC LIMIT 1`
  );
  return r?.device_id ?? null;
}

export async function busiestMarket(): Promise<MarketCode | null> {
  const r = await queryOne<{ market: MarketCode }>(
    `SELECT p.market FROM observations o JOIN programs p ON p.id = o.program_id
      WHERE o.amount_minor IS NOT NULL GROUP BY p.market ORDER BY count(*) DESC LIMIT 1`
  );
  return r?.market ?? null;
}
