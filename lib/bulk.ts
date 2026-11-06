import { parseDelimited, mapHeaders, parseNumber, sniffDelimiter } from "../core/csv.ts";
import { resolveDevice, type CanonicalDevice } from "../core/device.ts";
import { MARKETS, type MarketCode } from "../core/markets.ts";
import { CHANNELS, type Channel } from "../core/channel.ts";
import { isoWeek } from "../core/week.ts";
import { listDevices } from "./repo.ts";
import { recordMarketPrice, validateEntry } from "./entry.ts";

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
  fatal: string | null;
};

export type BulkDefaults = {
  market?: MarketCode;
  channel?: Channel;
  currency?: string;
  source?: string;
};

/** Parse and resolve against PostgreSQL devices catalogue, without writing anything. */
export async function parseBulk(text: string, defaults: BulkDefaults = {}): Promise<BulkReport> {
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

  const rawDevices = await listDevices();
  const catalogue: CanonicalDevice[] = rawDevices.map((d) => ({
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

export async function commitBulk(report: BulkReport, enteredBy: string): Promise<CommitResult> {
  const failures: Array<{ line: number; why: string }> = [];
  let written = 0, skipped = 0;

  for (const row of report.rows) {
    if (row.status !== "ok") { skipped++; continue; }
    const r = await recordMarketPrice({
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
