import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { listDevices, quarantineCount } from "@/lib/repo.ts";
import { getBuybackPricesByGrade, type BuybackGradePrice } from "@/lib/buyback.ts";
import { brandsOf, skuLabel } from "@/core/search.ts";
import DevicePickerClient from "@/components/DevicePickerClient";
import SeedBanner from "../banner";

export const dynamic = "force-dynamic";

export default async function Devices() {
  await requireSuperIQ("/priceiq/devices");
  await seed();
  const devices = await listDevices();
  const quarantined = await quarantineCount();
  const cashifyPrices = await getBuybackPricesByGrade();
  const brands = brandsOf(devices);
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const withRam = devices.filter((d) => d.ramGb !== undefined).length;
  const withAliases = devices.filter((d) => d.aliases && d.aliases.length > 0).length;

  const pricesByDevice = new Map<string, BuybackGradePrice[]>();
  for (const cp of cashifyPrices) {
    const arr = pricesByDevice.get(cp.deviceId) || [];
    arr.push(cp);
    pricesByDevice.set(cp.deviceId, arr);
  }

  return (
    <>
      <SeedBanner />
      <div className="editorial-rule mb-4 w-full max-w-[420px]" />
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-.04em]">Device catalogue</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--muted)]">
            {devices.length.toLocaleString()} canonical devices across {brands.length} manufacturers —
            the list every programme&apos;s listing string is resolved against. Storage is part of the
            identity, and so is RAM on the {withRam.toLocaleString()} devices whose sources price it
            separately. {withAliases.toLocaleString()} devices carry mapped model aliases.
          </p>
        </div>
        <Link
          href="/quarantine"
          className="px-3.5 py-2 text-[12.5px] font-bold border border-[var(--border)] bg-[var(--card)] hover:border-[var(--brand)] transition-colors"
        >
          Quarantine Queue ({quarantined} awaiting resolution) →
        </Link>
      </div>

      <div className="mt-6">
        <DevicePickerClient
          base={base}
          current={null}
          path="/compare"
        />
      </div>

      <div className="panel mt-5 p-5">
        <div className="label">By manufacturer</div>
        <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {brands.map((b) => (
            <div key={b.brand} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-soft)] pb-1">
              <span className="text-[13px] font-semibold">{b.brand}</span>
              <span className="mono text-[12px] text-[var(--muted)]">{b.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel mt-6 p-5 overflow-x-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <div>
            <div className="label">Master Catalogue &amp; Cashify Scraper Coverage</div>
            <div className="text-[14px] font-bold mt-0.5">
              Canonical Handsets, Mapped Aliases &amp; Live Buyback Quotes by Grade
            </div>
          </div>
          <span className="mono text-[11.5px] text-[var(--muted)]">
            {pricesByDevice.size} of {devices.length} devices quoted in cashify_buy_prices
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Manufacturer &amp; Model</th>
              <th>SKU</th>
              <th>Year</th>
              <th>Mapped Aliases (Catalogue Coverage)</th>
              <th>Cashify India Buyback Grades (INR)</th>
              <th style={{ textAlign: "right" }}>Compare</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const devQuotes = pricesByDevice.get(d.id) || [];
              return (
                <tr key={d.id}>
                  <td>
                    <div className="font-bold text-[13.5px] text-[var(--text)]">
                      {d.brand} {d.model}
                    </div>
                    <div className="mono text-[11px] text-[var(--muted)]">{d.id}</div>
                  </td>
                  <td className="mono text-[12px] font-semibold">{skuLabel(d)}</td>
                  <td className="mono text-[12px] text-[var(--muted)]">{d.releaseYear}</td>
                  <td>
                    {d.aliases && d.aliases.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {d.aliases.map((alias) => (
                          <span
                            key={alias}
                            className="mono px-1.5 py-0.5 text-[10.5px] border border-[var(--border)] bg-[var(--chip-bg)] rounded-[2px]"
                          >
                            {alias}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-[var(--muted)]">canonical only</span>
                    )}
                  </td>
                  <td>
                    {devQuotes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {devQuotes.map((q) => (
                          <span
                            key={q.conditionLabel}
                            className="mono px-2 py-0.5 text-[11px] rounded-[2px] border border-[var(--border)] bg-[var(--green-soft)] text-[var(--green-ink)] font-semibold"
                          >
                            {q.conditionLabel}: ₹{q.cashifyPriceMajor.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-[var(--muted)]">no scraped quote yet</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link
                      href={`/compare?device=${d.id}&market=${devQuotes.length > 0 ? "IN" : "US"}`}
                      className="text-[12px] font-semibold text-[var(--brand)] hover:underline"
                    >
                      Compare →
                    </Link>
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
