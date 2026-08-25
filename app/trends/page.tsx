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
 * Week on week, for hand-entered prices only.
 *
 * Seeded figures are excluded outright — `weeklySeries` filters on
 * `entered_by != ''`. A trend line drawn through invented data is the single
 * most persuasive wrong thing this application could show, because a chart
 * carries far more authority than a table of the same numbers.
 */
export default async function Trends() {
  await requireSuperIQ("/priceiq/trends");
  seed();
  const rows = weeklySeries();
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
        <div className="panel mt-6 p-8 text-center">
          <div className="text-[15px] font-bold">No entries yet</div>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-[var(--muted)]">
            Record one price and this becomes a baseline. Record it again next week and it becomes
            a trend. Five programmes entered weekly is a real dataset inside a month.
          </p>
          <Link href={`${base}/entry`}
                className="mt-4 inline-block px-5 py-2.5 text-[12.5px] font-bold uppercase tracking-[.1em] text-white"
                style={{ background: "var(--text)" }}>
            Record the first price
          </Link>
        </div>
      ) : (
        <div className="panel mt-6 overflow-x-auto p-4">
          <table>
            <thead>
              <tr>
                <th>Device</th><th>Market</th><th>Channel</th>
                <th style={{ textAlign: "right" }}>Latest</th>
                <th style={{ textAlign: "right" }}>Move</th>
                <th>Basis</th><th>History</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const l = r.latest;
                const up = l && l.kind === "up";
                const down = l && l.kind === "down";
                return (
                  <tr key={`${r.deviceId}|${r.market}|${r.channel}`}>
                    <td className="font-semibold">{r.deviceLabel}</td>
                    <td>{MARKETS[r.market as MarketCode]?.name ?? r.market}</td>
                    <td>{CHANNEL_LABEL[r.channel as Channel] ?? r.channel}</td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {l ? `${l.currency} ${(l.amountMinor / 100).toLocaleString()}` : "—"}
                    </td>
                    <td className="mono font-bold" style={{ textAlign: "right",
                        color: up ? "var(--green-ink)" : down ? "var(--bad-ink)" : "var(--muted)" }}>
                      {l && l.pctChange !== null && l.kind !== "first"
                        ? `${l.pctChange > 0 ? "+" : ""}${l.pctChange}%` : "—"}
                    </td>
                    <td className="text-[12px] text-[var(--muted)]">
                      {l ? wowLabel(l) : "—"}
                      {l?.spansGap && (
                        <span className="ml-1.5 mono text-[10px] uppercase" style={{ color: "var(--amber-ink)" }}>
                          gap
                        </span>
                      )}
                      {r.thin && (
                        <span className="ml-1.5 mono text-[10px] uppercase" style={{ color: "var(--amber-ink)" }}
                              title={`fewer than ${MIN_CREDIBLE_SAMPLE} comparables in at least one week`}>
                          thin
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.points.slice(-8).map((p) => (
                          <span key={p.week}
                                className="mono border px-1.5 py-0.5 text-[10.5px]"
                                title={`${p.week} · ${p.currency} ${(p.amountMinor / 100).toLocaleString()} · ${wowLabel(p)}${p.entries > 1 ? ` · ${p.entries} entries` : ""}`}
                                style={{ borderColor: "var(--border)",
                                         color: p.kind === "up" ? "var(--green-ink)"
                                              : p.kind === "down" ? "var(--bad-ink)" : "var(--muted)" }}>
                            {p.week.slice(-3)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
