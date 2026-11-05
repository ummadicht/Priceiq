"""
Initialize all 11 PriceIQ tables in PostgreSQL (schema: price_iq)
================================================================
Converts and creates the native PriceIQ schema in PostgreSQL:
1. programs
2. ladders
3. devices
4. observations
5. market_prices
6. fx_rates
7. entries
8. oauth_clients
9. api_keys
10. runs
11. quarantine
"""

import sys
from pathlib import Path

# Import DB manager from Mobile Scraping
sys.path.insert(0, str(Path(r"D:\Mobile Scraping")))
import db

def provision_priceiq_schema():
    print("Connecting to PostgreSQL to provision all 11 PriceIQ tables in 'price_iq' schema...")
    db_mgr = db.DatabaseManager()
    
    with db_mgr.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS price_iq;")
            cur.execute("SET search_path TO price_iq, public;")

            cur.execute("""
            -- 1. programs
            CREATE TABLE IF NOT EXISTS price_iq.programs (
                id            VARCHAR(100) PRIMARY KEY,
                name          VARCHAR(255) NOT NULL,
                market        VARCHAR(10) NOT NULL,          -- US | AE | IN
                kind          VARCHAR(50) NOT NULL,
                public_url    TEXT NOT NULL DEFAULT '',
                cadence_hours INTEGER NOT NULL DEFAULT 48,
                cleared       INTEGER NOT NULL DEFAULT 0,
                authority     VARCHAR(255) NOT NULL DEFAULT '',
                method        VARCHAR(50) NOT NULL DEFAULT '',
                enabled       INTEGER NOT NULL DEFAULT 1,
                note          TEXT NOT NULL DEFAULT '',
                created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            -- 2. ladders
            CREATE TABLE IF NOT EXISTS price_iq.ladders (
                program_id VARCHAR(100) PRIMARY KEY,
                rungs      TEXT NOT NULL DEFAULT '[]'
            );

            -- 3. devices
            CREATE TABLE IF NOT EXISTS price_iq.devices (
                id            VARCHAR(150) PRIMARY KEY,
                brand         VARCHAR(100) NOT NULL,
                model         VARCHAR(255) NOT NULL,
                storage_gb    INTEGER NOT NULL,
                ram_gb        INTEGER,
                release_year  INTEGER NOT NULL,
                aliases       TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_devices_brand_model ON price_iq.devices(brand, model);

            -- 4. observations
            CREATE TABLE IF NOT EXISTS price_iq.observations (
                id              SERIAL PRIMARY KEY,
                program_id      VARCHAR(100) NOT NULL,
                device_id       VARCHAR(150) NOT NULL,
                condition_label VARCHAR(150) NOT NULL,
                amount_minor    BIGINT,
                currency        VARCHAR(10) NOT NULL DEFAULT '',
                observed_at     TIMESTAMP WITH TIME ZONE NOT NULL,
                run_id          VARCHAR(150) NOT NULL DEFAULT '',
                source_url      TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_obs_key ON price_iq.observations(program_id, device_id, condition_label, observed_at);
            CREATE INDEX IF NOT EXISTS idx_obs_device ON price_iq.observations(device_id, observed_at);

            -- 5. market_prices
            CREATE TABLE IF NOT EXISTS price_iq.market_prices (
                id             SERIAL PRIMARY KEY,
                device_id      VARCHAR(150) NOT NULL,
                market         VARCHAR(10) NOT NULL,
                channel        VARCHAR(50) NOT NULL,
                cond_lo        VARCHAR(50) NOT NULL,
                cond_hi        VARCHAR(50) NOT NULL,
                amount_minor   BIGINT NOT NULL,
                currency       VARCHAR(10) NOT NULL,
                observed_at    TIMESTAMP WITH TIME ZONE NOT NULL,
                sample_size    INTEGER NOT NULL DEFAULT 0,
                dispersion_pct DOUBLE PRECISION,
                source         VARCHAR(255) NOT NULL DEFAULT '',
                entered_by     VARCHAR(255) NOT NULL DEFAULT '',
                week           VARCHAR(20) NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_mp ON price_iq.market_prices(device_id, market, channel, observed_at);
            CREATE INDEX IF NOT EXISTS idx_mp_week ON price_iq.market_prices(device_id, market, channel, week);

            -- 6. fx_rates
            CREATE TABLE IF NOT EXISTS price_iq.fx_rates (
                base   VARCHAR(10) NOT NULL,
                quote  VARCHAR(10) NOT NULL,
                rate   DOUBLE PRECISION NOT NULL,
                as_of  VARCHAR(20) NOT NULL,
                source VARCHAR(255) NOT NULL DEFAULT '',
                PRIMARY KEY (base, quote, as_of)
            );

            -- 7. entries
            CREATE TABLE IF NOT EXISTS price_iq.entries (
                id           SERIAL PRIMARY KEY,
                kind         VARCHAR(50) NOT NULL,
                ref_id       INTEGER,
                entered_by   VARCHAR(255) NOT NULL DEFAULT '',
                week         VARCHAR(20) NOT NULL DEFAULT '',
                note         TEXT NOT NULL DEFAULT '',
                created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_entries ON price_iq.entries(kind, created_at);

            -- 8. oauth_clients
            CREATE TABLE IF NOT EXISTS price_iq.oauth_clients (
                client_id    VARCHAR(150) PRIMARY KEY,
                name         VARCHAR(255) NOT NULL DEFAULT '',
                secret_hash  TEXT NOT NULL,
                scopes       TEXT NOT NULL DEFAULT '[]',
                created_by   VARCHAR(255) NOT NULL DEFAULT '',
                created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP WITH TIME ZONE,
                revoked_at   TIMESTAMP WITH TIME ZONE
            );

            -- 9. api_keys
            CREATE TABLE IF NOT EXISTS price_iq.api_keys (
                id           VARCHAR(150) PRIMARY KEY,
                name         VARCHAR(255) NOT NULL DEFAULT '',
                hash         TEXT NOT NULL UNIQUE,
                display      VARCHAR(50) NOT NULL DEFAULT '',
                scopes       TEXT NOT NULL DEFAULT '[]',
                created_by   VARCHAR(255) NOT NULL DEFAULT '',
                created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP WITH TIME ZONE,
                revoked_at   TIMESTAMP WITH TIME ZONE
            );
            CREATE INDEX IF NOT EXISTS idx_keys ON price_iq.api_keys(hash);

            -- 10. runs
            CREATE TABLE IF NOT EXISTS price_iq.runs (
                id          VARCHAR(150) PRIMARY KEY,
                program_id  VARCHAR(100) NOT NULL,
                started_at  TIMESTAMP WITH TIME ZONE NOT NULL,
                finished_at TIMESTAMP WITH TIME ZONE,
                status      VARCHAR(50) NOT NULL DEFAULT 'running',
                captured    INTEGER NOT NULL DEFAULT 0,
                errors      INTEGER NOT NULL DEFAULT 0,
                quarantined INTEGER NOT NULL DEFAULT 0,
                note        TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_runs ON price_iq.runs(program_id, started_at);

            -- 11. quarantine
            CREATE TABLE IF NOT EXISTS price_iq.quarantine (
                id             SERIAL PRIMARY KEY,
                program_id     VARCHAR(100) NOT NULL,
                run_id         VARCHAR(150) NOT NULL,
                reason         VARCHAR(100) NOT NULL,
                why            TEXT NOT NULL DEFAULT '',
                device_text    TEXT NOT NULL DEFAULT '',
                condition_text VARCHAR(150) NOT NULL DEFAULT '',
                price_major    DOUBLE PRECISION,
                currency       VARCHAR(10) NOT NULL DEFAULT '',
                source_url     TEXT NOT NULL DEFAULT '',
                candidate_ids  TEXT NOT NULL DEFAULT '[]',
                observed_at    TIMESTAMP WITH TIME ZONE NOT NULL,
                resolved_at    TIMESTAMP WITH TIME ZONE
            );
            CREATE INDEX IF NOT EXISTS idx_quar ON price_iq.quarantine(program_id, resolved_at);
            """)

            conn.commit()

            cur.execute("""
                SELECT table_name FROM information_schema.tables 
                WHERE table_schema = 'price_iq'
                ORDER BY table_name;
            """)
            tables = [r[0] for r in cur.fetchall()]

    print(f"Successfully provisioned all {len(tables)} tables in 'price_iq' schema:")
    for t in tables:
        print(f"  - price_iq.{t}")

if __name__ == "__main__":
    provision_priceiq_schema()

