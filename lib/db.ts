import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Pool, type QueryResultRow } from "pg";

/**
 * Persistence Layer for PriceIQ.
 *
 * Connects to PostgreSQL ('price_iq' schema) when configured and reachable,
 * and seamlessly falls back to a local SQLite database (data/tradein.db) with
 * identical schema and query semantics when PostgreSQL is unavailable.
 */

const g = globalThis as unknown as {
  __priceiq_pg_pool?: Pool;
  __priceiq_pg_failed?: boolean;
  __priceiq_sqlite?: Database.Database;
};

function initSqlite(): Database.Database {
  if (g.__priceiq_sqlite) return g.__priceiq_sqlite;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, "tradein.db");
  const sdb = new Database(dbPath);
  sdb.pragma("journal_mode = WAL");

  sdb.exec(`
    CREATE TABLE IF NOT EXISTS programs (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      market        TEXT NOT NULL,
      kind          TEXT NOT NULL,
      public_url    TEXT NOT NULL DEFAULT '',
      cadence_hours INTEGER NOT NULL DEFAULT 48,
      cleared       INTEGER NOT NULL DEFAULT 0,
      authority     TEXT NOT NULL DEFAULT '',
      method        TEXT NOT NULL DEFAULT '',
      enabled       INTEGER NOT NULL DEFAULT 1,
      note          TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ladders (
      program_id TEXT PRIMARY KEY,
      rungs      TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,
      brand         TEXT NOT NULL,
      model         TEXT NOT NULL,
      storage_gb    INTEGER NOT NULL,
      ram_gb        INTEGER,
      release_year  INTEGER NOT NULL,
      aliases       TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_devices_brand_model ON devices(brand, model);

    CREATE TABLE IF NOT EXISTS observations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id      TEXT NOT NULL,
      device_id       TEXT NOT NULL,
      condition_label TEXT NOT NULL,
      amount_minor    INTEGER,
      currency        TEXT NOT NULL DEFAULT '',
      observed_at     TEXT NOT NULL,
      run_id          TEXT NOT NULL DEFAULT '',
      source_url      TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_obs_key ON observations(program_id, device_id, condition_label, observed_at);
    CREATE INDEX IF NOT EXISTS idx_obs_device ON observations(device_id, observed_at);

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

    CREATE TABLE IF NOT EXISTS fx_rates (
      base   TEXT NOT NULL,
      quote  TEXT NOT NULL,
      rate   REAL NOT NULL,
      as_of  TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (base, quote, as_of)
    );

    CREATE TABLE IF NOT EXISTS entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,
      ref_id     INTEGER,
      entered_by TEXT NOT NULL DEFAULT '',
      week       TEXT NOT NULL DEFAULT '',
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id    TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      secret_hash  TEXT NOT NULL,
      scopes       TEXT NOT NULL DEFAULT '[]',
      created_by   TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      revoked_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      hash         TEXT NOT NULL UNIQUE,
      display      TEXT NOT NULL DEFAULT '',
      scopes       TEXT NOT NULL DEFAULT '[]',
      created_by   TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      revoked_at   TEXT
    );

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

    CREATE TABLE IF NOT EXISTS quarantine (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id     TEXT NOT NULL,
      run_id         TEXT NOT NULL,
      reason         TEXT NOT NULL,
      why            TEXT NOT NULL DEFAULT '',
      device_text    TEXT NOT NULL DEFAULT '',
      condition_text TEXT NOT NULL DEFAULT '',
      price_major    REAL,
      currency       TEXT NOT NULL DEFAULT '',
      source_url     TEXT NOT NULL DEFAULT '',
      candidate_ids  TEXT NOT NULL DEFAULT '[]',
      observed_at    TEXT NOT NULL,
      resolved_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS cashify_buy_prices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      brand           TEXT,
      model           TEXT,
      model_series    TEXT,
      variant         TEXT,
      storage         TEXT,
      ram             TEXT,
      condition       TEXT,
      condition_grade TEXT,
      defects         TEXT,
      buyback_price   REAL,
      price           REAL,
      currency        TEXT DEFAULT 'INR',
      source_url      TEXT,
      scraped_at      TEXT
    );
  `);

  g.__priceiq_sqlite = sdb;
  return sdb;
}

function shouldAttemptPostgres(): boolean {
  if (g.__priceiq_pg_failed) return false;
  return Boolean(
    process.env.DATABASE_URL ||
    (process.env.PGHOST && process.env.PGHOST !== "127.0.0.1" && process.env.PGHOST !== "localhost") ||
    process.env.USE_POSTGRES === "1"
  );
}

