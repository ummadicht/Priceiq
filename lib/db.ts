import { Pool, type QueryResultRow } from "pg";

/**
 * PostgreSQL Persistence Layer for PriceIQ.
 *
 * Exclusively connects to PostgreSQL and targets the 'price_iq' schema.
 * Replaces SQLite entirely for all data access across API routes and server pages.
 */

const g = globalThis as unknown as {
  __priceiq_pg_pool?: Pool;
};

export function getPool(): Pool {
  if (!g.__priceiq_pg_pool) {
    const connectionString = process.env.DATABASE_URL;
    const schema = process.env.PGSCHEMA || "price_iq";

    if (connectionString) {
      g.__priceiq_pg_pool = new Pool({
        connectionString,
        options: `-c search_path=${schema},public`,
      });
    } else {
      g.__priceiq_pg_pool = new Pool({
        host: process.env.PGHOST || "127.0.0.1",
        port: Number(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE || "scrapingdb",
        user: process.env.PGUSER || "scraper_user",
        password: process.env.PGPASSWORD || "",
        options: `-c search_path=${schema},public`,
      });
    }

    g.__priceiq_pg_pool.on("error", (err) => {
      console.error("[PriceIQ PostgreSQL Pool Error]", err);
    });
  }
  return g.__priceiq_pg_pool;
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = getPool();
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const pool = getPool();
  const res = await pool.query<T>(text, params);
  return res.rows[0] ?? null;
}

export async function execute(
  text: string,
  params: unknown[] = []
): Promise<{ rowCount: number }> {
  const pool = getPool();
  const res = await pool.query(text, params);
  return { rowCount: res.rowCount ?? 0 };
}

export function j<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
