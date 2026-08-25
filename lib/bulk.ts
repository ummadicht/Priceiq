import { parseDelimited, mapHeaders, parseNumber, sniffDelimiter } from "../core/csv.ts";
import { resolveDevice, type CanonicalDevice } from "../core/device.ts";
import { MARKETS, type MarketCode } from "../core/markets.ts";
import { CHANNELS, type Channel } from "../core/channel.ts";
import { isoWeek } from "../core/week.ts";
import { listDevices } from "./repo.ts";
import { recordMarketPrice, validateEntry } from "./entry.ts";

/**
 * BULK IMPORT — a spreadsheet becomes prices, or explains why it did not.
 *
 * This is the ingest gate again, wearing different clothes. A pasted sheet says
 * "iPhone 16 Pro Max 512GB", not "apple-iphone-16-pro-max-512", so every row
 * goes through the same device resolver that automated collection would use —
 * and obeys the same rule: MATCHED, AMBIGUOUS or UNRESOLVED, never a nearest
 * guess. A bulk import is exactly where guessing does the most damage, because
 * nobody reads forty rows they did not have to correct.
 *
 * DRY RUN FIRST, ALWAYS. The endpoint previews by default and only writes when
 * asked. An import is the one moment where a person can still see the whole
 * batch before it becomes data.
 */

export type RowStatus = "ok" | "unresolved" | "ambiguous" | "invalid";

export type ParsedRow = {
  line: number;
  status: RowStatus;
  why: string;
  deviceText: string;
  deviceId?: string;
  deviceLabel?: string;
  candidates?: string[];
  market?: MarketCode;
  channel?: Channel;
  amountMajor?: number;
  currency?: string;
  sampleSize?: number;
  scatter?: number | null;
  source?: string;
  note?: string;
  week?: string;
};

export type BulkReport = {
  delimiter: string;
  headers: string[];
  unmappedColumns: string[];
  missingColumns: string[];
  rows: ParsedRow[];
  counts: Record<RowStatus, number>;
  /** True when nothing at all could be read — usually a header problem. */
  fatal: string | null;
};

export type BulkDefaults = {
  market?: MarketCode;
  channel?: Channel;
  currency?: string;
  source?: string;
};

