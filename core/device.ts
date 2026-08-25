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
  /**
   * RAM, where it is part of the device's identity. Optional, because for many
   * handsets it is not — Apple does not market it and does not price on it.
   *
   * IT IS NOT OPTIONAL IN INDIA. In a real 2,558-row exchange list, 404 model
   * and storage combinations shipped in more than one RAM size, and 370 of them
   * were priced DIFFERENTLY — an Honor 90 256GB is worth 9,029 at 8GB of RAM
   * and 9,538 at 12GB. Treating those as one device means one device with two
   * prices, and whichever arrived last would silently win.
   *
   * Undefined means "not a distinguishing feature for this device", NOT
   * "unknown" — see the matching rule in resolveDevice.
   */
  ramGb?: number;
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
  /* "dual" is NOT here. It reads as noise in "Dual SIM" but it is part of the
     model name in "Redmi 8A Dual", and dropping it made those two handsets
     indistinguishable. Keeping it costs nothing: a canonical model's tokens
     must all appear in the listing, and extra listing tokens are ignored, so
     "iPhone 15 Pro Max Dual SIM" still matches "iPhone 15 Pro Max". */
  "sim", "dualsim", "nano", "esim", "gsm", "cdma", "factory",
  "smartphone", "phone", "mobile", "handset", "device", "with", "and",
  "brand", "new", "condition", "grade", "model", "colour", "color",
]);

/**
 * Capacities that actually ship, used to read a UNIT-LESS number as storage.
 *
 * Plenty of programmes list "IPHONE 15 PRO MAX 512" with no GB anywhere, and
 * refusing to read that costs real matches. But a bare number is dangerous,
 * and this set was originally wrong in a way that shipped:
 *
 *   16 AND 32 WERE IN IT. "iPhone 16 Pro Max" then parsed as a 16GB device —
 *   the model number read as a capacity — so every iPhone 16 listing without
 *   explicit storage resolved to a variant that does not exist. Apple named a
 *   phone after a number that used to be a storage size, and the assumption
 *   that "no handset is NAMED 128 or 256" quietly stopped holding at the low
 *   end. Both are dropped: no current handset ships 16GB or 32GB, so nothing
 *   is lost, and iPhone 32 would break this again if it ever exists.
 *
 * The scan also takes the LAST capacity in the string rather than the first,
 * because storage trails the model name — "iPhone 16 Pro Max 512" must be a
 * 512, not whatever number appears earliest.
 */
const CAPACITIES = new Set([64, 128, 256, 512, 1024, 2048]);

/**
 * RAM from a "RAM/storage" pair — the FIRST figure of "(8 GB/256 GB)".
 *
 * Returns null when the string carries only one capacity, because a lone
 * "128 GB" is storage. RAM is only ever read from an explicit pair, so it can
 * never be confused with the storage it sits beside.
 */
export function parseRamGb(raw: string): number | null {
  const s = (raw || "").toLowerCase();
  const pair = /(\d+)\s*gb\s*[/|]\s*(\d+)\s*(gb|tb)\b/.exec(s);
  return pair ? parseInt(pair[1], 10) : null;
}

