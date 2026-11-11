import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { compareDevice, listDevices, coverageFor, busiestDeviceId, busiestMarket, rateInForce, fxRates } from "@/lib/repo.ts";
import { getBuybackPricesByGrade } from "@/lib/buyback.ts";
import { convert, formatMoney, money } from "@/core/money.ts";
import { fullLabel, skuLabel } from "@/core/search.ts";
import DevicePickerClient from "@/components/DevicePickerClient";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import { CHANNELS, CHANNEL_LABEL, type Channel } from "@/core/channel.ts";
import { describeSpan, type ConditionSpan } from "@/core/condition.ts";
import { computeSpread, formatGross } from "@/core/spread.ts";
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
  await seed();
  const sp = await searchParams;
  const devices = await listDevices();
  const busiestDev = await busiestDeviceId();
  const deviceId = sp.device && devices.some((d) => d.id === sp.device)
    ? sp.device
    : (busiestDev ?? (devices[0]?.id || ""));

  const busiestMkt = await busiestMarket();
  const market = (sp.market && MARKETS[sp.market as MarketCode]
    ? sp.market
    : (busiestMkt ?? "IN")) as MarketCode;
  const channel = (sp.channel && CHANNELS.some((c) => c.id === sp.channel) ? sp.channel : "wholesale") as Channel;

  const device = devices.find((d) => d.id === deviceId) || devices[0] || {
    id: "",
    brand: "",
    model: "",
    storageGb: 0,
    ramGb: undefined,
    releaseYear: 0,
    aliases: [],
  };

  const r = await compareDevice(deviceId, market, channel);
  const inCompare = market === "IN" ? r : await compareDevice(deviceId, "IN", channel);
  const cov = await coverageFor(deviceId, market);
  const here = cov.quotes.find((q) => q.market === market);
  const cashifyGrades = await getBuybackPricesByGrade(deviceId);

  const rates = await fxRates();
  const usdRate = r.reportIn === "USD" ? null : await rateInForce("USD", r.reportIn, new Date().toISOString());
  const usd = (m: Parameters<typeof convert>[0], at: string) => {
    const c = convert(m, "USD", at, rates);
    return c.ok ? `$${(c.value.money.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
  };
  const elsewhere = cov.quotes.filter((q) => q.market !== market);
  const link = (o: Record<string, string>) =>
    `/compare?${new URLSearchParams({ device: deviceId, market, channel, ...o }).toString()}`;

  const activeChannelLabel = CHANNELS.find((c) => c.id === channel)!.label;

  return (
    <>
      <SeedBanner />
      <div className="editorial-rule mb-4 w-full max-w-[420px]" />
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-[28px] font-extrabold tracking-[-.04em]">
              {device.brand} {device.model}{" "}
              <span className="text-[var(--muted)]">{skuLabel(device)}</span>
            </h1>
            {device.releaseYear > 0 && (
              <span className="mono px-2 py-0.5 text-[11px] border border-[var(--border)] bg-[var(--card)] text-[var(--muted)]">
                {device.releaseYear} · {device.id}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] text-[var(--muted)]">
            What each programme pays in {MARKETS[market].name}, against what it sells for via{" "}
            {activeChannelLabel.toLowerCase()}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/devices"
            className="px-3 py-1.5 text-[12px] font-semibold border border-[var(--border)] bg-[var(--card)] hover:border-[var(--brand)] transition-colors"
          >
            ← Device Catalogue ({devices.length})
          </Link>
          <Link
            href={`/entry?device=${device.id}&market=${market}&channel=${channel}`}
            className="px-3 py-1.5 text-[12px] font-bold text-white transition-colors"
            style={{ background: "var(--brand)" }}
          >
            Record Market Price →
          </Link>
        </div>
      </div>

      {device.aliases && device.aliases.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
          <span>Mapped catalogue aliases:</span>
          {device.aliases.map((a) => (
            <span
              key={a}
              className="mono px-1.5 py-0.5 text-[11px] border border-[var(--border)] bg-[var(--card)] rounded-[2px] text-[var(--text)]"
            >
              {a}
            </span>
          ))}
        </div>
      )}

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
          {(Object.keys(MARKETS) as MarketCode[]).map((c) => {
            const mCov = cov.quotes.find((q) => q.market === c);
            return (
              <Chip
                key={c}
                href={link({ market: c })}
                on={c === market}
                label={`${MARKETS[c].name}${mCov ? ` (${mCov.programs})` : ""}`}
              />
            );
          })}
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
              <div
                className="mono mt-1 text-[19px] font-extrabold"
                style={{ color: c.best && c.best.grossPct > 0 ? "var(--green-ink)" : "var(--muted)" }}
              >
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
            {here.quotes} trade-in price{here.quotes === 1 ? "" : "s"} here — but no {activeChannelLabel.toLowerCase()} market price.
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
        <div className="panel mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 p-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <div className="label">Sell-Side Market Price · {activeChannelLabel} ({MARKETS[market].name})</div>
              <div className="mono mt-0.5 text-[22px] font-extrabold">
                {formatMoney(r.marketPrice.price)}
                {usdRate && (
                  <span className="ml-2.5 text-[13.5px] font-normal text-[var(--muted)]">
                    ({usd(r.marketPrice.price, r.marketPrice.observedAt) ?? "—"} USD)
                  </span>
                )}
              </div>
            </div>
            <div className="text-[12.5px] text-[var(--muted)]">
              Condition: <b className="text-[var(--text)]">{describeSpan(r.marketPrice.condition)}</b> · from{" "}
              <b className="text-[var(--text)]">{r.marketPrice.sampleSize}</b> comparable
              {r.marketPrice.sampleSize === 1 ? "" : "s"}
              {r.marketPrice.dispersionPct !== null && <> · ±{r.marketPrice.dispersionPct}% scatter</>}
              <> · observed {since(r.marketPrice.observedAt)} ago</>
            </div>
          </div>
          <div className="mono text-[11.5px] text-[var(--muted)]">
            {r.rows.length} programme{r.rows.length === 1 ? "" : "s"} compared
          </div>
        </div>
      ) : (
        <div className="panel mt-6 p-4 text-[13px] text-[var(--muted)]">
          No {channel} market price for this device in {MARKETS[market].name}.
        </div>
      )}

      {/* the comparison */}
      <div className="panel mt-4 overflow-x-auto p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <div className="label">Programme Trade-In Quotes vs {activeChannelLabel} Exit</div>
            <div className="text-[14px] font-bold mt-0.5">
              {MARKETS[market].name} Buy-Side Offers &amp; Computed Spreads
            </div>
          </div>
          <span className="mono text-[11.5px] text-[var(--muted)]">
            Firm spreads sort above indicative spreads
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Programme</th>
              <th>Their grade &amp; canonical span</th>
              <th style={{ textAlign: "right" }}>They pay (Buy)</th>
              <th style={{ textAlign: "right" }}>Spread vs {activeChannelLabel}</th>
              <th style={{ textAlign: "right" }}>Margin</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.programId}>
                <td>
                  <div className="font-semibold">{row.programName}</div>
                  <div className="mono text-[11px] text-[var(--muted)]">
                    {row.programId} · {since(row.observedAt)} ago
                  </div>
                </td>
                <td>
                  <div className="font-medium">{row.conditionLabel}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {row.conditionSpan ? describeSpan(row.conditionSpan) : "not on ladder"}
                  </div>
                  {row.grades && row.grades.length > 1 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.grades.map((g) => (
                        <span
                          key={g.conditionLabel}
                          className="mono px-1.5 py-0.5 text-[10px] border border-[var(--border-soft)] bg-[var(--bg-soft)] text-[var(--muted)]"
                        >
                          {g.conditionLabel}: {formatMoney(g.quote)}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="mono font-semibold" style={{ textAlign: "right" }}>
                  {formatMoney(row.quote)}
                  {usdRate && (
                    <div className="text-[11px] font-normal text-[var(--muted)]">
                      {usd(row.quote, row.observedAt) ?? "—"}
                    </div>
                  )}
                </td>
                <td
                  className="mono font-bold"
                  style={{
                    textAlign: "right",
                    color: row.spread ? (row.spread.grossMinor >= 0 ? "var(--green-ink)" : "var(--bad)") : "var(--muted)",
                  }}
                >
                  {row.spread ? formatGross(row.spread) : "—"}
                </td>
                <td
                  className="mono font-bold"
                  style={{
                    textAlign: "right",
                    color: row.spread ? (row.spread.grossPct >= 0 ? "var(--green-ink)" : "var(--bad)") : "var(--muted)",
                  }}
                >
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
                          ({row.spread.caveats.length} caveat{row.spread.caveats.length === 1 ? "" : "s"})
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
              <tr>
                <td colSpan={6} className="text-[13px] text-[var(--muted)]">
                  No programme in {MARKETS[market].name} quotes this device.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cashify India Buyback Prices by Grade (SUP-15 scraper.cashify_buy_prices breakdown) */}
      {cashifyGrades.length > 0 && (
        <div className="panel mt-6 overflow-x-auto p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <div>
              <div className="label">Cashify India · Buyback Prices by Grade (cashify_buy_prices)</div>
              <div className="text-[14px] font-bold mt-0.5">
                All Scraped Condition Grades for {device.brand} {device.model} {skuLabel(device)}
              </div>
            </div>
            <span className="mono text-[11.5px] text-[var(--muted)]">
              {cashifyGrades.length} grade quote{cashifyGrades.length === 1 ? "" : "s"} · compared against India {activeChannelLabel}
              {inCompare.marketPrice ? ` (${formatMoney(inCompare.marketPrice.price)})` : ""}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Scraped Condition Grade</th>
                <th>Canonical Ladder Span</th>
                <th style={{ textAlign: "right" }}>Cashify Buyback Quote</th>
                <th style={{ textAlign: "right" }}>USD Equivalent</th>
                <th style={{ textAlign: "right" }}>Spread vs IN {activeChannelLabel}</th>
                <th style={{ textAlign: "right" }}>Gross Margin</th>
                <th>Observed</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {cashifyGrades.map((g) => {
                const inMp = inCompare.marketPrice;
                const gradeQuote = money(g.cashifyPriceMinor, g.currency);
                const directSpread =
                  inMp && g.conditionSpan
                    ? computeSpread({
                        programId: "cashify-in",
                        deviceId,
                        market: "IN",
                        tradeIn: {
                          price: gradeQuote,
                          condition: g.conditionSpan as ConditionSpan,
                          observedAt: g.observedAt,
                        },
                        marketPrice: inMp,
                        reportIn: "INR",
                        rates,
                      })
                    : null;

                const netMinor = inMp ? inMp.price.amountMinor - g.cashifyPriceMinor : null;
                const netPct =
                  inMp && inMp.price.amountMinor > 0 && netMinor !== null
                    ? Math.round((netMinor / inMp.price.amountMinor) * 10000) / 100
                    : null;

                return (
                  <tr key={g.conditionLabel}>
                    <td className="font-semibold">{g.conditionLabel}</td>
                    <td className="text-[12px] text-[var(--muted)]">
                      {g.conditionSpan ? describeSpan(g.conditionSpan as ConditionSpan) : "—"}
                    </td>
                    <td className="mono font-bold" style={{ textAlign: "right", color: "var(--green-ink)" }}>
                      {g.currency} {g.cashifyPriceMajor.toLocaleString()}
                    </td>
                    <td className="mono text-[12px] text-[var(--muted)]" style={{ textAlign: "right" }}>
                      {usd({ amountMinor: g.cashifyPriceMinor, currency: g.currency }, g.observedAt) ?? "—"}
                    </td>
                    <td
                      className="mono font-semibold"
                      style={{
                        textAlign: "right",
                        color:
                          netMinor !== null
                            ? netMinor >= 0
                              ? "var(--green-ink)"
                              : "var(--bad)"
                            : "var(--muted)",
                      }}
                    >
                      {directSpread && directSpread.ok
                        ? formatGross(directSpread.spread)
                        : netMinor !== null
                          ? `${netMinor < 0 ? "−" : ""}INR ${(Math.abs(netMinor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"}
                    </td>
                    <td className="mono text-[12px]" style={{ textAlign: "right" }}>
                      {directSpread && directSpread.ok ? (
                        <span className="font-bold text-[var(--green-ink)]">{directSpread.spread.grossPct}%</span>
                      ) : netPct !== null ? (
                        <span className="text-[var(--muted)]" title="Refurbishment required to reach Flawless–Good sell condition">
                          {netPct}% (pre-refurb)
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono text-[11.5px] text-[var(--muted)]">{since(g.observedAt)} ago</td>
                    <td className="text-[12px]">
                      {g.sourceUrl ? (
                        <a href={g.sourceUrl} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline">
                          cashify.in ↗
                        </a>
                      ) : (
                        <span className="text-[var(--muted)]">scraper.cashify_buy_prices</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* the USD reference, and where it came from */}
      {usdRate && r.rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 text-[12px] text-[var(--muted)]">
          <span>
            USD shown at <b className="mono text-[var(--text)]">{usdRate.rate.toFixed(4)} {r.reportIn}/USD</b>{" "}
            as of {usdRate.asOf} — {usdRate.source || <b style={{ color: "var(--amber-ink)" }}>no source recorded</b>}
          </span>
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/export?market=${market}`}
            className="font-semibold text-[var(--brand)]"
          >
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
    <Link
      href={href}
      title={title}
      className="border px-2.5 py-1 text-[11.5px] font-semibold"
      style={
        on
          ? { borderColor: "var(--brand)", background: "var(--brand)", color: "#fff" }
          : { borderColor: "var(--border)", color: "var(--muted)" }
      }
    >
      {label}
    </Link>
  );
}
