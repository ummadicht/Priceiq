import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { listPrograms, listDevices, quarantineCount } from "@/lib/repo.ts";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import SeedBanner from "./banner";
import { SUITE_ENGINES, PRODUCT, SUITE } from "@/lib/brand.ts";

export const dynamic = "force-dynamic";

export default function Overview() {
  seed();
  const programs = listPrograms();
  const devices = listDevices();
  const quarantined = quarantineCount();
  const cleared = programs.filter((p) => p.cleared).length;

  return (
    <>
      <SeedBanner />
      <div className="editorial-rule mb-4 w-full max-w-[560px]" />
      <div className="label">{SUITE} · Price &amp; channel</div>
      <h1 className="mt-1.5 text-[34px] font-extrabold leading-[1.03] tracking-[-.045em]">
        Buy and sell against<br />live market data.
      </h1>
      <p className="mt-2.5 max-w-xl text-[14px] text-[var(--muted)]">
        {PRODUCT} watches what trade-in programmes pay, tracks what devices actually sell for by
        channel, and reports the spread between them — with the confidence that figure deserves.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Programmes tracked" value={String(programs.length)} note={`across ${Object.keys(MARKETS).length} markets`} />
        <Stat label="Devices in catalogue" value={String(devices.length)} note="canonical, storage-specific" />
        <Stat
          label="Cleared to collect"
          value={`${cleared} of ${programs.length}`}
          note={cleared === 0 ? "collection is gated until authority is recorded" : "collectors implemented"}
          tone={cleared === 0 ? "warn" : "good"}
        />
        <Stat
          label="Awaiting catalogue"
          value={String(quarantined)}
          note="rows refused rather than guessed"
          tone={quarantined > 0 ? "warn" : "good"}
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {(Object.keys(MARKETS) as MarketCode[]).map((code) => {
          const inMarket = programs.filter((p) => p.market === code);
          return (
            <div key={code} className="panel p-5">
              <div className="flex items-baseline justify-between">
                <div className="text-[15px] font-bold">{MARKETS[code].name}</div>
                <span className="mono text-[11px] text-[var(--muted)]">{MARKETS[code].currency}</span>
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                {inMarket.length} programmes · {inMarket.reduce((t, p) => t + p.priceCount, 0).toLocaleString()} observations
              </div>
              <ul className="mt-3 divide-y divide-[var(--border-soft)] border-t border-[var(--border-soft)]">
                {inMarket.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-1.5 text-[13px]">
                    <span className="truncate">{p.name}</span>
                    <span className="mono shrink-0 text-[11.5px] text-[var(--muted)]">{p.lastChangeAgo}</span>
                  </li>
                ))}
              </ul>
              <Link href={`/programs?market=${code}`} className="mt-3 inline-block text-[12.5px] font-semibold text-[var(--brand)]">
                All {MARKETS[code].name} programmes →
              </Link>
            </div>
          );
        })}
      </div>

      <div className="panel mt-8 p-5">
        <div className="label">The {SUITE} engines</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {SUITE_ENGINES.map((e) => (
            <div key={e.name} className="border-t-2 pt-2"
                 style={{ borderColor: e.self ? "var(--brand)" : "var(--border)" }}>
              <div className="text-[13px] font-bold"
                   style={{ color: e.self ? "var(--brand)" : "var(--text)" }}>
                {e.name}
              </div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--muted)]">{e.role}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel mt-4 p-5">
        <div className="label">How a number gets here</div>
        <ol className="mt-3 grid gap-2 text-[13px] text-[var(--muted)] sm:grid-cols-5">
          {[
            ["Collect", "only from a programme with recorded authority"],
            ["Resolve", "listing string → canonical device, or quarantine"],
            ["Map", "programme grade → a span of the canonical ladder"],
            ["Detect", "a re-poll at the same price is not a change"],
            ["Spread", "against market price per channel, with confidence"],
          ].map(([t, d], i) => (
            <li key={t} className="border-t-2 border-[var(--border)] pt-2">
              <div className="mono text-[10.5px] text-[var(--muted)]">0{i + 1}</div>
              <div className="text-[13px] font-bold text-[var(--text)]">{t}</div>
              <div className="mt-0.5 text-[12px] leading-snug">{d}</div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "warn" }) {
  const colour = tone === "warn" ? "var(--amber-ink)" : tone === "good" ? "var(--green-ink)" : "var(--text)";
  return (
    <div className="panel p-5">
      <div className="label">{label}</div>
      <div className="mono mt-1.5 text-[26px] font-extrabold" style={{ color: colour }}>{value}</div>
      <div className="mt-1 text-[12px] leading-snug text-[var(--muted)]">{note}</div>
    </div>
  );
}