/** "512gb" / "512 gb" / "1tb" / a bare "512" → gigabytes. */
export function parseStorageGb(raw: string): number | null {
  const s = (raw || "").toLowerCase();
  const tb = /(\d+(?:\.\d+)?)\s*tb\b/.exec(s);
  if (tb) return Math.round(parseFloat(tb[1]) * 1024);
  /* RAM/STORAGE PAIRS. Indian price lists write "(4 GB/128 GB)" — RAM first,
     storage second — so taking the FIRST "N GB" match reads the RAM. Every row
     of a real 2,558-line exchange sheet resolved to 4GB, 8GB or 16GB devices
     that do not exist.

     Prefer a match that is a real storage capacity, and take the LAST such,
     because storage follows RAM in every listing shape seen. Falls back to the
     last match at all, so a single unqualified "N GB" still works. */
  const gbMatches = [...s.matchAll(/(\d+)\s*gb\b/g)].map((m) => parseInt(m[1], 10));
  if (gbMatches.length) {
    const capacities = gbMatches.filter((n) => CAPACITIES.has(n));
    return capacities.length ? capacities[capacities.length - 1] : gbMatches[gbMatches.length - 1];
  }

  // Unit-less fallback, capacity set only, LAST match wins — storage follows
  // the model name, so the trailing number is the candidate.
  let found: number | null = null;
  for (const m of s.matchAll(/\b(\d{2,4})\b/g)) {
    const n = parseInt(m[1], 10);
    if (CAPACITIES.has(n)) found = n;
  }
  return found;
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
    /* Strip a RAM/storage spec before anything else.
     *
     * "Google Pixel 10A (8 GB/256 GB)" otherwise contributes an "8" token from
     * its RAM, which then satisfies the model tokens of "Pixel 8A" — two
     * different handsets, matched because of a memory size. Capacity is read
     * separately by parseStorageGb and parseRamGb; it has no business
     * competing as a model token. */
    .replace(/\(?\s*\d+\s*gb\s*[/|]\s*\d+\s*(gb|tb)\s*\)?/g, " ")
    .replace(/[()[\]{},/|]/g, " ")
    .replace(/[–—]/g, "-")
    /* Network-generation suffixes are ONE token, not a digit and a letter.
     *
     * Splitting "5g" into "5" and "g" let the 5 satisfy a model number:
     * "iQOO Z10 5G" matched "iQOO Z5 5G" because Z5 needed a "5" and the
     * network suffix supplied one. Forty-one real rows, all the same shape.
     * The suffix is protected before the letter/digit split, then restored. */
    .replace(/\b([345])\s*g\b/g, "$1\u0000g")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\u0000/g, "")
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
  /* Every brand in the Indian exchange sheet, which is a far longer list than
     the three-market flagship view suggests: POCO, iQOO, Infinix and Tecno are
     high-volume there and were absent, so a quarter of a real price list
     resolved to "no known brand". Keys are lowercase tokens; values are the
     canonical spelling used in the catalogue. */
  const known: Record<string, string> = {
    apple: "Apple", iphone: "Apple", ipad: "Apple",
    samsung: "Samsung", galaxy: "Samsung",
    google: "Google", pixel: "Google",
    oneplus: "OnePlus", xiaomi: "Xiaomi", redmi: "Xiaomi", mi: "Xiaomi",
    poco: "POCO", iqoo: "iQOO",
    oppo: "OPPO", vivo: "Vivo", realme: "realme",
    motorola: "Motorola", moto: "Motorola",
    nothing: "Nothing", sony: "Sony", huawei: "Huawei", honor: "Honor",
    nokia: "Nokia", infinix: "Infinix", tecno: "Tecno",
    asus: "Asus", lenovo: "Lenovo", lg: "LG",
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

  let exact = top.filter((d) => d.storageGb === storage);

  /* RAM DISCRIMINATES ONLY WHEN BOTH SIDES DECLARE IT.
   *
   * A listing that names its RAM must not match a catalogue entry naming a
   * different one — that is two different products at two different prices.
   * But a catalogue entry with no RAM recorded is saying "RAM is not part of
   * this device's identity", not "unknown", so it stays eligible. */
  const ram = parseRamGb(raw);
  if (ram === null && exact.length > 1) {
    /* The listing says nothing about RAM. A RAM-AGNOSTIC entry is the general
     * device and is the right answer here; falling through to "ambiguous"
     * across every RAM variant would make an ordinary listing unresolvable
     * just because the catalogue also holds RAM-specific rows. If there is no
     * general entry, ambiguity is the honest outcome. */
    const agnostic = exact.filter((d) => d.ramGb === undefined);
    if (agnostic.length) exact = agnostic;
  }
  if (ram !== null && exact.length > 1) {
    /* An EXACT RAM match beats a RAM-agnostic entry.
     *
     * A catalogue can legitimately hold both "iPhone 15 256GB" (RAM not part of
     * its identity) and "iPhone 15 8GB/256GB" (enrolled from a source that
     * prices on RAM). Keeping both as candidates made 184 real rows ambiguous;
     * the specific entry is plainly the better answer when the listing names
     * its RAM. */
    const declared = exact.filter((d) => d.ramGb === ram);
    if (declared.length) exact = declared;
    else exact = exact.filter((d) => d.ramGb === undefined);
  }
  if (exact.length === 1) {
    return {
      status: "matched",
      device: exact[0],
      confidence: fits.length === 1 ? 0.97 : 0.9,
      why: `matched ${exact[0].model} ${storage}GB${exact[0].ramGb ? ` / ${exact[0].ramGb}GB RAM` : ""} on ${fits[0].covered} model tokens`,
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