/** Parse and resolve, without writing anything. */
export function parseBulk(text: string, defaults: BulkDefaults = {}): BulkReport {
  const delimiter = sniffDelimiter(text);
  const rows = parseDelimited(text, delimiter);
  const counts: Record<RowStatus, number> = { ok: 0, unresolved: 0, ambiguous: 0, invalid: 0 };

  if (rows.length < 2) {
    return {
      delimiter, headers: rows[0] ?? [], unmappedColumns: [], missingColumns: [],
      rows: [], counts,
      fatal: "Nothing to import — expected a header row and at least one data row.",
    };
  }

  const headers = rows[0].map((h) => h.trim());
  const map = mapHeaders(headers);
  if (map.missing.length) {
    return {
      delimiter, headers, unmappedColumns: map.unmapped, missingColumns: map.missing, rows: [], counts,
      fatal: `Missing required column${map.missing.length > 1 ? "s" : ""}: ${map.missing.join(", ")}. A device column and a price column are the minimum.`,
    };
  }

  const catalogue: CanonicalDevice[] = listDevices().map((d) => ({
    id: d.id, brand: d.brand, model: d.model, storageGb: d.storageGb,
    ramGb: d.ramGb, releaseYear: d.releaseYear, aliases: d.aliases,
  }));

  const cell = (r: string[], field: string) => {
    const i = map.index[field];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  const out: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const deviceText = cell(r, "device");
    const base: ParsedRow = { line, status: "invalid", why: "", deviceText };

    const marketRaw = (cell(r, "market") || defaults.market || "").toUpperCase();
    const market = (MARKETS[marketRaw as MarketCode] ? marketRaw : lookupMarket(marketRaw)) as MarketCode | "";
    const channelRaw = (cell(r, "channel") || defaults.channel || "").toLowerCase();
    const channel = CHANNELS.find((c) => c.id === channelRaw)?.id;

    const amount = parseNumber(cell(r, "price"));
    const currency = (cell(r, "currency") || defaults.currency || (market ? MARKETS[market].currency : "")).toUpperCase();
    const sample = parseNumber(cell(r, "comparables"));
    const scatterRaw = parseNumber(cell(r, "scatter"));
    const source = cell(r, "source") || defaults.source || "";
    const note = cell(r, "note");

    // Device first: an unresolvable device makes every other field moot, and
    // it is the failure a person most needs to see row by row.
    const res = resolveDevice(deviceText, catalogue);
    if (res.status === "unresolved") {
      out.push({ ...base, status: "unresolved", why: res.why });
      counts.unresolved++; continue;
    }
    if (res.status === "ambiguous") {
      out.push({ ...base, status: "ambiguous", why: res.why, candidates: res.candidates.map((c) => c.id) });
      counts.ambiguous++; continue;
    }

    const draft = {
      deviceId: res.device.id,
      market: market || "",
      channel: channel || "",
      amountMajor: amount ?? NaN,
      currency,
      sampleSize: sample === null ? NaN : Math.round(sample),
      dispersionPct: scatterRaw,
      source,
      enteredBy: "preview",
    };
    const bad = validateEntry(draft as Parameters<typeof validateEntry>[0]);
    if (bad) {
      out.push({ ...base, status: "invalid", why: bad, deviceId: res.device.id,
                 deviceLabel: `${res.device.brand} ${res.device.model} ${res.device.storageGb}GB` });
      counts.invalid++; continue;
    }

    out.push({
      ...base, status: "ok", why: "",
      deviceId: res.device.id,
      deviceLabel: `${res.device.brand} ${res.device.model} ${res.device.storageGb}GB`,
      market: market as MarketCode, channel: channel as Channel,
      amountMajor: amount!, currency, sampleSize: Math.round(sample!),
      scatter: scatterRaw, source, note,
      week: isoWeek(new Date())!.key,
    });
    counts.ok++;
  }

  return { delimiter, headers, unmappedColumns: map.unmapped, missingColumns: [], rows: out, counts, fatal: null };
}

/** Country names and codes people actually type. */
function lookupMarket(raw: string): MarketCode | "" {
  const s = raw.toLowerCase().trim();
  if (!s) return "";
  const table: Record<string, MarketCode> = {
    us: "US", usa: "US", "united states": "US", america: "US",
    ae: "AE", uae: "AE", dubai: "AE", "united arab emirates": "AE",
    in: "IN", ind: "IN", india: "IN",
  };
  return table[s] ?? "";
}

export type CommitResult = { written: number; skipped: number; failures: Array<{ line: number; why: string }> };

/**
 * Write the rows a dry run marked `ok`.
 *
 * Non-ok rows are SKIPPED, never coerced. Losing forty good rows over three
 * typos would be its own kind of wrong, so the batch proceeds — and the report
 * says exactly which lines did not land, so nothing disappears silently.
 */
export function commitBulk(report: BulkReport, enteredBy: string): CommitResult {
  const failures: Array<{ line: number; why: string }> = [];
  let written = 0, skipped = 0;

  for (const row of report.rows) {
    if (row.status !== "ok") { skipped++; continue; }
    const r = recordMarketPrice({
      deviceId: row.deviceId!, market: row.market!, channel: row.channel!,
      amountMajor: row.amountMajor!, currency: row.currency!,
      sampleSize: row.sampleSize!, dispersionPct: row.scatter ?? null,
      source: row.source!, note: row.note, enteredBy,
    });
    if (r.ok) written++;
    else { failures.push({ line: row.line, why: r.why }); skipped++; }
  }
  return { written, skipped, failures };
}
