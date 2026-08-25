/**
 * DELIMITED TEXT — for pasting a spreadsheet in.
 *
 * Typing one price at a time does not scale past a handful. The realistic way
 * a week's numbers arrive is a block of cells copied out of Excel or Sheets,
 * which means TAB-separated text with the occasional quoted field — and CSV
 * when it comes from a file instead.
 *
 * Written by hand rather than pulled from a library because the failure modes
 * are specific and each one silently corrupts a price:
 *
 *   • A quoted field containing the delimiter: "1,299.00" is ONE value, and a
 *     naive split turns it into 1 and 299.00.
 *   • A doubled quote inside a quoted field ("" is a literal ") — the escape
 *     nobody remembers until a source note contains an inch mark.
 *   • CRLF from Windows, and a UTF-8 BOM from Excel, both of which attach
 *     themselves to the first header and stop it matching anything.
 *   • Ragged rows. A short row is a mistake worth reporting, not a reason to
 *     throw away the other forty.
 */

export type Delimiter = "," | "\t" | ";" | "|";

/** Guess the delimiter from the header line. Tabs win — that is a paste. */
export function sniffDelimiter(text: string): Delimiter {
  const line = (text || "").split(/\r?\n/)[0] || "";
  const counts: Array<[Delimiter, number]> = [
    ["\t", (line.match(/\t/g) || []).length],
    [",", (line.match(/,/g) || []).length],
    [";", (line.match(/;/g) || []).length],
    ["|", (line.match(/\|/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Split delimited text into rows of raw string cells. */
export function parseDelimited(text: string, delimiter?: Delimiter): string[][] {
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first
  // header name and nothing maps.
  const src = (text || "").replace(/^﻿/, "");
  const d = delimiter || sniffDelimiter(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === d) { row.push(field); field = ""; continue; }
    if (c === "\r") continue;                              // CRLF
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  // Whatever is buffered at EOF is a final field, unless nothing was buffered.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Map header names to known fields, tolerantly.
 *
 * People do not name columns the way a schema does. "Price", "price (USD)",
 * "Wholesale price" and "amount" all mean the same thing, and rejecting a paste
 * over a header name is the fastest way to make somebody go back to typing.
 */
export const FIELD_ALIASES: Record<string, string[]> = {
  device: ["device", "model", "handset", "phone", "item", "description", "product"],
  market: ["market", "country", "region", "geo"],
  channel: ["channel", "route", "outlet"],
  price: ["price", "amount", "value", "market price", "sell", "sale price", "rate"],
  currency: ["currency", "ccy", "cur"],
  comparables: ["comparables", "comps", "sample", "sample size", "n", "count", "units", "qty", "quantity"],
  scatter: ["scatter", "dispersion", "variance", "range", "spread pct", "±%", "std"],
  source: ["source", "origin", "basis", "from", "provenance"],
  note: ["note", "notes", "comment", "remark"],
};

function normHeader(h: string): string {
  return (h || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9±%]+/g, " ").trim();
}

export type HeaderMap = { index: Record<string, number>; unmapped: string[]; missing: string[] };

/** Required columns — everything else is optional or defaulted. */
export const REQUIRED_FIELDS = ["device", "price"];

export function mapHeaders(header: string[]): HeaderMap {
  const index: Record<string, number> = {};
  const unmapped: string[] = [];

  header.forEach((raw, i) => {
    const n = normHeader(raw);
    let hit: string | null = null;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((a) => a === n)) { hit = field; break; }
    }
    // Fall back to a loose contains-match, but ONLY for aliases long enough to
    // be meaningful. "n" is a legitimate exact header for a sample count and a
    // catastrophic substring: "Bin location" contains an n, and would have been
    // filed as a comparables column. Three characters is the floor.
    if (!hit) {
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (aliases.some((a) => a.length >= 3 && n.includes(a))) { hit = field; break; }
      }
    }
    if (hit && index[hit] === undefined) index[hit] = i;
    else if (!hit) unmapped.push(raw);
  });

  return { index, unmapped, missing: REQUIRED_FIELDS.filter((f) => index[f] === undefined) };
}

/** Read a number out of a spreadsheet cell: "$1,299.00" / "1 299,00" / "12%". */
export function parseNumber(cell: string): number | null {
  let s = (cell || "").trim();
  if (!s) return null;
  s = s.replace(/[^\d.,\-]/g, "");                 // drop currency marks, %, spaces
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // A lone comma is a decimal separator only if it looks like one.
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
