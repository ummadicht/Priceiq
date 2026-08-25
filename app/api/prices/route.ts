import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { recordMarketPrice, weeklySeries, lastEntered } from "@/lib/entry.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * Single-price read and write.
 *
 * Accepts either credential through the one gate in lib/apiAuth: a browser
 * session or a bearer key. The actor's label becomes the entry's provenance —
 * taken from the credential, never from the request body, so nothing can be
 * recorded anonymously or attributed to somebody else.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req, "write");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  seed();

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = recordMarketPrice({
    deviceId: String(b.deviceId || ""),
    market: String(b.market || ""),
    channel: String(b.channel || ""),
    amountMajor: Number(b.amountMajor),
    currency: String(b.currency || ""),
    sampleSize: Number(b.sampleSize),
    dispersionPct: b.dispersionPct === null || b.dispersionPct === undefined || b.dispersionPct === ""
      ? null
      : Number(b.dispersionPct),
    source: String(b.source || ""),
    observedAt: b.observedAt ? String(b.observedAt) : undefined,
    note: String(b.note || ""),
    // NEVER from the body.
    enteredBy: auth.actor.label,
  });

  if (!r.ok) return NextResponse.json({ error: r.why }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id, week: r.week });
}

/** Read back: the last figure for a slot, or the whole week-on-week series. */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  seed();

  const q = req.nextUrl.searchParams;
  const deviceId = q.get("deviceId"), market = q.get("market"), channel = q.get("channel");
  if (deviceId && market && channel) {
    return NextResponse.json({ last: lastEntered(deviceId, market, channel) ?? null });
  }
  return NextResponse.json({
    series: weeklySeries({ market: q.get("market") ?? undefined, channel: q.get("channel") ?? undefined }),
  });
}
