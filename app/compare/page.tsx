import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { compareDevice, listDevices, coverageFor, busiestDeviceId, rateInForce } from "@/lib/repo.ts";
import { convert } from "@/core/money.ts";
import { fxRates } from "@/lib/repo.ts";
import { fullLabel, skuLabel } from "@/core/search.ts";
import DevicePickerClient from "@/components/DevicePickerClient";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import { CHANNELS, CHANNEL_LABEL, type Channel } from "@/core/channel.ts";
import { describeSpan } from "@/core/condition.ts";
import { formatMoney } from "@/core/money.ts";
import { formatGross } from "@/core/spread.ts";
import { since } from "@/core/observation.ts";
import SeedBanner from "../banner";

export const dynamic = "force-dynamic";

/**
 * The comparison view.
 *
 * Trade-in quotes on the left, one market price on the right, and the spread
 * between them — recomputed for whichever channel you pick, because the same
 * handset in the same condition is worth materially different money to a
 * consumer, a lot buyer and an auction.
 *
 * Two deliberate refusals to make things look tidier than they are:
 *   • Rows that cannot be compared stay, carrying their reason. A programme
 *     silently missing from the table is indistinguishable from one that does
 *     not quote the device, and those are very different facts.
 *   • Firm rows always sort above indicative ones, however big the indicative
 *     margin looks.
 */
