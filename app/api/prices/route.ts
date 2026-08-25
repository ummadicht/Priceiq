import { NextRequest, NextResponse } from "next/server";
import { currentUserId, authDisabled } from "@/lib/superiqAuth.ts";
import { recordMarketPrice, weeklySeries, lastEntered } from "@/lib/entry.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * The write endpoint for hand-entered market prices.
 *
 * Same SuperIQ session as every page — an API that skips the guard is the
 * quickest way to publish a dashboard you thought was private. The signed-in
 * user id becomes the entry's provenance, so nobody can enter a price
 * anonymously or attribute one to somebody else: `enteredBy` is taken from the
 * session and the request body cannot override it.
 */
async function who(): Promise<string | null> {
  if (authDisabled()) return "dev";
  return currentUserId();
}

export async function POST(req: NextRequest) {
  const user = await who();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    enteredBy: user,
  });

  if (!r.ok) return NextResponse.json({ error: r.why }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id, week: r.week });
}

/** Read back: the last figure for a slot, or the whole week-on-week series. */
export async function GET(req: NextRequest) {
  const user = await who();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
