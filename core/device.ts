/**
 * DEVICE IDENTITY — the foundation the whole product stands on.
 *
 * A trade-in price is only interesting next to another trade-in price. "Apple
 * NZ pays NZD 890" means nothing on its own; it means something beside "Noel
 * Leeming pays NZD 890 and CellMyPhone pays NZD 824 for the same handset".
 *
 * Which makes device identity the load-bearing problem, because no two programs
 * name a phone the same way:
 *
 *     Apple NZ        "iPhone 15 Pro Max 512GB"
 *     a carrier       "Apple iPhone 15 Pro Max (512 GB) — Unlocked"
 *     a recycler      "IPHONE 15 PRO MAX 512"
 *     a marketplace   "iPhone15 Pro Max 1TB Dual SIM 5G"
 *
 * Get this wrong and every number downstream is wrong in a way that looks
 * completely plausible: a chart comparing an iPhone 15 against an iPhone 15 Pro
 * Max renders beautifully and is worthless.
 *
 * THE RULE THAT MAKES THIS TRUSTWORTHY: never guess. A resolver that always
 * returns its best candidate will happily file a Pro Max under the base model,
 * and nobody finds out until a customer disputes a number. So this returns
 * THREE outcomes — matched, ambiguous, unresolved — and the ingest pipeline is
 * required to quarantine the last two rather than attach them to the nearest
 * device. An unmatched price is a small operational chore. A wrongly matched
 * price is a lie with a timestamp on it.
 */

export type CanonicalDevice = {
  /** Stable slug, e.g. "apple-iphone-15-pro-max-512". */
  id: string;
  brand: string;
  /** Marketing model name without storage, e.g. "iPhone 15 Pro Max". */
  model: string;
  storageGb: number;
  releaseYear: number;
  /** Model numbers and known alternate spellings, e.g. "A2849", "SM-S918B". */
  aliases: string[];
};

export type Resolution =
  | { status: "matched"; device: CanonicalDevice; confidence: number; why: string }
  | { status: "ambiguous"; candidates: CanonicalDevice[]; why: string }
  | { status: "unresolved"; why: string };

/**
 * Words that appear in listings and carry no identity.
 *
 * "5g" is NOT here on purpose: it distinguishes real handsets (the iPhone 12
 * had no non-5G sibling, but plenty of Android families shipped both), and
 * stripping it would quietly merge two different devices.
 */
const NOISE = new Set([
  "unlocked", "refurbished", "refurb", "renewed", "preowned", "pre-owned", "used",
  "dual", "sim", "dualsim", "nano", "esim", "gsm", "cdma", "factory",
  "smartphone", "phone", "mobile", "handset", "device", "with", "and",
  "brand", "new", "condition", "grade", "model", "colour", "color",
]);

/**
 * Capacities that actually ship. Used to read a UNIT-LESS number as storage.
 *
 * Plenty of programs list "IPHONE 15 PRO MAX 512" with no GB anywhere, and
 * refusing to read that costs real matches. But a bare number is dangerous —
 * the 15 in "iPhone 15" is a model, not a capacity — so only numbers from this
 * set are eligible. No mainstream handset is NAMED 128, 256, 512 or 1024, which
 * is the assumption that makes this safe; the moment one is, it belongs in a
 * per-brand exclusion rather than being read as storage.
 */
const CAPACITIES = new Set([16, 32, 64, 128, 256, 512, 1024, 2048]);

/** "512gb" / "512 gb" / "1tb" / a bare "512" → gigabytes. */
export function parseStorageGb(raw: string): number | null {
  const s = (raw || "").toLowerCase();
  const tb = /(\d+(?:\.\d+)?)\s*tb\b/.exec(s);
  if (tb) return Math.round(parseFloat(tb[1]) * 1024);
  const gb = /(\d+)\s*gb\b/.exec(s);
  if (gb) return parseInt(gb[1], 10);

  // Unit-less fallback, capacity set only. Scans every number rather than just
  // the last, since "512 iPhone 15 Pro Max" is a listing shape too.
  for (const m of s.matchAll(/\b(\d{2,4})\b/g)) {
    const n = parseInt(m[1], 10);
    if (CAPACITIES.has(n)) return n;
  }
  return null;
}

/**
 * Reduce a listing string to comparable tokens.
 *
 * "iPhone15" → "iphone 15": vendors close the gap between name and number often
 * enough that not splitting it loses real matches.
 */
