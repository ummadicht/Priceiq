import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { parseBulk, commitBulk, type BulkDefaults } from "@/lib/bulk.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * Bulk import into PostgreSQL 'price_iq' schema. Accepts a pasted sheet or a JSON array.
 */
export async function POST(req: NextRequest) {
  const commit = req.nextUrl.searchParams.get("commit") === "1";
  const auth = await authenticate(req, commit ? "write" : "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const ct = req.headers.get("content-type") || "";
  let text = "";
  let defaults: BulkDefaults = {};

  if (ct.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    defaults = (b.defaults as BulkDefaults) || {};
    if (typeof b.text === "string") {
      text = b.text;
    } else if (Array.isArray(b.rows)) {
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

  const report = await parseBulk(text, defaults);
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

  const result = await commitBulk(report, auth.actor.label);
  return NextResponse.json({
    committed: true,
    written: result.written,
    skipped: result.skipped,
    failures: result.failures,
  });
}
