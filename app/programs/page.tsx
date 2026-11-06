import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { listPrograms } from "@/lib/repo.ts";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import { describeSpan } from "@/core/condition.ts";
import SeedBanner from "../banner";

export const dynamic = "force-dynamic";

export default async function Programs({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  await requireSuperIQ("/priceiq/programs");
  await seed();
  const sp = await searchParams;
  const market = (sp.market as MarketCode) || undefined;
  const programs = await listPrograms(market && MARKETS[market] ? market : undefined);

  return (
    <>
      <SeedBanner />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Programmes</h1>
          <p className="mt-1 text-[13.5px] text-[var(--muted)]">
            {programs.length} tracked. Each has its own condition ladder — which is why comparing them takes work.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Chip href="/programs" on={!market} label="All" />
          {(Object.keys(MARKETS) as MarketCode[]).map((c) => (
            <Chip key={c} href={`/programs?market=${c}`} on={market === c} label={MARKETS[c].name} />
          ))}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-[var(--border)] bg-[var(--chip-bg)] text-[11px] uppercase tracking-wider text-[var(--muted)] font-mono">
            <tr>
              <th className="py-2.5 px-4">Programme</th>
              <th className="py-2.5 px-4">Market</th>
              <th className="py-2.5 px-4">Kind</th>
              <th className="py-2.5 px-4">Ladder rungs</th>
              <th className="py-2.5 px-4">Clearance</th>
              <th className="py-2.5 px-4 text-right">Prices</th>
              <th className="py-2.5 px-4">Last change</th>
              <th className="py-2.5 px-4">Cadence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {programs.map((p) => {
              const m = MARKETS[p.market];
              return (
                <tr key={p.id} className="hover:bg-[var(--chip-bg)]/40 transition-colors">
                  <td className="py-3 px-4 font-semibold text-[var(--fg)]">
                    {p.publicUrl ? (
                      <a href={p.publicUrl} target="_blank" rel="noreferrer" className="hover:underline">
                        {p.name} <span className="text-[10px] text-[var(--muted)]">↗</span>
                      </a>
                    ) : (
                      p.name
                    )}
                    {p.note && <div className="text-[11px] text-[var(--muted)] font-normal">{p.note}</div>}
                  </td>
                  <td className="py-3 px-4 mono text-[12px]">
                    <span className="font-bold">{p.market}</span> · {m.currency}
                  </td>
                  <td className="py-3 px-4 capitalize text-[var(--muted)]">{p.kind}</td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {p.ladder.map((r) => (
                        <span
                          key={r.label}
                          className="mono rounded-[3px] border border-[var(--border)] bg-[var(--chip-bg)] px-1.5 py-0.5 text-[10.5px]"
                          title={describeSpan(r.span)}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {p.cleared ? (
                      <span className="mono rounded-[3px] bg-[var(--green-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--green-ink)]">
                        CLEARED {p.authority && `· ${p.authority}`}
                      </span>
                    ) : (
                      <span className="mono rounded-[3px] bg-[var(--yellow)]/30 px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--amber-ink)]">
                        GATED · needs clearance
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right mono font-semibold">{p.priceCount.toLocaleString()}</td>
                  <td className="py-3 px-4 text-[12px] text-[var(--muted)]">
                    {p.lastChangeAgo || "no changes yet"}
                  </td>
                  <td className="py-3 px-4 mono text-[11.5px] text-[var(--muted)]">
                    every {p.cadenceHours}h
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-[5px] px-3 py-1 text-[12.5px] font-medium transition-colors ${
        on
          ? "bg-[var(--fg)] text-[var(--bg)]"
          : "border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--fg)]"
      }`}
    >
      {label}
    </Link>
  );
}
