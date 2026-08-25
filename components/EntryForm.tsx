"use client";

import { useEffect, useState } from "react";
import { CHANNELS, type Channel } from "@/core/channel.ts";
import { MARKETS, type MarketCode } from "@/core/markets.ts";
import { currentWeek, weekStart } from "@/core/week.ts";

/**
 * The manual-entry form.
 *
 * Two things it does that a plain form would not, both aimed at the same
 * failure — a number typed without context that nobody can defend later:
 *
 *   1. It SHOWS LAST WEEK'S FIGURE for the slot you have chosen, and the delta
 *      as you type. A 40% week-on-week move is usually a typo, and the moment
 *      to catch it is before it is saved, not in a chart next month.
 *   2. It will not submit without a comparables count and a source. Everything
 *      downstream weighs a price by exactly those two; a figure without them
 *      can be displayed but never scored.
 */

type Device = { id: string; brand: string; model: string; storageGb: number };
type Last = {
  amount_minor: number; currency: string; sample_size: number;
  dispersion_pct: number | null; source: string; observed_at: string;
  week: string; entered_by: string;
} | null;

export default function EntryForm({ devices, base }: { devices: Device[]; base: string }) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [market, setMarket] = useState<MarketCode>("US");
  const [channel, setChannel] = useState<Channel>("wholesale");
  const [amount, setAmount] = useState("");
  const [sampleSize, setSampleSize] = useState("");
  const [scatter, setScatter] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [last, setLast] = useState<Last>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const currency = MARKETS[market].currency;
  const week = currentWeek();

  const reload = () =>
    fetch(`${base}/api/prices?deviceId=${deviceId}&market=${market}&channel=${channel}`)
      .then((r) => r.json())
      .then((d) => setLast(d.last ?? null))
      .catch(() => setLast(null));

  useEffect(() => {
    if (!deviceId) return;
    setLast(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, market, channel, base]);

  const typed = Number(amount);
  const prev = last ? last.amount_minor / 100 : null;
  const delta = prev !== null && prev > 0 && Number.isFinite(typed) && typed > 0
    ? ((typed - prev) / prev) * 100 : null;
  // A double-digit weekly move is usually a typo. WARN, never block: real
  // markets do move that far, and a form that refuses reality gets worked around.
  const bigMove = delta !== null && Math.abs(delta) >= 20;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${base}/api/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId, market, channel,
          amountMajor: typed, currency,
          sampleSize: Number(sampleSize),
          dispersionPct: scatter === "" ? null : Number(scatter),
          source, note,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setMsg({ ok: false, text: d.error || "could not save" }); return; }
      setMsg({ ok: true, text: `Saved for ${d.week}. Enter the next one.` });
      setAmount(""); setNote("");
      reload();
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="panel p-5">
        <div className="label">1 &middot; Which price</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Device">
            <select className="inp" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.brand} {d.model} {d.storageGb}GB</option>
              ))}
            </select>
          </Field>
          <Field label="Market">
            <select className="inp" value={market} onChange={(e) => setMarket(e.target.value as MarketCode)}>
              {(Object.keys(MARKETS) as MarketCode[]).map((m) => (
                <option key={m} value={m}>{MARKETS[m].name}</option>
              ))}
            </select>
          </Field>
          <Field label="Channel">
            <select className="inp" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          {CHANNELS.find((c) => c.id === channel)?.note}
        </p>

        <div className="label mt-5">2 &middot; The number</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={`Price (${currency})`}>
            <input className="inp mono" inputMode="decimal" placeholder="0.00"
                   value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <Field label="Comparables" hint="how many sales">
            <input className="inp mono" inputMode="numeric" placeholder="e.g. 12"
                   value={sampleSize} onChange={(e) => setSampleSize(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Scatter ±%" hint="optional">
            <input className="inp mono" inputMode="decimal" placeholder="e.g. 8"
                   value={scatter} onChange={(e) => setScatter(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
        </div>
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          Scatter is how far apart those comparables were — the error bar on this figure, not the margin.
        </p>

        <div className="label mt-5">3 &middot; Where it came from</div>
        <div className="mt-3 grid gap-3">
          <input className="inp" placeholder="own closed deals &middot; broker quote &middot; listing page…"
                 value={source} onChange={(e) => setSource(e.target.value)} />
          <input className="inp" placeholder="Note (optional) — anything odd about this week"
                 value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {bigMove && (
          <p className="mt-4 border-l-[3px] px-3 py-2 text-[12.5px]"
             style={{ borderColor: "var(--gold-2)", background: "color-mix(in srgb, var(--yellow) 14%, transparent)" }}>
            That is <b>{delta! > 0 ? "+" : ""}{delta!.toFixed(1)}%</b> against the last entry. Real, or a typo?
            Saving is fine either way — this is a nudge, not a block.
          </p>
        )}
        {msg && (
          <p className="mt-4 text-[13px] font-semibold"
             style={{ color: msg.ok ? "var(--green-ink)" : "var(--bad-ink)" }}>{msg.text}</p>
        )}

        <button className="mt-5 w-full px-5 py-3 text-[13px] font-bold uppercase tracking-[.1em] text-white disabled:opacity-40"
                style={{ background: "var(--text)" }}
                disabled={busy || !amount || !sampleSize || !source}>
          {busy ? "Saving…" : `Record for ${week}`}
        </button>
      </div>

      <div className="panel h-fit p-5">
        <div className="label">Last recorded</div>
        {!last ? (
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Nothing entered for this device, market and channel yet. This will be the first —
            it becomes the baseline every later week is measured against.
          </p>
        ) : (
          <>
            <div className="mono mt-1.5 text-[26px] font-extrabold">
              {last.currency} {(last.amount_minor / 100).toLocaleString()}
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              {last.week} &middot; week beginning {weekStart(last.week)} &middot; by {last.entered_by}
            </div>
            <dl className="mt-3 space-y-1 border-t border-[var(--border-soft)] pt-3 text-[12.5px]">
              <Row k="Comparables" v={String(last.sample_size)} />
              <Row k="Scatter" v={last.dispersion_pct === null ? "—" : `±${last.dispersion_pct}%`} />
              <Row k="Source" v={last.source} />
            </dl>
            {delta !== null && (
              <div className="mt-4 border-t border-[var(--border-soft)] pt-3">
                <div className="label">If you save this</div>
                <div className="mono mt-1 text-[20px] font-extrabold"
                     style={{ color: delta === 0 ? "var(--muted)" : delta > 0 ? "var(--green-ink)" : "var(--bad-ink)" }}>
                  {delta > 0 ? "+" : ""}{delta.toFixed(2)}%
                </div>
                <div className="text-[11.5px] text-[var(--muted)]">
                  {delta === 0 ? "unchanged — stored as a confirmation, not a change" : "against the last entry"}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {hint && <span className="ml-1.5 text-[10.5px] text-[var(--muted)]">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-[var(--muted)]">{k}</dt>
    <dd className="truncate text-right font-semibold">{v}</dd>
  </div>
);
