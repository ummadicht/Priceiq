import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { Pool, PoolClient } from "pg";

/**
 * Persistence layer for PriceIQ.
 *
 * Supports both PostgreSQL (targeting schema 'price_iq') and SQLite (for offline/standalone).
 * When running in production or when DATABASE_URL / PGHOST is provided, all queries target
 * PostgreSQL with search_path set to 'price_iq, public'.
 */

const g = globalThis as unknown as {
  __tm_db?: Database.Database;
  __tm_pg_pool?: Pool;
};

/**
 * Check whether PostgreSQL is enabled via environment variables.
 */
export function isPostgresEnabled(): boolean {
  return (
    process.env.USE_POSTGRES === "1" ||
    process.env.USE_POSTGRES === "true" ||
    !!process.env.DATABASE_URL ||
    !!process.env.PGHOST ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * Get or initialize the PostgreSQL connection pool.
 * Schema search_path is explicitly set to 'price_iq, public'.
 */
export function getPgPool(): Pool {
  if (!g.__tm_pg_pool) {
    const connectionString = process.env.DATABASE_URL;
    const schema = process.env.PGSCHEMA || "price_iq";

    if (connectionString) {
      g.__tm_pg_pool = new Pool({
        connectionString,
        options: `-c search_path=${schema},public`,
      });
    } else {
      g.__tm_pg_pool = new Pool({
        host: process.env.PGHOST || "127.0.0.1",
        port: Number(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE || "scrapingdb",
        user: process.env.PGUSER || "scraper_user",
        password: process.env.PGPASSWORD || "",
        options: `-c search_path=${schema},public`,
      });
    }

    g.__tm_pg_pool.on("error", (err) => {
      console.error("[PriceIQ PostgreSQL Pool Error]", err);
    });
  }
  return g.__tm_pg_pool;
}

/**
 * Convert standard SQLite query strings (? or @param) and functions into PostgreSQL format ($1, $2, ...).
 */
export function toPgSql(
  sql: string,
  params?: unknown[] | Record<string, unknown>
): { text: string; values: unknown[] } {
  let text = sql
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bAUTOINCREMENT\b/gi, "");

  const values: unknown[] = [];

  if (Array.isArray(params)) {
    let index = 1;
    text = text.replace(/\?/g, () => `$${index++}`);
    values.push(...params);
  } else if (params && typeof params === "object") {
    let index = 1;
    const nameMap = new Map<string, number>();
    text = text.replace(/@([a-zA-Z0-9_]+)/g, (_, name) => {
      if (!nameMap.has(name)) {
        nameMap.set(name, index++);
        values.push((params as Record<string, unknown>)[name]);
      }
      return `$${nameMap.get(name)}`;
    });
  }

  return { text, values };
}

/**
 * Async query for multiple rows.
 * Queries PostgreSQL if enabled, otherwise falls back to SQLite.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[] | Record<string, unknown>
): Promise<T[]> {
  if (isPostgresEnabled()) {
    try {
      const { text, values } = toPgSql(sql, params);
      const pool = getPgPool();
      const res = await pool.query(text, values);
      return res.rows as T[];
    } catch (err) {
      console.error("[PostgreSQL query error, falling back to SQLite if available]", err);
      if (!g.__tm_db) throw err;
    }
  }

  const stmt = db().prepare(sql);
  if (Array.isArray(params)) {
    return stmt.all(...params) as T[];
  } else if (params) {
    return stmt.all(params) as T[];
  }
  return stmt.all() as T[];
}

/**
 * Async query for a single row.
 * Queries PostgreSQL if enabled, otherwise falls back to SQLite.
 */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[] | Record<string, unknown>
): Promise<T | null> {
  if (isPostgresEnabled()) {
    try {
      const { text, values } = toPgSql(sql, params);
      const pool = getPgPool();
      const res = await pool.query(text, values);
      return ((res.rows[0] as T) || null);
    } catch (err) {
      console.error("[PostgreSQL queryOne error, falling back to SQLite if available]", err);
      if (!g.__tm_db) throw err;
    }
  }

  const stmt = db().prepare(sql);
  if (Array.isArray(params)) {
    return ((stmt.get(...params) as T) || null);
  } else if (params) {
    return ((stmt.get(params) as T) || null);
  }
  return ((stmt.get() as T) || null);
}

/**
 * Async execute for INSERT, UPDATE, DELETE.
 * Executes on PostgreSQL if enabled, otherwise falls back to SQLite.
 */
export async function execute(
  sql: string,
  params?: unknown[] | Record<string, unknown>
): Promise<{ rowCount: number }> {
  if (isPostgresEnabled()) {
    try {
      const { text, values } = toPgSql(sql, params);
      const pool = getPgPool();
      const res = await pool.query(text, values);
      return { rowCount: res.rowCount ?? 0 };
    } catch (err) {
      console.error("[PostgreSQL execute error, falling back to SQLite if available]", err);
      if (!g.__tm_db) throw err;
    }
  }

  const stmt = db().prepare(sql);
  let res: Database.RunResult;
  if (Array.isArray(params)) {
    res = stmt.run(...params);
  } else if (params) {
    res = stmt.run(params);
  } else {
    res = stmt.run();
  }
  return { rowCount: res.changes };
}

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
      cleared       INTEGER NOT NULL DEFAULT 0,
      authority     TEXT NOT NULL DEFAULT '',
      method        TEXT NOT NULL DEFAULT '',
      enabled       INTEGER NOT NULL DEFAULT 1,
      note          TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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

    CREATE TABLE IF NOT EXISTS fx_rates (
      base   TEXT NOT NULL,
      quote  TEXT NOT NULL,
      rate   REAL NOT NULL,
      as_of  TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (base, quote, as_of)
    );

    CREATE TABLE IF NOT EXISTS entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL,
      ref_id       INTEGER,
      entered_by   TEXT NOT NULL DEFAULT '',
      week         TEXT NOT NULL DEFAULT '',
      note         TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entries ON entries(kind, created_at);

    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id    TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      secret_hash  TEXT NOT NULL,
      scopes       TEXT NOT NULL DEFAULT '[]',
      created_by   TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at   TEXT
    );

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

function migrate(db: Database.Database) {
  const need: Array<[string, string, string]> = [
    ["market_prices", "entered_by", "ALTER TABLE market_prices ADD COLUMN entered_by TEXT NOT NULL DEFAULT ''"],
    ["market_prices", "week", "ALTER TABLE market_prices ADD COLUMN week TEXT NOT NULL DEFAULT ''"],
    ["programs", "note", "ALTER TABLE programs ADD COLUMN note TEXT NOT NULL DEFAULT ''"],
    ["devices", "ram_gb", "ALTER TABLE devices ADD COLUMN ram_gb INTEGER"],
    ["fx_rates", "source", "ALTER TABLE fx_rates ADD COLUMN source TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [table, column, stmt] of need) {
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    );
    if (!cols.has(column)) db.exec(stmt);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_mp_week ON market_prices(device_id, market, channel, week)");
}

export function db(): Database.Database {
  if (!g.__tm_db) g.__tm_db = init();
  return g.__tm_db;
}

export function j<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
