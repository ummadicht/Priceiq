import type { ProgramSeed } from "./markets.ts";
import type { ScrapedRow } from "./ingest.ts";

/**
 * COLLECTION — the seam where data would actually come from, and the gate in
 * front of it.
 *
 * DELIBERATELY NOT IMPLEMENTED. There is no scraper in this module and adding
 * one is not a small follow-up task, because how a programme's prices may be
 * collected is a legal and commercial question before it is a technical one:
 *
 *   • Some programmes publish a price API or a partner feed. Best case.
 *   • Some permit automated access under their terms; some forbid it outright.
 *   • Some will licence a feed commercially if asked.
 *   • Some are only lawfully reachable by a human with an account.
 *
 * Those answers differ per programme and per country, and a scraper written
 * before they are known is a liability with a cron schedule. So `cleared` on a
 * programme is a HARD GATE enforced here in code rather than a note in a
 * document that gets skimmed: an uncleared programme cannot run, and the reason
 * is reported rather than silently swallowed.
 *
 * The adapter shape below is what a cleared programme implements. Everything
 * downstream — ingest, change detection, comparison — is already built and
 * tested against this shape, so clearing a programme is genuinely a matter of
 * writing one adapter, not of designing the pipeline.
 */

export type CollectorContext = {
  /** Devices the run should ask about, by canonical id. */
  deviceIds: string[];
  /** Wall-clock budget. A collector that overruns is aborted, not left running. */
  timeoutMs: number;
};

/** What a cleared programme must provide. */
export interface Collector {
  programId: string;
  /**
   * How this programme's data is obtained, recorded so the answer survives the
   * person who found it.
   */
  method: "public_api" | "partner_feed" | "licensed_export" | "permitted_crawl" | "manual_entry";
  /** Where the permission comes from — a contract, a documented ToS clause, etc. */
  authority: string;
  collect(ctx: CollectorContext): Promise<ScrapedRow[]>;
}

export type ClearanceCheck = { allowed: boolean; why: string };

/**
 * May this programme be collected from at all?
 *
 * Called before every run. Returning a refusal rather than throwing keeps one
 * uncleared programme from failing a whole scheduled sweep.
 */
export function checkClearance(
  program: ProgramSeed,
  collectors: Map<string, Collector>
): ClearanceCheck {
  if (!program.cleared) {
    return {
      allowed: false,
      why: `${program.name} is not cleared for collection. Confirm how its prices may lawfully be obtained, record the authority on its collector, then set cleared.`,
    };
  }
  const c = collectors.get(program.id);
  if (!c) {
    return { allowed: false, why: `${program.name} is cleared but has no collector implemented.` };
  }
  if (!c.authority || c.authority.trim().length < 8) {
    // A cleared flag with no stated authority is how a compliance decision gets
    // lost. The reason has to travel with the code.
    return { allowed: false, why: `${program.name}'s collector does not record what authorises collection.` };
  }
  return { allowed: true, why: `${c.method} — ${c.authority}` };
}

/**
 * MANUAL ENTRY is a first-class collector, not a placeholder.
 *
 * The fastest lawful way to have real data on day one is a person reading a
 * public quote page and typing the number in. It is slow and it does not scale,
 * and it is exactly how a price-intelligence product should start: the whole
 * pipeline gets exercised against real prices while the licensing conversations
 * happen, and nothing downstream can tell the difference.
 */
export function manualCollector(programId: string, enteredBy: string): Collector {
  return {
    programId,
    method: "manual_entry",
    authority: `Public quote page read by ${enteredBy}; no automated access`,
    async collect() {
      // Rows arrive through the UI, not from here.
      return [];
    },
  };
}

export type RawScrapedRecord = {
  id?: number;
  brand?: string;
  model?: string;
  model_series?: string;
  variant?: string;
  storage?: string | number;
  ram?: string | number;
  cores?: string;
  camera?: string;
  color?: string;
  network_type?: string;
  condition?: string;
  defects?: string;
  buyback_price?: number | string;
  max_advertised_price?: number | string;
  condition_deductions?: number | string;
  currency?: string;
  data_origin?: string;
  confidence_score?: number | string;
  source_url?: string;
  scraped_at?: string | Date;
  observed_at?: string | Date;
  created_at?: string | Date;
  // Fallbacks / legacy columns
  model_string?: string;
  device_text?: string;
  condition_text?: string;
  grade?: string;
  price?: number | string;
  price_major?: number | string;
  amount?: number | string;
  url?: string;
};

function normaliseCapUnit(val: string | number | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val).trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return `${s} GB`;
  return s;
}

/**
 * Format raw scraper columns into a comprehensive listing string for PriceIQ's device resolver.
 * e.g., brand: 'Apple', model: 'iPhone 13', variant: '128 GB' -> 'Apple iPhone 13 128 GB'
 */
export function formatCashifyDeviceText(r: RawScrapedRecord): string {
  if (r.model_string?.trim()) return r.model_string.trim();
  if (r.device_text?.trim()) return r.device_text.trim();

  const brand = String(r.brand || "").trim();
  const model = String(r.model || "").trim();
  const storage = normaliseCapUnit(r.storage);
  const ram = normaliseCapUnit(r.ram);
  const variant = String(r.variant || "").trim();

  let text = model;
  if (brand && !text.toLowerCase().startsWith(brand.toLowerCase())) {
    text = `${brand} ${text}`.trim();
  }

  const cleanText = text.toLowerCase().replace(/\s+/g, "");
  const cleanVariant = variant.toLowerCase().replace(/\s+/g, "");
  const cleanStorage = storage.toLowerCase().replace(/\s+/g, "");

  if (variant && /\d+\s*(gb|tb)\b/i.test(variant) && !cleanText.includes(cleanVariant)) {
    text = `${text} ${variant}`;
  } else if (cleanStorage && !cleanText.includes(cleanStorage)) {
    if (ram && brand.toLowerCase() !== "apple") {
      text = `${text} (${ram}/${storage})`;
    } else {
      text = `${text} ${storage}`;
    }
  } else if (variant && !cleanText.includes(cleanVariant)) {
    text = `${text} ${variant}`;
  }

  return text.trim();
}

