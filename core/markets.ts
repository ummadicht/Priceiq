/**
 * MARKETS AND PROGRAMS — scoped to the United States, the UAE and India.
 *
 * Three markets rather than forty, on purpose. Coverage is the easy axis to
 * grow and the expensive one to fake: forty half-working programs produce a
 * dashboard full of stale numbers, which is worse than nine that are right.
 * These three also happen to stress every part of the core —
 *
 *   USD  two decimals, mature carrier trade-in market, heavy promo pricing
 *   AED  two decimals, pegged to USD, retail-led rather than carrier-led
 *   INR  two decimals, but prices two orders of magnitude larger, and the most
 *        fragmented recycler market of the three
 *
 * — so the comparison layer is exercised properly before breadth is added.
 */

export type MarketCode = "US" | "AE" | "IN";

export type Market = {
  code: MarketCode;
  name: string;
  currency: string;
  /** IANA zone, used to schedule runs at a sensible local hour. */
  timezone: string;
  locale: string;
};

export const MARKETS: Record<MarketCode, Market> = {
  US: { code: "US", name: "United States", currency: "USD", timezone: "America/New_York", locale: "en-US" },
  AE: { code: "AE", name: "United Arab Emirates", currency: "AED", timezone: "Asia/Dubai", locale: "en-AE" },
  IN: { code: "IN", name: "India", currency: "INR", timezone: "Asia/Kolkata", locale: "en-IN" },
};

/** What kind of business is quoting, which predicts how it prices. */
export type ProgramKind =
  | "oem"          // the manufacturer's own programme
  | "carrier"      // a mobile network
  | "retailer"     // an electronics chain or marketplace
  | "recycler"     // buys to refurbish and resell
  | "marketplace"; // facilitates a sale rather than buying

export type ProgramSeed = {
  id: string;
  name: string;
  market: MarketCode;
  kind: ProgramKind;
  /** Public entry point a human would use. NOT a scraping target — see below. */
  publicUrl: string;
  /** Hours between runs. */
  cadenceHours: number;
  /**
   * Whether we have confirmed this programme exists AND that collecting from it
   * is permitted. Everything ships `false` until a human signs it off — see
   * collection.ts for why this is a hard gate rather than a note.
   */
  cleared: boolean;
};

/**
 * The initial target list.
 *
 * These are public, well-known trade-in programmes; listing them is ordinary
 * competitive research. Nothing here is collected from until it is cleared —
 * `cleared: false` on every row is the point, not an oversight.
 */