export function tokenise(raw: string): string[] {
  return (raw || "")
    .toLowerCase()
    .replace(/[()[\]{},/|]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9+\-. ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !NOISE.has(t))
    // Storage is extracted separately and must not also compete as a model token,
    // or "512" would score against the "512" in an unrelated model number.
    .filter((t) => !/^\d+(gb|tb)$/.test(t) && t !== "gb" && t !== "tb")
    // A bare capacity is storage, handled by parseStorageGb — it must not also
    // count as a model token, or "512" would score against a model number.
    .filter((t) => !(/^\d{2,4}$/.test(t) && CAPACITIES.has(parseInt(t, 10))));
}

function brandOf(tokens: string[]): string | null {
  const first = tokens[0] || "";
  const known: Record<string, string> = {
    apple: "Apple", iphone: "Apple", ipad: "Apple",
    samsung: "Samsung", galaxy: "Samsung",
    google: "Google", pixel: "Google",
    oneplus: "OnePlus", xiaomi: "Xiaomi", redmi: "Xiaomi", oppo: "OPPO",
    vivo: "Vivo", realme: "realme", motorola: "Motorola", moto: "Motorola",
    nothing: "Nothing", sony: "Sony", huawei: "Huawei",
  };
  for (const t of tokens) if (known[t]) return known[t];
  void first;
  return null;
}

/** Model tokens of a canonical device, in the same shape tokenise() produces. */
function deviceTokens(d: CanonicalDevice): string[] {
  return tokenise(`${d.brand} ${d.model}`);
}

/**
 * Resolve a listing string against the canonical catalogue.
 *
 * The scoring is deliberately unclever. Every token of the canonical model must
 * be present in the listing — that single requirement is what stops "iPhone 15"
 * matching an "iPhone 15 Pro Max" record, which is the classic and expensive
 * failure. Extra tokens in the listing are then the tie-breaker: between two
 * devices that both fit, the one that accounts for MORE of the listing wins, so
 * a listing saying "pro max" cannot settle for the plain model.
 */
export function resolveDevice(listing: string, catalogue: CanonicalDevice[]): Resolution {
  const raw = (listing || "").trim();
  if (!raw) return { status: "unresolved", why: "empty listing string" };

  const tokens = tokenise(raw);
  if (!tokens.length) return { status: "unresolved", why: "no usable tokens" };

  const storage = parseStorageGb(raw);
  const brand = brandOf(tokens);
  if (!brand) return { status: "unresolved", why: `no known brand in "${raw}"` };

  const tokenSet = new Set(tokens);

  // An alias (model number) is a direct hit and outranks token scoring: a
  // vendor that prints "A2849" has told us exactly which device it means.
  for (const d of catalogue) {
    for (const a of d.aliases) {
      const at = a.toLowerCase();
      if (tokenSet.has(at) || raw.toLowerCase().includes(at)) {
        if (storage !== null && d.storageGb !== storage) continue;
        return {
          status: "matched",
          device: d,
          confidence: 0.99,
          why: `alias "${a}" matched exactly`,
        };
      }
    }
  }

  type Scored = { d: CanonicalDevice; covered: number };
  const fits: Scored[] = [];

  for (const d of catalogue) {
    if (d.brand !== brand) continue;
    const need = deviceTokens(d).filter((t) => t !== brand.toLowerCase());
    // EVERY canonical token must appear. This is the whole guard.
    if (!need.every((t) => tokenSet.has(t))) continue;
    fits.push({ d, covered: need.length });
  }

  if (!fits.length) return { status: "unresolved", why: `no ${brand} model matches "${raw}"` };

  // Most specific first: the device accounting for the most of the listing.
  fits.sort((a, b) => b.covered - a.covered);
  const top = fits.filter((f) => f.covered === fits[0].covered).map((f) => f.d);

  if (storage === null) {
    // Storage genuinely changes the price, so a listing without it cannot be
    // resolved to one device. Reporting ambiguity beats inventing a variant.
    const uniqueModels = new Set(top.map((d) => d.model));
    return {
      status: "ambiguous",
      candidates: top,
      why:
        uniqueModels.size === 1
          ? `"${top[0].model}" matched but no storage in the listing`
          : `${uniqueModels.size} models fit and no storage given`,
    };
  }

  const exact = top.filter((d) => d.storageGb === storage);
  if (exact.length === 1) {
    return {
      status: "matched",
      device: exact[0],
      confidence: fits.length === 1 ? 0.97 : 0.9,
      why: `matched ${exact[0].model} ${storage}GB on ${fits[0].covered} model tokens`,
    };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", candidates: exact, why: "several devices share these tokens and storage" };
  }
  return {
    status: "unresolved",
    why: `${top[0].model} matched but ${storage}GB is not a known variant`,
  };
}
