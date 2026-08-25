import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { parseBulk, commitBulk, type BulkDefaults } from "@/lib/bulk.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * Bulk import. Accepts a pasted sheet or a JSON array; previews by default.
 *
 *   POST /priceiq/api/prices/bulk            → DRY RUN, writes nothing
 *   POST /priceiq/api/prices/bulk?commit=1   → writes the rows marked ok
 *
 * Body may be:
 *   text/csv | text/plain   raw CSV or TSV, header row required
 *   application/json        { text: "...", defaults: {...} }
 *                        or { rows: [{device, price, ...}], defaults: {...} }
 *
 * DRY RUN IS THE DEFAULT and `commit` is explicit, because an import is the
 * last moment anyone sees the whole batch before it becomes data. A caller who
 * wants to write must say so.
 */
export async function POST(req: NextRequest) {
  const commit = req.nextUrl.searchParams.get("commit") === "1";
  const auth = await authenticate(req, commit ? "write" : "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  seed();

  const ct = req.headers.get("content-type") || "";
  let text = "";
  let defaults: BulkDefaults = {};

  if (ct.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    defaults = (b.defaults as BulkDefaults) || {};
    if (typeof b.text === "string") {
      text = b.text;
    } else if (Array.isArray(b.rows)) {
      // A JSON array is turned back into a sheet so it takes exactly the same
      // path as a paste. One parser, one set of rules, one place to fix a bug.
      const rows = b.rows as Array<Record<string, unknown>>;
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      text = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    }
  } else {
    text = await req.text();
  }

  if (!text.trim()) {
    return NextResponse.json(
      { error: "no data — send CSV/TSV text, or JSON with `text` or `rows`" },
      { status: 400 }
    );
  }

  const report = parseBulk(text, defaults);
  if (report.fatal) return NextResponse.json({ error: report.fatal, report }, { status: 400 });

  if (!commit) {
    return NextResponse.json({
      dryRun: true,
      counts: report.counts,
      unmappedColumns: report.unmappedColumns,
      rows: report.rows,
      hint: report.counts.ok > 0
        ? `Re-send with ?commit=1 to write ${report.counts.ok} row${report.counts.ok === 1 ? "" : "s"}.`
        : "Nothing is importable yet — fix the rows below and try again.",
    });
  }

  const result = commitBulk(report, auth.actor.label);
  return NextResponse.json({ dryRun: false, ...result, counts: report.counts });
}
