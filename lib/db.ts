import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Persistence. The schema follows the shapes in core/, never the other way
 * round — the domain was built and tested without a database precisely so the
 * storage layer could be a detail rather than the design.
 *
 * Three things are stored that a naive schema would throw away, and each is
 * load-bearing:
 *
 *   • Every observation, including CONFIRMATIONS. "Last change" is derived from
 *     the series, not stored as a field, so it can never drift from the data.
 *   • The FX rate that priced each conversion, with its date, so a number
 *     screenshotted last week can still be reproduced.
 *   • Quarantined rows, in full. They are the catalogue's to-do list.
 */

const g = globalThis as unknown as { __tm_db?: Database.Database };

function init(): Database.Database {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "tradein.db"));
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS programs (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      market        TEXT NOT NULL,          -- US | AE | IN
      kind          TEXT NOT NULL,
      public_url    TEXT NOT NULL DEFAULT '',
      cadence_hours INTEGER NOT NULL DEFAULT 48,
      -- Collection clearance. See core/collection.ts: an uncleared programme
      -- cannot run, and a cleared one with no recorded authority cannot either.
      cleared       INTEGER NOT NULL DEFAULT 0,
      authority     TEXT NOT NULL DEFAULT '',
      method        TEXT NOT NULL DEFAULT '',
      enabled       INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- The programme's own condition ladder, as JSON rungs. Stored per programme
    -- because it IS per programme — that is the whole point of core/condition.
    CREATE TABLE IF NOT EXISTS ladders (
      program_id TEXT PRIMARY KEY,
      rungs      TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,
      brand         TEXT NOT NULL,
      model         TEXT NOT NULL,
      storage_gb    INTEGER NOT NULL,
      release_year  INTEGER NOT NULL,
      aliases       TEXT NOT NULL DEFAULT '[]'
    );

    -- APPEND ONLY. Confirmations are kept: dropping them would make a flat
    -- price indistinguishable from an unpolled one.
    CREATE TABLE IF NOT EXISTS observations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id      TEXT NOT NULL,
      device_id       TEXT NOT NULL,
      condition_label TEXT NOT NULL,
      amount_minor    INTEGER,              -- NULL = delisted, NOT zero
      currency        TEXT NOT NULL DEFAULT '',
      observed_at     TEXT NOT NULL,
      run_id          TEXT NOT NULL DEFAULT '',
      source_url      TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_obs_key ON observations(program_id, device_id, condition_label, observed_at);
    CREATE INDEX IF NOT EXISTS idx_obs_device ON observations(device_id, observed_at);

    -- What the device SELLS for, per channel. The other half of every spread.
    CREATE TABLE IF NOT EXISTS market_prices (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id      TEXT NOT NULL,
      market         TEXT NOT NULL,
      channel        TEXT NOT NULL,
      cond_lo        TEXT NOT NULL,
      cond_hi        TEXT NOT NULL,
      amount_minor   INTEGER NOT NULL,
      currency       TEXT NOT NULL,
      observed_at    TEXT NOT NULL,
      sample_size    INTEGER NOT NULL DEFAULT 0,
      dispersion_pct REAL,
      source         TEXT NOT NULL DEFAULT '',
      entered_by     TEXT NOT NULL DEFAULT '',
      week           TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mp ON market_prices(device_id, market, channel, observed_at);
    CREATE INDEX IF NOT EXISTS idx_mp_week ON market_prices(device_id, market, channel, week);

    -- Rates are stored per DATE, never "latest", so a historical conversion is
    -- reproducible instead of being re-derived at today's rate.
    CREATE TABLE IF NOT EXISTS fx_rates (
      base  TEXT NOT NULL,
      quote TEXT NOT NULL,
      rate  REAL NOT NULL,
      as_of TEXT NOT NULL,
      PRIMARY KEY (base, quote, as_of)
    );

    -- Who entered a hand-typed price, and on whose authority.
    --
    -- Manual entry is a first-class collector (core/collection.ts), so its
    -- output needs the same provenance an automated one would carry. Without
    -- entered_by and source, a disputed number six weeks from now is
    -- unattributable — and a price nobody will stand behind is not evidence.
    CREATE TABLE IF NOT EXISTS entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL,              -- market_price | quote
      ref_id       INTEGER,                    -- row created in the target table
      entered_by   TEXT NOT NULL DEFAULT '',
      week         TEXT NOT NULL DEFAULT '',   -- ISO week the figure is FOR
      note         TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entries ON entries(kind, created_at);

    -- API keys. Only the SHA-256 is stored — see core/apikey.ts.
    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      hash        TEXT NOT NULL UNIQUE,
      display     TEXT NOT NULL DEFAULT '',
      scopes      TEXT NOT NULL DEFAULT '[]',
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_keys ON api_keys(hash);

    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      program_id  TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      status      TEXT NOT NULL DEFAULT 'running',
      captured    INTEGER NOT NULL DEFAULT 0,
      errors      INTEGER NOT NULL DEFAULT 0,
      quarantined INTEGER NOT NULL DEFAULT 0,
      note        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_runs ON runs(program_id, started_at);

    -- The catalogue's to-do list. Rows here are NOT failures of the scraper;
    -- they are prices we refused to guess at, kept whole so a human can fix the
    -- catalogue and replay them.
    CREATE TABLE IF NOT EXISTS quarantine (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id   TEXT NOT NULL,
      run_id       TEXT NOT NULL,
      reason       TEXT NOT NULL,
      why          TEXT NOT NULL DEFAULT '',
      device_text  TEXT NOT NULL DEFAULT '',
      condition_text TEXT NOT NULL DEFAULT '',
      price_major  REAL,
      currency     TEXT NOT NULL DEFAULT '',
      source_url   TEXT NOT NULL DEFAULT '',
      candidate_ids TEXT NOT NULL DEFAULT '[]',
      observed_at  TEXT NOT NULL,
      resolved_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_quar ON quarantine(program_id, resolved_at);
  `);

  migrate(db);
  return db;
}

/**
 * Columns added after a table first shipped.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so every column
 * added later is invisible to a database that already exists — and the symptom
 * is every page 500ing at once, which is exactly how this was found. New
 * columns go here as well as in the CREATE above.
 */
function migrate(db: Database.Database) {
  const need: Array<[string, string, string]> = [
    ["market_prices", "entered_by", "ALTER TABLE market_prices ADD COLUMN entered_by TEXT NOT NULL DEFAULT ''"],
    ["market_prices", "week", "ALTER TABLE market_prices ADD COLUMN week TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [table, column, stmt] of need) {
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    );
    if (!cols.has(column)) db.exec(stmt);
  }
}

export function db(): Database.Database {
  if (!g.__tm_db) g.__tm_db = init();
  return g.__tm_db;
}

export function j<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