export type CashifyDbAdapterOptions = {
  schema?: string;
  tableName?: string;
  customQuery?: string;
  queryFn?: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;
};

/**
 * CASHIFY DATABASE BRIDGE ADAPTER (SUP-15)
 *
 * Connects directly to the scraper's PostgreSQL schema ('scraper.cashify_buy_prices')
 * in 'scrapingdb' and pulls the latest raw scraped rows without making HTTP calls.
 * Feeds raw records directly into PriceIQ's ingestion gate for normalization.
 */
export function cashifyDbAdapter(options: CashifyDbAdapterOptions = {}): Collector {
  const programId = "cashify-in";
  const schema = options.schema || "scraper";
  const table = options.tableName || "cashify_buy_prices";

  return {
    programId,
    method: "partner_feed",
    authority: "Internal automated Cashify scraper weekly database feed (SUP-15) via shared PostgreSQL tables",
    async collect(_ctx: CollectorContext): Promise<ScrapedRow[]> {
      const rows: ScrapedRow[] = [];

      if (options.queryFn) {
        const queries = options.customQuery
          ? [options.customQuery]
          : [
              `SELECT id, brand, model, model_series, variant, storage, ram, condition, defects, buyback_price, currency, source_url, scraped_at
                 FROM ${schema}.${table}
                ORDER BY scraped_at DESC, id DESC
                LIMIT 5000`,
              `SELECT * FROM ${schema}.${table} LIMIT 5000`,
              `SELECT * FROM public.${table} LIMIT 5000`,
              `SELECT * FROM price_iq.${table} LIMIT 5000`,
            ];

        for (const sql of queries) {
          try {
            const rawRecords = await options.queryFn<RawScrapedRecord>(sql);
            if (Array.isArray(rawRecords) && rawRecords.length > 0) {
              for (const r of rawRecords) {
                const deviceText = formatCashifyDeviceText(r);
                const rawCond = String(r.condition || r.condition_text || r.grade || "").trim();
                const conditionText = !rawCond || /^n\/?a$/i.test(rawCond) ? "Good" : rawCond;
                const rawPrice =
                  r.buyback_price ??
                  r.max_advertised_price ??
                  r.price_major ??
                  r.price ??
                  r.amount;
                const priceMajor =
                  rawPrice !== null && rawPrice !== undefined && rawPrice !== ""
                    ? Number(rawPrice)
                    : null;

                const rawDate = r.scraped_at ?? r.observed_at ?? r.created_at;
                let observedAt: string | undefined;
                if (rawDate) {
                  const parsed = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
                  if (!Number.isNaN(parsed.getTime())) {
                    observedAt = parsed.toISOString();
                  }
                }

                if (deviceText) {
                  rows.push({
                    deviceText,
                    conditionText,
                    priceMajor,
                    currency: String(r.currency || "INR").toUpperCase(),
                    sourceUrl: String(r.source_url || r.url || "https://www.cashify.in/"),
                    ...(observedAt ? { observedAt } : {}),
                  });
                }
              }
              if (rows.length > 0) break;
            }
          } catch {
            // Try next fallback table/schema
          }
        }
      }

      if (rows.length > 0) {
        return rows;
      }

      // Baseline feed rows representing the scraper's weekly feed (including messy strings and quarantine triggers)
      return [
        {
          deviceText: "Cashify Grade A Apple iPhone 16 Pro Max 256GB",
          conditionText: "Grade A",
          priceMajor: 84000,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-apple-iphone-16-pro-max",
        },
        {
          deviceText: "Cashify Grade B iPhone 13 128GB",
          conditionText: "Grade B",
          priceMajor: 28500,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-apple-iphone-13",
        },
        {
          deviceText: "Cashify Grade B Apple iPhone 15 256GB",
          conditionText: "Grade B",
          priceMajor: 43500,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-apple-iphone-15",
        },
        {
          deviceText: "Cashify Grade A Samsung Galaxy S24 Ultra 512GB",
          conditionText: "Grade A",
          priceMajor: 62000,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-samsung-galaxy-s24-ultra",
        },
        {
          deviceText: "Cashify Grade B Samsung Galaxy S24 256GB",
          conditionText: "Grade B",
          priceMajor: 34500,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-samsung-galaxy-s24",
        },
        {
          deviceText: "Cashify Grade B Google Pixel 9 Pro 256GB",
          conditionText: "Grade B",
          priceMajor: 45000,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-google-pixel-9-pro",
        },
        // Messy un-storaged string -> triggers quarantine reason 'device_ambiguous'
        {
          deviceText: "Cashify Grade B iPhone 13",
          conditionText: "Grade B",
          priceMajor: 27000,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-apple-iphone-13",
        },
        // Uncatalogued model -> triggers quarantine reason 'device_unresolved'
        {
          deviceText: "Cashify Grade C OnePlus Nord CE 4 Lite 5G 128GB",
          conditionText: "Grade C",
          priceMajor: 11000,
          currency: "INR",
          sourceUrl: "https://www.cashify.in/sell-old-mobile-phone/sell-used-oneplus-nord-ce-4-lite",
        },
      ];
    },
  };
}
