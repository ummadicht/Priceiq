import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { weeklySeries } from "@/lib/entry.ts";
import { wowLabel } from "@/core/week.ts";
import { CHANNEL_LABEL, MIN_CREDIBLE_SAMPLE } from "@/core/channel.ts";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import type { Channel } from "@/core/channel.ts";

export const dynamic = "force-dynamic";

/**
 * Week on week, for hand-entered prices only against PostgreSQL 'price_iq.market_prices'.
 */
export default async function Trends() {
  await requireSuperIQ("/priceiq/trends");
  await seed();
  const rows = await weeklySeries();
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

  return (
    <>
      <div className="editorial-rule mb-4 w-full max-w-[420px]" />
      <h1 className="text-[28px] font-extrabold tracking-[-.04em]">Week on week</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--muted)]">
        Only hand-entered prices appear here. The worked-example data is excluded — a trend line
        through invented numbers is the most persuasive wrong thing this app could draw.
      </p>

      {rows.length === 0 ? (
        <div className="card mt-6 p-6 text-[13px] text-[var(--muted)]">
          No hand-entered prices yet. Record prices for the same device across consecutive weeks to
          see movements here.
          <div className="mt-3">
            <Link href="/entry" className="btn btn-primary text-[12.5px]">
              Record a price →
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {rows.map((r) => {
            const m = MARKETS[r.market as MarketCode];
            return (
              <div key={`${r.deviceId}|${r.market}|${r.channel}`} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="mono text-[11px] text-[var(--muted)]">
                      {r.market} · {CHANNEL_LABEL[r.channel as Channel] || r.channel}
                    </span>
                    <h3 className="font-bold text-[15px]">{r.deviceLabel}</h3>
                  </div>
                  {r.latest && (
                    <div className="text-right">
                      <span className="mono text-[13px] font-bold">
                        {wowLabel(r.latest)}
                      </span>
                      <div className="mono text-[10.5px] text-[var(--muted)]">{r.latest.week}</div>
                    </div>
                  )}
                </div>
                {r.thin && (
                  <div className="mt-2 text-[11px] text-[var(--amber-ink)]">
                    Fewer than {MIN_CREDIBLE_SAMPLE} comparable sales — treat with caution.
                  </div>
                )}
                <div className="mt-3 flex gap-2 overflow-x-auto py-2">
                  {r.points.map((p) => (
                    <div key={p.week} className="rounded border border-[var(--border)] p-2 text-center min-w-[70px]">
                      <div className="mono text-[10px] text-[var(--muted)]">{p.week}</div>
                      <div className="mono text-[11.5px] font-semibold mt-0.5">
                        {m?.currency} {(p.amountMinor / 100).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