export function getPool(): Pool {
  if (!g.__priceiq_pg_pool) {
    const connectionString = process.env.DATABASE_URL;
    const schema = process.env.PGSCHEMA || "price_iq";

    if (connectionString) {
      g.__priceiq_pg_pool = new Pool({
        connectionString,
        connectionTimeoutMillis: 2500,
        options: `-c search_path=${schema},public`,
      });
    } else {
      g.__priceiq_pg_pool = new Pool({
        host: process.env.PGHOST || "127.0.0.1",
        port: Number(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE || "scrapingdb",
        user: process.env.PGUSER || "scraper_user",
        password: process.env.PGPASSWORD || "",
        connectionTimeoutMillis: 2500,
        options: `-c search_path=${schema},public`,
      });
    }

    g.__priceiq_pg_pool.on("error", () => {
      g.__priceiq_pg_failed = true;
    });
  }
  return g.__priceiq_pg_pool;
}

function translateForSqlite(sql: string, params: unknown[]): {
  sqliteSql: string;
  sqliteParams: unknown[];
  distinctCols: string[] | null;
} {
  let s = sql.trim();

  if (/SELECT\s+current_schema\(\)\s+as\s+s/i.test(s)) {
    return {
      sqliteSql: "SELECT 'price_iq' AS s",
      sqliteParams: [],
      distinctCols: null,
    };
  }

  // Handle SELECT DISTINCT ON (col1, col2)
  let distinctCols: string[] | null = null;
  const distinctOnMatch = /^SELECT\s+DISTINCT\s+ON\s*\(([^)]+)\)\s*/i.exec(s);
  if (distinctOnMatch) {
    distinctCols = distinctOnMatch[1]
      .split(",")
      .map((c) => c.trim().replace(/^[a-zA-Z0-9_]+\./, ""));
    s = s.replace(/^SELECT\s+DISTINCT\s+ON\s*\([^)]+\)\s*/i, "SELECT ");
  }

  // Strip PostgreSQL schema qualifiers (price_iq., scraper., public.)
  s = s.replace(/\b(?:price_iq|scraper|public)\./gi, "");

  // Translate EXTRACT(EPOCH FROM as_of::timestamp)
  s = s.replace(
    /ABS\(\s*EXTRACT\(\s*EPOCH\s+FROM\s+as_of::timestamp\s*\)\s*-\s*EXTRACT\(\s*EPOCH\s+FROM\s+(\$\d+)::timestamp\s*\)\s*\)/gi,
    "ABS(julianday(as_of) - julianday($1))"
  );

  // Strip remaining ::type casts
  s = s.replace(/::[a-zA-Z_][a-zA-Z0-9_]*/g, "");

  // Strip NULLS LAST / NULLS FIRST for broad compatibility if needed
  s = s.replace(/\s+NULLS\s+(?:LAST|FIRST)\b/gi, "");

  // Map $1, $2, ... positional parameters in order of appearance
  const sqliteParams: unknown[] = [];
  const sqliteSql = s.replace(/\$(\d+)/g, (_, idxStr) => {
    const idx = Number(idxStr) - 1;
    const val = params[idx];
    if (val instanceof Date) {
      sqliteParams.push(val.toISOString());
    } else if (typeof val === "boolean") {
      sqliteParams.push(val ? 1 : 0);
    } else {
      sqliteParams.push(val ?? null);
    }
    return "?";
  });

  return { sqliteSql, sqliteParams, distinctCols };
}

function querySqlite<T extends QueryResultRow>(text: string, params: unknown[]): T[] {
  const sdb = initSqlite();
  const { sqliteSql, sqliteParams, distinctCols } = translateForSqlite(text, params);
  const stmt = sdb.prepare(sqliteSql);
  const rows = (stmt.reader ? stmt.all(...sqliteParams) : [stmt.run(...sqliteParams)]) as T[];

  if (!distinctCols || distinctCols.length === 0) {
    return rows;
  }

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const r of rows) {
    const key = distinctCols.map((col) => String((r as Record<string, unknown>)[col] ?? "")).join("|");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }
  return deduped;
}

function executeSqlite(text: string, params: unknown[]): { rowCount: number } {
  const sdb = initSqlite();
  const { sqliteSql, sqliteParams } = translateForSqlite(text, params);
  const info = sdb.prepare(sqliteSql).run(...sqliteParams);
  return { rowCount: info.changes ?? 0 };
}

/** Legacy synchronous helper for CLI scripts. */
export function db(): Database.Database {
  return initSqlite();
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  if (shouldAttemptPostgres()) {
    try {
      const pool = getPool();
      const res = await pool.query<T>(text, params);
      return res.rows;
    } catch {
      g.__priceiq_pg_failed = true;
    }
  }
  return querySqlite<T>(text, params);
}

export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function execute(
  text: string,
  params: unknown[] = []
): Promise<{ rowCount: number }> {
  if (shouldAttemptPostgres()) {
    try {
      const pool = getPool();
      const res = await pool.query(text, params);
      return { rowCount: res.rowCount ?? 0 };
    } catch {
      g.__priceiq_pg_failed = true;
    }
  }
  return executeSqlite(text, params);
}

export function j<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