export default async function Compare({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; market?: string; channel?: string }>;
}) {
  await requireSuperIQ("/priceiq/compare");
  seed();
  const sp = await searchParams;
  /* Look the device up, never list them all.
     Rendering 2,566 chips shipped 1.5 MB of markup so somebody could pick one. */
  const devices = listDevices();
  const deviceId = sp.device && devices.some((d) => d.id === sp.device)
    ? sp.device
    // Landing on devices[0] meant landing alphabetically — out of 2,566, almost
    // always on something with no data at all.
    : (busiestDeviceId() ?? devices[0].id);
  const market = (sp.market && MARKETS[sp.market as MarketCode] ? sp.market : "US") as MarketCode;
  const channel = (sp.channel && CHANNELS.some((c) => c.id === sp.channel) ? sp.channel : "wholesale") as Channel;

  const device = devices.find((d) => d.id === deviceId)!;
  const r = compareDevice(deviceId, market, channel);
  const cov = coverageFor(deviceId, market);
  const here = cov.quotes.find((q) => q.market === market);
  /* A USD reference beside every local figure. Rupees are the truth of what an
     Indian programme pays; dollars are what make it comparable to Dubai and the
     US, and without one on the page everybody converts it themselves at
     whatever rate their browser found. */
  const rates = fxRates();
  const usdRate = r.reportIn === "USD" ? null : rateInForce("USD", r.reportIn, new Date().toISOString());
  const usd = (m: Parameters<typeof convert>[0], at: string) => {
    const c = convert(m, "USD", at, rates);
    return c.ok ? `$${(c.value.money.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
  };
  const elsewhere = cov.quotes.filter((q) => q.market !== market);
  const link = (o: Record<string, string>) =>
    `/compare?${new URLSearchParams({ device: deviceId, market, channel, ...o }).toString()}`;

  return (
    <>
      <SeedBanner />
      <h1 className="text-[26px] font-extrabold tracking-tight">
        {device.brand} {device.model} <span className="text-[var(--muted)]">{skuLabel(device)}</span>
      </h1>
      <p className="mt-1 text-[13.5px] text-[var(--muted)]">
        What each programme pays in {MARKETS[market].name}, against what it sells for via{" "}
        {CHANNELS.find((c) => c.id === channel)!.label.toLowerCase()}.
      </p>

      {/* device: search or browse, never a wall of chips */}
      <div className="mt-5">
        <DevicePickerClient
          base={process.env.NEXT_PUBLIC_BASE_PATH || ""}
          current={{ id: device.id, label: fullLabel(device) }}
          path="/compare"
          carry={{ market, channel }}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
        <Picker label="Market">
          {(Object.keys(MARKETS) as MarketCode[]).map((c) => (
            <Chip key={c} href={link({ market: c })} on={c === market} label={MARKETS[c].name} />
          ))}
        </Picker>
        <Picker label="Channel">
          {CHANNELS.map((c) => (
            <Chip key={c.id} href={link({ channel: c.id })} on={c.id === channel} label={c.label} title={c.note} />
          ))}
        </Picker>
      </div>

      {/* where the best exit is, across every channel */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {r.channelSummary.map((c) => {
          const on = c.channel === channel;
          return (
            <Link
              key={c.channel}
              href={link({ channel: c.channel })}
              className="panel p-3.5"
              style={on ? { borderColor: "var(--brand)", borderWidth: 2 } : undefined}
            >
              <div className="label">{c.label}</div>
              <div className="mono mt-1 text-[19px] font-extrabold"
                   style={{ color: c.best && c.best.grossPct > 0 ? "var(--green-ink)" : "var(--muted)" }}>
                {c.medianGrossPct === null ? "—" : `${c.medianGrossPct}%`}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                median margin · {c.firmCount}/{c.count} firm
              </div>
            </Link>
          );
        })}
      </div>

      {/* WHY THIS SCREEN MIGHT BE EMPTY — two different reasons, said plainly. */}
      {!here && (
        <div className="panel mt-6 border-l-[3px] p-4" style={{ borderColor: "var(--gold-2)" }}>
          <div className="text-[14px] font-bold">
            No programme in {MARKETS[market].name} quotes this device.
          </div>
          {elsewhere.length > 0 ? (
            <p className="mt-1.5 text-[13px] text-[var(--muted)]">
              It is quoted in{" "}
              {elsewhere.map((q, i) => (
                <span key={q.market}>
                  {i > 0 && ", "}
                  <Link href={link({ market: q.market })} className="font-semibold text-[var(--brand)]">
                    {MARKETS[q.market].name}
                  </Link>{" "}
                  ({q.quotes} price{q.quotes === 1 ? "" : "s"} from {q.programs} programme
                  {q.programs === 1 ? "" : "s"})
                </span>
              ))}
              . Coverage is per market — a device priced in one is not automatically priced in another.
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-[var(--muted)]">
              No programme anywhere quotes it yet. It is in the catalogue because a source named it,
              which is not the same as a source pricing it.
            </p>
          )}
        </div>
      )}

      {here && !r.marketPrice && (
        <div className="panel mt-6 border-l-[3px] p-4" style={{ borderColor: "var(--gold-2)" }}>
          <div className="text-[14px] font-bold">
            {here.quotes} trade-in price{here.quotes === 1 ? "" : "s"} here — but no {CHANNELS.find((c) => c.id === channel)!.label.toLowerCase()} market price.
          </div>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">
            A spread needs both sides. We know what {MARKETS[market].name} programmes will PAY for
            this device; we do not yet know what it SELLS for.
            {cov.channels.length > 0 ? (
              <> There is a price for{" "}
                {cov.channels.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ", "}
                    <Link href={link({ channel: c })} className="font-semibold text-[var(--brand)]">
                      {CHANNEL_LABEL[c]}
                    </Link>
                  </span>
                ))}.
              </>
            ) : (
              <> Record one on the <Link href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/entry`} className="font-semibold text-[var(--brand)]">entry page</Link> and every quote below becomes a spread.</>
            )}
          </p>
        </div>
      )}

      {/* the market price this channel is measured against */}
      {r.marketPrice ? (
        <div className="panel mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 p-4">
          <div>
            <div className="label">Market price · {CHANNELS.find((c) => c.id === channel)!.label}</div>
            <div className="mono mt-0.5 text-[22px] font-extrabold">{formatMoney(r.marketPrice.price)}</div>
          </div>
          <div className="text-[12.5px] text-[var(--muted)]">
            {describeSpan(r.marketPrice.condition)} · from {r.marketPrice.sampleSize} comparable
            {r.marketPrice.sampleSize === 1 ? "" : "s"}
            {r.marketPrice.dispersionPct !== null && <> · ±{r.marketPrice.dispersionPct}% scatter</>}
            <> · {since(r.marketPrice.observedAt)} ago</>
          </div>
        </div>
      ) : (
        <div className="panel mt-6 p-4 text-[13px] text-[var(--muted)]">
          No {channel} market price for this device in {MARKETS[market].name}.
        </div>
      )}

      {/* the comparison */}
      <div className="panel mt-4 overflow-x-auto p-4">
        <table>
          <thead>
            <tr>
              <th>Programme</th>
              <th>Their grade</th>
              <th style={{ textAlign: "right" }}>They pay</th>
              <th style={{ textAlign: "right" }}>Spread</th>
              <th style={{ textAlign: "right" }}>Margin</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.programId}>
                <td>
                  <div className="font-semibold">{row.programName}</div>
                  <div className="mono text-[11px] text-[var(--muted)]">{since(row.observedAt)} ago</div>
                </td>
                <td>
                  <div>{row.conditionLabel}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {row.conditionSpan ? describeSpan(row.conditionSpan) : "not on ladder"}
                  </div>
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {formatMoney(row.quote)}
                  {usdRate && (
                    <div className="text-[11px] font-normal text-[var(--muted)]">
                      {usd(row.quote, row.observedAt) ?? "—"}
                    </div>
                  )}
                </td>
                <td className="mono font-bold" style={{ textAlign: "right",
                  color: row.spread ? (row.spread.grossMinor >= 0 ? "var(--green-ink)" : "var(--bad)") : "var(--muted)" }}>
                  {row.spread ? formatGross(row.spread) : "—"}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {row.spread ? `${row.spread.grossPct}%` : "—"}
                </td>
                <td>
                  {row.spread ? (
                    <span
                      className="mono text-[11px] font-bold uppercase tracking-wide"
                      style={{ color: row.spread.confidence === "firm" ? "var(--green-ink)" : "var(--amber-ink)" }}
                      title={row.spread.caveats.join("  ")}
                    >
                      {row.spread.confidence}
                      {row.spread.caveats.length > 0 && (
                        <span className="ml-1 font-normal normal-case text-[var(--muted)]">
                          {row.spread.caveats.length} caveat{row.spread.caveats.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[11.5px]" style={{ color: "var(--muted)" }}>{row.refusal}</span>
                  )}
                </td>
              </tr>
            ))}
            {r.rows.length === 0 && (
              <tr><td colSpan={6} className="text-[13px] text-[var(--muted)]">
                No programme in {MARKETS[market].name} quotes this device.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* the USD reference, and where it came from */}
      {usdRate && r.rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 text-[12px] text-[var(--muted)]">
          <span>
            USD shown at <b className="mono text-[var(--text)]">{usdRate.rate.toFixed(4)} {r.reportIn}/USD</b>{" "}
            as of {usdRate.asOf} — {usdRate.source || <b style={{ color: "var(--amber-ink)" }}>no source recorded</b>}
          </span>
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/export?market=${market}`}
             className="font-semibold text-[var(--brand)]">
            Export {MARKETS[market].name} · CSV, both currencies ↓
          </a>
        </div>
      )}

      {/* caveats, spelled out rather than hidden in a tooltip */}
      {r.rows.some((x) => x.spread && x.spread.caveats.length) && (
        <div className="panel mt-4 p-4">
          <div className="label">Why some rows are only indicative</div>
          <ul className="mt-2 space-y-1.5 text-[12.5px] text-[var(--muted)]">
            {r.rows.filter((x) => x.spread && x.spread.caveats.length).slice(0, 6).map((x) => (
              <li key={x.programId}>
                <b className="text-[var(--text)]">{x.programName}</b> — {x.spread!.caveats.join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ href, on, label, title }: { href: string; on: boolean; label: string; title?: string }) {
  return (
    <Link href={href} title={title} className="border px-2.5 py-1 text-[11.5px] font-semibold"
      style={on ? { borderColor: "var(--brand)", background: "var(--brand)", color: "#fff" }
                : { borderColor: "var(--border)", color: "var(--muted)" }}>
      {label}
    </Link>
  );
}
