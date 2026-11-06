import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { query, queryOne, j } from "@/lib/db.ts";
import { seed } from "@/lib/seed.ts";
import { fxRates, rateInForce } from "@/lib/repo.ts";
import { buildRows, toCsv, exportSummary, type ExportInput } from "@/core/export.ts";
import { money } from "@/core/money.ts";
import { skuLabel } from "@/core/search.ts";
import { mapCondition, describeSpan, type LadderRung } from "@/core/condition.ts";

export const dynamic = "force-dynamic";

/**
 * Export a programme's prices from PostgreSQL, in local currency AND USD.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const q = req.nextUrl.searchParams;
  const program = q.get("program");
  const market = q.get("market");
  const format = (q.get("format") || "csv").toLowerCase();
  const limit = Math.min(Number(q.get("limit")) || 50_000, 100_000);

  if (!program && !market) {
    return NextResponse.json({ error: "name a program or a market" }, { status: 400 });
  }

  const params: unknown[] = [];
  let where = "WHERE o.amount_minor IS NOT NULL";
  if (program) {
    params.push(program);
    where += ` AND o.program_id = $${params.length}`;
  }
  if (market) {
    params.push(market);
    where += ` AND p.market = $${params.length}`;
  }
  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const rows = await query<Record<string, unknown>>(
    `SELECT o.program_id, p.name AS program_name, p.market,
            o.device_id, d.brand, d.model, d.ram_gb, d.storage_gb,
            o.condition_label, o.amount_minor, o.currency, o.observed_at, o.run_id
       FROM observations o
       JOIN programs p ON p.id = o.program_id
       JOIN devices  d ON d.id = o.device_id
      ${where}
      ORDER BY d.brand, d.model, d.storage_gb, o.condition_label
      LIMIT ${limitPlaceholder}`,
    params
  );

  const ladders = new Map<string, LadderRung[]>();
  const ladderFor = async (id: string) => {
    if (!ladders.has(id)) {
      const r = await queryOne<{ rungs?: string }>("SELECT rungs FROM ladders WHERE program_id=$1", [id]);
      ladders.set(id, j<LadderRung[]>(typeof r?.rungs === "string" ? r.rungs : JSON.stringify(r?.rungs || []), []));
    }
    return ladders.get(id)!;
  };

  const items: ExportInput[] = [];
  for (const r of rows) {
    const pid = String(r.program_id);
    const ladder = await ladderFor(pid);
    const span = mapCondition({ programId: pid, rungs: ladder }, String(r.condition_label));
    const storageGb = Number(r.storage_gb);
    const ramGb = r.ram_gb === null || r.ram_gb === undefined ? undefined : Number(r.ram_gb);
    items.push({
      programId: pid,
      programName: String(r.program_name),
      market: String(r.market),
      deviceId: String(r.device_id),
      brand: String(r.brand),
      model: String(r.model),
      sku: skuLabel({ id: "", brand: "", model: "", storageGb, ramGb }),
      ramGb, storageGb,
      grade: String(r.condition_label),
      conditionSpan: span ? describeSpan(span) : "",
      price: money(Number(r.amount_minor), String(r.currency)),
      observedAt: String(r.observed_at),
      week: "",
      source: String(r.run_id),
    });
  }

  const rates = await fxRates();
  const built = buildRows(items, rates);

  if (format === "json") {
    const currencies = [...new Set(built.map((b) => b.localCurrency))];
    const rateSources = [];
    for (const c of currencies.filter((cur) => cur !== "USD")) {
      const rf = await rateInForce("USD", c, built[0]?.observedAt || new Date().toISOString());
      if (rf) rateSources.push(rf);
    }

    return NextResponse.json({
      summary: exportSummary(built),
      rateSources,
      rows: built,
    });
  }

  const name = `priceiq-${program || market}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(toCsv(built), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
