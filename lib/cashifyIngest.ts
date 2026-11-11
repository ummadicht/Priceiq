import { execute, query, queryOne } from "./db.ts";
import { listDevices } from "./repo.ts";
import { cashifyDbAdapter, type RawScrapedRecord } from "../core/collection.ts";
import { CASHIFY_INDIA_LADDER } from "../core/ladders/cashifyIndia.ts";
import { ingest, ingestHealth, type IngestResult, type IngestContext } from "../core/ingest.ts";
import { isoWeek } from "../core/week.ts";
import type { CanonicalDevice } from "../core/device.ts";

export interface CashifyIngestSummary {
  runId: string;
  totalRowsScraped: number;
  observationsCaptured: number;
  quarantinedCount: number;
  matchRate: number;
  health: ReturnType<typeof ingestHealth>;
  result: IngestResult;
}

/**
 * Fetch raw rows directly from the PostgreSQL scraper.cashify_buy_prices table
 * (or fallback tables) for diagnostics and transparency.
 */
export async function listRawCashifyPrices(limit = 100): Promise<RawScrapedRecord[]> {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const queries = [
    `SELECT brand, model, variant, ram, storage, condition_grade, price, currency, source_url, scraped_at
       FROM scraper.cashify_buy_prices
      ORDER BY scraped_at DESC NULLS LAST
      LIMIT ${safeLimit}`,
    `SELECT brand, model, variant, ram, storage, condition_grade, price, currency, source_url, scraped_at
       FROM cashify_buy_prices
      ORDER BY scraped_at DESC
      LIMIT ${safeLimit}`,
    `SELECT brand, model, variant, ram, storage, condition_grade, price, currency, source_url, scraped_at
       FROM price_iq.cashify_buy_prices
      ORDER BY scraped_at DESC NULLS LAST
      LIMIT ${safeLimit}`,
  ];

  for (const sql of queries) {
    try {
      const rows = await query<RawScrapedRecord & Record<string, unknown>>(sql);
      if (rows && rows.length > 0) return rows;
    } catch {
      // Try next schema candidate
    }
  }
  return [];
}

/**
 * THE CASHIFY INGESTION BRIDGE (SUP-15)
 *
 * Pulls raw scraped rows from PostgreSQL via cashifyDbAdapter, runs them through
 * PriceIQ's strict device and condition normalization gate (ingest.ts), safely
 * parks unrecognised or ambiguous rows into the quarantine queue, and records
 * clean buyback observations into the database.
 */
