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
  /**
   * What is known about getting prices out of this one.
   *
   * Worth carrying because collection difficulty is wildly uneven and knowing
   * it in advance changes what you attempt first. A quote page that renders a
   * price from a URL is an afternoon; a marketplace exchange flow that only
   * reveals its offer inside a logged-in cart may never be automatable at all,
   * and is a manual-entry candidate from day one.
   */
  note?: string;
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

  // ── India ──────────────────────────────────────────────────────────────
  //
  // The most fragmented of the three markets by a wide margin, which is why it
  // was worth scoping to. The US is a handful of carriers and two OEMs; India
  // has OEM programmes, marketplace exchange flows, national electronics
  // chains, and a genuinely deep bench of independent recyclers all quoting the
  // same handset on the same day. That spread is the product's whole reason to
  // exist here — and it is also why the India list will keep growing.
  //
  // EVERY ENTRY BELOW STILL NEEDS VERIFYING. Some are certain; some are from
  // market knowledge that may be out of date, because Indian recyclers
  // consolidate and rebrand quickly (Yaantra was acquired; ReGlobe became
  // Cashify). Confirm the programme still runs and still quotes publicly before
  // clearing any of them.
  { id: "apple-in",      name: "Apple Trade In India",  market: "IN", kind: "oem",         publicUrl: "https://www.apple.com/in/shop/trade-in",    cadenceHours: 48, cleared: false },
  { id: "samsung-in",    name: "Samsung India Upgrade", market: "IN", kind: "oem",         publicUrl: "https://www.samsung.com/in/",               cadenceHours: 48, cleared: false },
  { id: "google-in",     name: "Google Store India",    market: "IN", kind: "oem",         publicUrl: "https://store.google.com/in/",              cadenceHours: 48, cleared: false },
  { id: "xiaomi-in",     name: "Mi/Xiaomi Exchange",    market: "IN", kind: "oem",         publicUrl: "https://www.mi.com/in/",                    cadenceHours: 48, cleared: false },
  { id: "oneplus-in",    name: "OnePlus Trade-In",      market: "IN", kind: "oem",         publicUrl: "https://www.oneplus.in/",                   cadenceHours: 48, cleared: false },
  { id: "vivo-in",       name: "vivo Trade-In",         market: "IN", kind: "oem",         publicUrl: "https://www.vivo.com/in",                   cadenceHours: 48, cleared: false },
  { id: "oppo-in",       name: "OPPO Trade-In",         market: "IN", kind: "oem",         publicUrl: "https://www.oppo.com/in/",                  cadenceHours: 48, cleared: false },
  { id: "realme-in",     name: "realme Trade-In",       market: "IN", kind: "oem",         publicUrl: "https://www.realme.com/in/",                cadenceHours: 48, cleared: false },

  { id: "cashify-in",    name: "Cashify India",         market: "IN", kind: "recycler",    publicUrl: "https://www.cashify.in/",                   cadenceHours: 24, cleared: false, note: "Quotes from a public flow; the most-referenced price in the market." },
  { id: "cashkr-in",     name: "Cashkr",                market: "IN", kind: "recycler",    publicUrl: "https://www.cashkr.com/",                   cadenceHours: 48, cleared: false },
  { id: "budli-in",      name: "Budli",                 market: "IN", kind: "recycler",    publicUrl: "https://www.budli.in/",                     cadenceHours: 48, cleared: false },
  { id: "instacash-in",  name: "InstaCash (MobiKwik)",  market: "IN", kind: "recycler",    publicUrl: "https://www.instacash.co.in/",              cadenceHours: 48, cleared: false },
  { id: "yaantra-in",    name: "Yaantra Phonecash",     market: "IN", kind: "recycler",    publicUrl: "https://www.yaantra.com/",                  cadenceHours: 48, cleared: false, note: "Acquired — confirm the programme still runs before clearing." },
  { id: "togofogo-in",   name: "Togofogo",              market: "IN", kind: "recycler",    publicUrl: "https://www.togofogo.com/",                 cadenceHours: 48, cleared: false },
  { id: "servify-in",    name: "Servify Trade-In",      market: "IN", kind: "recycler",    publicUrl: "https://www.servify.in/",                   cadenceHours: 48, cleared: false, note: "Powers several OEM programmes — its price may BE another programme's price. Check for double-counting." },

  { id: "amazon-in",     name: "Amazon India Exchange", market: "IN", kind: "retailer",    publicUrl: "https://www.amazon.in/",                    cadenceHours: 48, cleared: false, note: "Exchange offer only appears inside a signed-in cart. Manual entry is the realistic path." },
  { id: "flipkart-in",   name: "Flipkart Exchange",     market: "IN", kind: "retailer",    publicUrl: "https://www.flipkart.com/",                 cadenceHours: 48, cleared: false, note: "Same shape as Amazon — offer is revealed in the buy flow, not on a quote page." },
  { id: "croma-in",      name: "Croma Exchange",        market: "IN", kind: "retailer",    publicUrl: "https://www.croma.com/",                    cadenceHours: 48, cleared: false },
  { id: "reliance-in",   name: "Reliance Digital",      market: "IN", kind: "retailer",    publicUrl: "https://www.reliancedigital.in/",           cadenceHours: 48, cleared: false },
  { id: "istore-in",     name: "India iStore",          market: "IN", kind: "retailer",    publicUrl: "https://www.imagineonline.store/",          cadenceHours: 48, cleared: false, note: "Apple premium reseller; its trade-in usually mirrors Apple India's." },
  { id: "vijaysales-in", name: "Vijay Sales",           market: "IN", kind: "retailer",    publicUrl: "https://www.vijaysales.com/",               cadenceHours: 48, cleared: false },
  { id: "poorvika-in",   name: "Poorvika Mobiles",      market: "IN", kind: "retailer",    publicUrl: "https://www.poorvika.com/",                 cadenceHours: 48, cleared: false },
  { id: "sangeetha-in",  name: "Sangeetha Mobiles",     market: "IN", kind: "retailer",    publicUrl: "https://www.sangeethamobiles.com/",         cadenceHours: 48, cleared: false },
  { id: "tatacliq-in",   name: "Tata CLiQ Exchange",    market: "IN", kind: "retailer",    publicUrl: "https://www.tatacliq.com/",                 cadenceHours: 48, cleared: false },

  { id: "olx-in",        name: "OLX India",             market: "IN", kind: "marketplace", publicUrl: "https://www.olx.in/",                       cadenceHours: 48, cleared: false, note: "Peer-to-peer asking prices, NOT a trade-in quote. Different thing — treat as market signal, never as a programme offer." },
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
