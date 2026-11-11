import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { listPrograms, listDevices, quarantineCount } from "@/lib/repo.ts";
import { getBuybackPricesByGrade } from "@/lib/buyback.ts";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import SeedBanner from "./banner";
import { SUITE_ENGINES, PRODUCT, SUITE } from "@/lib/brand.ts";

export const dynamic = "force-dynamic";

export default async function Overview() {
  await requireSuperIQ("/priceiq");
  await seed();
  const programs = await listPrograms();
  const devices = await listDevices();
  const quarantined = await quarantineCount();
  const cleared = programs.filter((p) => p.cleared).length;
  const cashifyPrices = await getBuybackPricesByGrade();

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
        <Stat
          href="/programs"
          label="Programmes tracked"
          value={String(programs.length)}
          note={`across ${Object.keys(MARKETS).length} markets`}
        />
        <Stat
          href="/devices"
          label="Devices in catalogue"
          value={String(devices.length)}
          note="canonical, storage-specific →"
        />
        <Stat
          href="/programs?market=IN"
          label="Cleared to collect"
          value={`${cleared} of ${programs.length}`}
          note={cleared === 0 ? "collection is gated until authority is recorded" : `${cashifyPrices.length} live Cashify grade quotes`}
          tone={cleared === 0 ? "warn" : "good"}
        />
        <Stat
          href="/quarantine"
          label="Awaiting catalogue"
          value={String(quarantined)}
          note="rows in quarantine queue →"
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

      {cashifyPrices.length > 0 && (
        <div className="panel mt-8 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="label">Automatic Weekly Feed (SUP-15) · scraper.cashify_buy_prices</div>
              <div className="mt-0.5 text-[15px] font-bold">
                Live Cashify India Buyback Observations ({cashifyPrices.length} grade quotes ingested)
              </div>
            </div>
            <div className="flex items-center gap-4 text-[12.5px] font-semibold">
              <Link href="/devices" className="text-[var(--brand)] hover:underline">
                View Device Catalogue →
              </Link>
              <Link href="/quarantine" className="text-[var(--brand)] hover:underline">
                Quarantine Queue ({quarantined}) →
              </Link>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Canonical Device</th>
                  <th>Storage</th>
                  <th>Scraped Condition</th>
                  <th>Canonical Span</th>
                  <th style={{ textAlign: "right" }}>Buyback Quote</th>
                  <th>Observed</th>
                </tr>
              </thead>
              <tbody>
                {cashifyPrices.slice(0, 10).map((cp) => (
                  <tr key={`${cp.deviceId}-${cp.conditionLabel}`}>
                    <td>
                      <Link
                        href={`/compare?device=${cp.deviceId}&market=IN`}
                        className="font-semibold text-[var(--text)] hover:text-[var(--brand)] hover:underline"
                      >
                        {cp.brand} {cp.model}
                      </Link>
                      <div className="mono text-[10.5px] text-[var(--muted)]">{cp.deviceId}</div>
                    </td>
                    <td className="mono text-[12px]">{cp.storageGb} GB</td>
                    <td className="font-medium">{cp.conditionLabel}</td>
                    <td className="mono text-[11.5px] text-[var(--muted)]">
                      {cp.conditionSpan ? `${cp.conditionSpan.lo}` : "—"}
                    </td>
                    <td className="mono font-bold" style={{ textAlign: "right", color: "var(--green-ink)" }}>
                      {cp.currency} {cp.cashifyPriceMajor.toLocaleString()}
                    </td>
                    <td className="mono text-[11px] text-[var(--muted)]">
                      {new Date(cp.observedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

function Stat({
  href,
  label,
  value,
  note,
  tone,
}: {
  href?: string;
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn";
}) {
  const colour = tone === "warn" ? "var(--amber-ink)" : tone === "good" ? "var(--green-ink)" : "var(--text)";
  const inner = (
    <div className="panel p-5 hover:border-[var(--brand)] transition-colors h-full">
      <div className="label">{label}</div>
      <div className="mono mt-1.5 text-[26px] font-extrabold" style={{ color: colour }}>{value}</div>
      <div className="mt-1 text-[12px] leading-snug text-[var(--muted)]">{note}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