export async function ingestCashifyScraper(opts: { force?: boolean } = {}): Promise<CashifyIngestSummary> {
  const programId = "cashify-in";
  const observedAt = new Date().toISOString();
  const week = isoWeek(observedAt)?.key ?? "current";
  const runId = `cashify-in-scrape-${week}`;

  // 1. Load the canonical device catalogue
  const devices = await listDevices();
  const catalogue: CanonicalDevice[] = devices.map((d) => ({
    id: d.id,
    brand: d.brand,
    model: d.model,
    storageGb: d.storageGb,
    ramGb: d.ramGb,
    releaseYear: d.releaseYear,
    aliases: d.aliases,
  }));

  // 2. Fetch raw rows via the DB bridge adapter
  const collector = cashifyDbAdapter({
    queryFn: async <T>(sql: string, params?: unknown[]) => query<T & Record<string, unknown>>(sql, params),
  });

  const scrapedRows = await collector.collect({
    deviceIds: catalogue.map((d) => d.id),
    timeoutMs: 10000,
  });

  // 3. Process through PriceIQ's Ingestion Gate
  const ingestCtx: IngestContext = {
    programId,
    runId,
    observedAt,
    catalogue,
    ladder: CASHIFY_INDIA_LADDER,
  };

  const result = ingest(scrapedRows, ingestCtx);
  const health = ingestHealth(result);

  // Check if the database already has the exact same counts for this runId when force is not set
  if (!opts.force && scrapedRows.length > 0) {
    const existingObs = await queryOne<{ c: number }>(
      "SELECT count(*) c FROM observations WHERE program_id=$1 AND run_id=$2",
      [programId, runId]
    );
    const existingQuar = await queryOne<{ c: number }>(
      "SELECT count(*) c FROM quarantine WHERE program_id=$1 AND run_id=$2 AND resolved_at IS NULL",
      [programId, runId]
    );
    const obsCount = Number(existingObs?.c || 0);
    const quarCount = Number(existingQuar?.c || 0);

    if (obsCount === health.captured && obsCount > 0) {
      return {
        runId,
        totalRowsScraped: scrapedRows.length,
        observationsCaptured: obsCount,
        quarantinedCount: quarCount,
        matchRate: health.matchRate,
        health,
        result,
      };
    }
  }

  // If no scraped rows were returned from cashify_buy_prices, return current state without wiping
  if (scrapedRows.length === 0) {
    const existingObs = await queryOne<{ c: number }>(
      "SELECT count(*) c FROM observations WHERE program_id=$1",
      [programId]
    );
    const existingQuar = await queryOne<{ c: number }>(
      "SELECT count(*) c FROM quarantine WHERE program_id=$1 AND resolved_at IS NULL",
      [programId]
    );
    return {
      runId,
      totalRowsScraped: 0,
      observationsCaptured: Number(existingObs?.c || 0),
      quarantinedCount: Number(existingQuar?.c || 0),
      matchRate: health.matchRate,
      health,
      result,
    };
  }

  // 4. Record Run Header
  await execute(
    `INSERT INTO runs (id, program_id, started_at, finished_at, status, captured, errors, quarantined, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       finished_at = EXCLUDED.finished_at,
       status = EXCLUDED.status,
       captured = EXCLUDED.captured,
       quarantined = EXCLUDED.quarantined,
       note = EXCLUDED.note`,
    [
      runId,
      programId,
      observedAt,
      new Date().toISOString(),
      health.captured > 0 ? "succeeded" : "partial",
      health.captured,
      0,
      health.quarantined,
      `Automatic Cashify PostgreSQL Scraper Feed (SUP-15) · ${health.captured} captured, ${health.quarantined} quarantined`,
    ]
  );

  // 5. Replace observations for this runId (and remove stale seed-run-initial rows for cashify-in)
  await execute(
    "DELETE FROM observations WHERE program_id = $1 AND (run_id = $2 OR run_id = 'seed-run-initial')",
    [programId, runId]
  );

  for (const obs of result.observations) {
    if (obs.price) {
      await execute(
        `INSERT INTO observations (program_id, device_id, condition_label, amount_minor, currency, observed_at, run_id, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          obs.programId,
          obs.deviceId,
          obs.conditionLabel,
          obs.price.amountMinor,
          obs.price.currency,
          obs.observedAt,
          obs.runId,
          obs.sourceUrl,
        ]
      );
    }
  }

  // 6. Safely route unmatched / ambiguous rows to quarantine
  const resolvedRows = await query<{ device_text: string }>(
    "SELECT device_text FROM quarantine WHERE program_id = $1 AND resolved_at IS NOT NULL",
    [programId]
  );
  const resolvedDeviceTexts = new Set(
    resolvedRows.map((r) => String(r.device_text || "").trim().toLowerCase())
  );

  await execute(
    "DELETE FROM quarantine WHERE program_id = $1 AND (run_id = $2 OR run_id = 'seed-run-initial') AND resolved_at IS NULL",
    [programId, runId]
  );

  const seenQuarantineKeys = new Set<string>();
  let insertedQuarantine = 0;
  for (const q of result.quarantined) {
    const normDevText = q.row.deviceText.trim().toLowerCase();
    if (resolvedDeviceTexts.has(normDevText)) continue;
    const dedupKey = `${normDevText}|${q.row.conditionText.trim().toLowerCase()}`;
    if (seenQuarantineKeys.has(dedupKey)) continue;
    seenQuarantineKeys.add(dedupKey);

    await execute(
      `INSERT INTO quarantine (program_id, run_id, reason, why, device_text, condition_text, price_major, currency, source_url, candidate_ids, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        q.programId,
        q.runId,
        q.reason,
        q.why,
        q.row.deviceText,
        q.row.conditionText,
        q.row.priceMajor,
        q.row.currency,
        q.row.sourceUrl,
        JSON.stringify(q.candidateIds || []),
        q.observedAt,
      ]
    );
    insertedQuarantine++;
  }

  return {
    runId,
    totalRowsScraped: scrapedRows.length,
    observationsCaptured: health.captured,
    quarantinedCount: insertedQuarantine,
    matchRate: health.matchRate,
    health,
    result,
  };
}
