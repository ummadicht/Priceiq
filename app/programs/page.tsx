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
  seed();
  const sp = await searchParams;
  const market = (sp.market as MarketCode) || undefined;
  const programs = listPrograms(market && MARKETS[market] ? market : undefined);

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

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {programs.map((p) => (
          <div key={p.id} className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-bold">{p.name}</div>
                <div className="mono mt-0.5 text-[11px] text-[var(--muted)]">
                  {p.id} · {p.kind} · every {p.cadenceHours}h
                </div>
              </div>
              <span
                className="mono shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={
                  p.cleared
                    ? { background: "var(--green-soft)", color: "var(--green-ink)" }
                    : { background: "color-mix(in srgb, var(--yellow) 14%, transparent)", color: "var(--amber-ink)" }
                }
                title={p.cleared ? p.authority : "Not cleared for collection — no authority recorded"}
              >
                {p.cleared ? "cleared" : "gated"}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 border-y border-[var(--border-soft)] py-2.5">
              <Cell label="Observations" value={p.priceCount.toLocaleString()} />
              <Cell label="Last change" value={p.lastChangeAgo} />
              <Cell
                label="Last run"
                value={p.lastRun ? `${p.lastRun.captured}/${p.lastRun.errors}` : "—"}
                sub={p.lastRun?.quarantined ? `${p.lastRun.quarantined} unmatched` : undefined}
              />
            </div>

            <div className="mt-2.5">
              <div className="label">Condition ladder</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {p.ladder.map((r) => (
                  <span
                    key={r.label}
                    className="border border-[var(--border)] px-1.5 py-0.5 text-[11px]"
                    title={`maps to ${describeSpan(r.span)}`}
                  >
                    {r.label}
                    <span className="ml-1 text-[var(--muted)]">{describeSpan(r.span)}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[12px]">
              <a href={p.publicUrl} target="_blank" rel="noreferrer" className="font-semibold text-[var(--brand)]">
                Public page ↗
              </a>
              <Link href={`/compare?market=${p.market}`} className="text-[var(--muted)]">
                Compare in {MARKETS[p.market].name} →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mono mt-0.5 text-[13.5px] font-bold">{value}</div>
      {sub && <div className="text-[10.5px]" style={{ color: "var(--amber-ink)" }}>{sub}</div>}
    </div>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link
      href={href}
      className="border px-2.5 py-1 text-[11.5px] font-semibold"
      style={on
        ? { borderColor: "var(--brand)", background: "var(--brand)", color: "#fff" }
        : { borderColor: "var(--border)", color: "var(--muted)" }}
    >
      {label}
    </Link>
  );
}
