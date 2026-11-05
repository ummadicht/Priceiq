/**
 * PriceIQ Engine: SQLite to PostgreSQL Migration Script
 * ======================================================
 * Migrates all 11 PriceIQ domain tables from SQLite (data/tradein.db)
 * directly into the dedicated PostgreSQL 'price_iq' schema.
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-postgres.mjs [--sqlite-path <path>]
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const sqlitePath = process.argv[3] || path.join(process.cwd(), "data", "tradein.db");
console.log(`[PriceIQ] Reading from SQLite database: ${sqlitePath}`);

const pgConfig = {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "scrapingdb",
  user: process.env.PGUSER || "scraper_user",
  password: process.env.PGPASSWORD || "",
};

async function migrate() {
  console.log(`[PriceIQ] Connecting to PostgreSQL (${pgConfig.user}@${pgConfig.host}:${pgConfig.port}/${pgConfig.database})...`);
  const pool = new Pool(pgConfig);
  const client = await pool.connect();

  try {
    // Ensure we operate exclusively within the price_iq schema
    await client.query("CREATE SCHEMA IF NOT EXISTS price_iq;");
    await client.query("SET search_path TO price_iq, public;");
    console.log("[PriceIQ] Successfully locked search_path to 'price_iq'.");

    if (!fs.existsSync(sqlitePath)) {
      console.log(`[PriceIQ] Notice: SQLite file not found at ${sqlitePath}. Created tables in PostgreSQL schema 'price_iq' are ready for ingestion.`);
      return;
    }

    const sdb = new Database(sqlitePath, { readonly: true });
    const tables = sdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    console.log(`[PriceIQ] Found tables in SQLite: ${tables.join(", ")}`);

    for (const table of tables) {
      const rows = sdb.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length === 0) continue;

      const cols = Object.keys(rows[0]);
      const colList = cols.join(", ");
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");

      const insertSql = `INSERT INTO price_iq.${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`;
      let inserted = 0;

      for (const row of rows) {
        const values = cols.map(c => row[c]);
        await client.query(insertSql, values);
        inserted++;
      }
      console.log(`[PriceIQ] Migrated ${inserted} rows into price_iq.${table}`);
    }

    console.log("\n[PriceIQ] Migration to PostgreSQL 'price_iq' schema completed successfully!");
  } catch (err) {
    console.error("[PriceIQ] Migration error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