export const PROGRAM_SEEDS: ProgramSeed[] = [
  // ── United States ───────────────────────────────────────────────────────
  { id: "apple-us",      name: "Apple Trade In",        market: "US", kind: "oem",         publicUrl: "https://www.apple.com/shop/trade-in",       cadenceHours: 48, cleared: false },
  { id: "samsung-us",    name: "Samsung Trade-In",      market: "US", kind: "oem",         publicUrl: "https://www.samsung.com/us/trade-in/",      cadenceHours: 48, cleared: false },
  { id: "bestbuy-us",    name: "Best Buy Trade-In",     market: "US", kind: "retailer",    publicUrl: "https://www.bestbuy.com/trade-in",          cadenceHours: 48, cleared: false },
  { id: "amazon-us",     name: "Amazon Trade-In",       market: "US", kind: "retailer",    publicUrl: "https://www.amazon.com/tradein",            cadenceHours: 48, cleared: false },
  { id: "verizon-us",    name: "Verizon Trade-In",      market: "US", kind: "carrier",     publicUrl: "https://www.verizon.com/trade-in/",         cadenceHours: 24, cleared: false },
  { id: "tmobile-us",    name: "T-Mobile Trade-In",     market: "US", kind: "carrier",     publicUrl: "https://www.t-mobile.com/trade-in",         cadenceHours: 24, cleared: false },
  { id: "att-us",        name: "AT&T Trade-In",         market: "US", kind: "carrier",     publicUrl: "https://www.att.com/buy/trade-in/",         cadenceHours: 24, cleared: false },
  { id: "gazelle-us",    name: "Gazelle",               market: "US", kind: "recycler",    publicUrl: "https://www.gazelle.com/",                  cadenceHours: 48, cleared: false },
  { id: "decluttr-us",   name: "Decluttr",              market: "US", kind: "recycler",    publicUrl: "https://www.decluttr.com/sell-my-phone/",   cadenceHours: 48, cleared: false },
  { id: "backmarket-us", name: "Back Market Buyback",   market: "US", kind: "marketplace", publicUrl: "https://www.backmarket.com/en-us/buyback",  cadenceHours: 48, cleared: false },

  // ── United Arab Emirates ────────────────────────────────────────────────
  { id: "apple-ae",      name: "Apple Trade In UAE",    market: "AE", kind: "oem",         publicUrl: "https://www.apple.com/ae/shop/trade-in",    cadenceHours: 48, cleared: false },
  { id: "samsung-ae",    name: "Samsung Trade-In UAE",  market: "AE", kind: "oem",         publicUrl: "https://www.samsung.com/ae/",               cadenceHours: 48, cleared: false },
  { id: "sharafdg-ae",   name: "Sharaf DG Trade-In",    market: "AE", kind: "retailer",    publicUrl: "https://uae.sharafdg.com/",                 cadenceHours: 48, cleared: false },
  { id: "jumbo-ae",      name: "Jumbo Electronics",     market: "AE", kind: "retailer",    publicUrl: "https://www.jumbo.ae/",                     cadenceHours: 48, cleared: false },
  { id: "noon-ae",       name: "noon Trade-In",         market: "AE", kind: "retailer",    publicUrl: "https://www.noon.com/uae-en/",              cadenceHours: 48, cleared: false },
  { id: "cashify-ae",    name: "Cashify UAE",           market: "AE", kind: "recycler",    publicUrl: "https://www.cashify.ae/",                   cadenceHours: 48, cleared: false },
  { id: "etisalat-ae",   name: "e& Device Trade-In",    market: "AE", kind: "carrier",     publicUrl: "https://www.etisalat.ae/",                  cadenceHours: 48, cleared: false },

  // ── India ───────────────────────────────────────────────────────────────
  { id: "apple-in",      name: "Apple Trade In India",  market: "IN", kind: "oem",         publicUrl: "https://www.apple.com/in/shop/trade-in",    cadenceHours: 48, cleared: false },
  { id: "samsung-in",    name: "Samsung India Upgrade", market: "IN", kind: "oem",         publicUrl: "https://www.samsung.com/in/",               cadenceHours: 48, cleared: false },
  { id: "cashify-in",    name: "Cashify India",         market: "IN", kind: "recycler",    publicUrl: "https://www.cashify.in/",                   cadenceHours: 24, cleared: false },
  { id: "budli-in",      name: "Budli",                 market: "IN", kind: "recycler",    publicUrl: "https://www.budli.in/",                     cadenceHours: 48, cleared: false },
  { id: "instacash-in",  name: "InstaCash (MobiKwik)",  market: "IN", kind: "recycler",    publicUrl: "https://www.instacash.co.in/",              cadenceHours: 48, cleared: false },
  { id: "amazon-in",     name: "Amazon India Exchange", market: "IN", kind: "retailer",    publicUrl: "https://www.amazon.in/",                    cadenceHours: 48, cleared: false },
  { id: "flipkart-in",   name: "Flipkart Exchange",     market: "IN", kind: "retailer",    publicUrl: "https://www.flipkart.com/",                 cadenceHours: 48, cleared: false },
  { id: "croma-in",      name: "Croma Exchange",        market: "IN", kind: "retailer",    publicUrl: "https://www.croma.com/",                    cadenceHours: 48, cleared: false },
  { id: "reliance-in",   name: "Reliance Digital",      market: "IN", kind: "retailer",    publicUrl: "https://www.reliancedigital.in/",           cadenceHours: 48, cleared: false },
];

export function programsIn(market: MarketCode): ProgramSeed[] {
  return PROGRAM_SEEDS.filter((p) => p.market === market);
}

/** Currency pairs the comparison layer needs to cover these three markets. */
export const REQUIRED_PAIRS: Array<[string, string]> = [
  ["USD", "AED"],
  ["USD", "INR"],
  ["AED", "INR"],
];
