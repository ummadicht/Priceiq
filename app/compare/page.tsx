import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { compareDevice, listDevices } from "@/lib/repo.ts";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import { CHANNELS, type Channel } from "@/core/channel.ts";
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
  seed();
  const sp = await searchParams;
  const devices = listDevices();
  const deviceId = sp.device && devices.some((d) => d.id === sp.device) ? sp.device : devices[0].id;
  const market = (sp.market && MARKETS[sp.market as MarketCode] ? sp.market : "US") as MarketCode;
  const channel = (sp.channel && CHANNELS.some((c) => c.id === sp.channel) ? sp.channel : "wholesale") as Channel;

  const device = devices.find((d) => d.id === deviceId)!;
  const r = compareDevice(deviceId, market, channel);
  const link = (o: Record<string, string>) =>
    `/compare?${new URLSearchParams({ device: deviceId, market, channel, ...o }).toString()}`;

  return (
    <>
      <SeedBanner />
      <h1 className="text-[26px] font-extrabold tracking-tight">
        {device.brand} {device.model} <span className="text-[var(--muted)]">{device.storageGb}GB</span>
      </h1>
      <p className="mt-1 text-[13.5px] text-[var(--muted)]">
        What each programme pays in {MARKETS[market].name}, against what it sells for via{" "}
        {CHANNELS.find((c) => c.id === channel)!.label.toLowerCase()}.
      </p>

      {/* selectors */}
      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
        <Picker label="Device">
          {devices.map((d) => (
            <Chip key={d.id} href={link({ device: d.id })} on={d.id === deviceId}
                  label={`${d.model} ${d.storageGb}`} />
          ))}
        </Picker>
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
            {r.marketPrice.dispersionPct !== null && <> · ±{r.marketPrice.dispersionPct}% spread</>}
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
                <td className="mono" style={{ textAlign: "right" }}>{formatMoney(row.quote)}</td>
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
