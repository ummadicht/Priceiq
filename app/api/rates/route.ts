import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { setRate, rateInForce } from "@/lib/repo.ts";
import { query } from "@/lib/db.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * Exchange rates against PostgreSQL 'price_iq.fx_rates'.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const q = req.nextUrl.searchParams;
  const base = q.get("base"), quote = q.get("quote");
  if (base && quote) {
    return NextResponse.json({
      rate: await rateInForce(base.toUpperCase(), quote.toUpperCase(), q.get("on") || new Date().toISOString()),
    });
  }
  const rows = await query<Record<string, unknown>>(
    `SELECT base, quote, rate, as_of, source FROM fx_rates
      ORDER BY as_of DESC, base, quote LIMIT 200`
  );
  return NextResponse.json({ rates: rows });
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, "write");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const base = String(b.base || "").toUpperCase();
  const quote = String(b.quote || "").toUpperCase();
  const rate = Number(b.rate);
  const asOf = String(b.asOf || new Date().toISOString()).slice(0, 10);
  const source = String(b.source || "").trim();

  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) {
    return NextResponse.json({ error: "base and quote must be 3-letter currency codes" }, { status: 400 });
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ error: "rate must be a positive number" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: "asOf must be a date, e.g. 2026-08-25" }, { status: 400 });
  }
  if (source.length < 3) {
    return NextResponse.json({ error: "say where the rate came from, e.g. 'xe.com mid-market'" }, { status: 400 });
  }

  await setRate(base, quote, rate, asOf, `${source} · recorded by ${auth.actor.label}`);
  return NextResponse.json({ ok: true, rate: await rateInForce(base, quote, asOf) });
}
