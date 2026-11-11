import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { seed } from "@/lib/seed.ts";
import { ingestCashifyScraper } from "@/lib/cashifyIngest.ts";
import { getBuybackPricesByGrade, evaluateBuybackMargins, type RateCardItem } from "@/lib/buyback.ts";

export const dynamic = "force-dynamic";

/**
 * Buyback Prices by Grade & Live Margin API (SUP-15)
 *
 * Pulls the latest scraped rows from PostgreSQL scraper.cashify_buy_prices via
 * ingestCashifyScraper(), normalizes them into PriceIQ observations, and serves
 * grade-level buyback prices or evaluates partner rate-card margins.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const ingestSummary = await ingestCashifyScraper({ force });

  const deviceId = req.nextUrl.searchParams.get("deviceId") || undefined;
  const prices = await getBuybackPricesByGrade(deviceId);

  return NextResponse.json({
    program: "cashify-in",
    market: "IN",
    currency: "INR",
    count: prices.length,
    ingest: {
      runId: ingestSummary.runId,
      totalRowsScraped: ingestSummary.totalRowsScraped,
      observationsCaptured: ingestSummary.observationsCaptured,
      quarantinedCount: ingestSummary.quarantinedCount,
      matchRate: ingestSummary.matchRate,
    },
    prices,
  });
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();
  await ingestCashifyScraper();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rateCard = (Array.isArray(body.rateCard) ? body.rateCard : []) as RateCardItem[];

  if (rateCard.length === 0) {
    return NextResponse.json(
      {
        error: "Missing or empty 'rateCard' array. Provide items with { deviceId | modelText, grade, offeredPriceMajor }.",
      },
      { status: 400 }
    );
  }

  const partnerId = typeof body.partnerId === "string" ? body.partnerId : auth.actor.label;
  const report = await evaluateBuybackMargins(rateCard, partnerId);

  return NextResponse.json(report);
}
