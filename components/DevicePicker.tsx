"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Manufacturer → model → SKU, with free text across all three.
 *
 * Both routes exist because people arrive knowing different amounts. Somebody
 * who knows they want a Galaxy S24 Ultra types it; somebody browsing what a
 * manufacturer has walks the levels. Forcing either through the other is the
 * usual way a picker becomes annoying.
 *
 * Nothing is fetched until it is needed — the catalogue is 2,566 devices and
 * shipping it to choose one is what this replaces.
 */

type Device = { id: string; brand: string; model: string; storageGb: number; ramGb?: number; sku: string; label: string };

export default function DevicePicker({
  base, current, onPick,
}: {
  base: string;
  current: { id: string; label: string } | null;
  onPick: (deviceId: string, label?: string) => void;
}) {
  const [mode, setMode] = useState<"search" | "browse">("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Device[]>([]);
  const [brands, setBrands] = useState<Array<{ brand: string; count: number }>>([]);
  const [models, setModels] = useState<Array<{ model: string; count: number }>>([]);
  const [skus, setSkus] = useState<Device[]>([]);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = useMemo(() => `${base}/api/devices`, [base]);

  // Debounced: a keystroke per request would put 2,566-row scans behind every
  // letter somebody types.
  useEffect(() => {
    if (mode !== "search") return;
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    setBusy(true);
    timer.current = setTimeout(() => {
      fetch(`${api}?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 180);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, mode, api]);

  useEffect(() => {
    if (mode !== "browse" || brands.length) return;
    fetch(api).then((r) => r.json()).then((d) => { setBrands(d.brands ?? []); setTotal(d.total ?? 0); }).catch(() => {});
  }, [mode, api, brands.length]);

  function pickBrand(b: string) {
    setBrand(b); setModel(""); setSkus([]); setModels([]);
    fetch(`${api}?brand=${encodeURIComponent(b)}`).then((r) => r.json()).then((d) => setModels(d.models ?? []));
  }
  function pickModel(m: string) {
    setModel(m); setSkus([]);
    fetch(`${api}?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(m)}`)
      .then((r) => r.json()).then((d) => setSkus(d.skus ?? []));
  }

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="label">Device</div>
        <div className="flex gap-1.5">
          <Tab on={mode === "search"} onClick={() => setMode("search")} label="Search" />
          <Tab on={mode === "browse"} onClick={() => setMode("browse")} label="Browse" />
        </div>
      </div>

      {current && (
        <div className="mt-2 text-[13.5px]">
          <span className="text-[var(--muted)]">Showing </span>
          <b>{current.label}</b>
        </div>
      )}

      {mode === "search" ? (
        <>
          <input
            autoFocus
            className="inp mt-3"
            placeholder="Manufacturer, model or SKU — e.g. galaxy s24 ultra 512, iphone 15, honor 90 12"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q.trim().length >= 2 && (
            <div className="mt-2 max-h-[320px] overflow-y-auto border border-[var(--border-soft)]">
              {busy && <div className="p-3 text-[12.5px] text-[var(--muted)]">Searching…</div>}
              {!busy && results.length === 0 && (
                <div className="p-3 text-[12.5px] text-[var(--muted)]">
                  Nothing matches “{q}”. Every word has to appear — try fewer.
                </div>
              )}
              {results.map((d) => (
                <button key={d.id} onClick={() => onPick(d.id, d.label)}
                        className="flex w-full items-baseline justify-between gap-3 border-b border-[var(--border-soft)] px-3 py-2 text-left hover:bg-[var(--card-2)]">
                  <span className="text-[13px]">
                    <span className="text-[var(--muted)]">{d.brand}</span> <b>{d.model}</b>
                  </span>
                  <span className="mono shrink-0 text-[12px] text-[var(--muted)]">{d.sku}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Column label={`Manufacturer${total ? ` · ${total} devices` : ""}`}>
            {brands.map((b) => (
              <Row key={b.brand} on={brand === b.brand} onClick={() => pickBrand(b.brand)}
                   left={b.brand} right={String(b.count)} />
            ))}
          </Column>
          <Column label={brand ? `${brand} models` : "Model"}>
            {!brand && <Hint>Pick a manufacturer</Hint>}
            {models.map((m) => (
              <Row key={m.model} on={model === m.model} onClick={() => pickModel(m.model)}
                   left={m.model} right={m.count > 1 ? `${m.count}` : ""} />
            ))}
          </Column>
          <Column label="SKU">
            {!model && <Hint>Pick a model</Hint>}
            {skus.map((d) => (
              <Row key={d.id} on={current?.id === d.id} onClick={() => onPick(d.id, d.label)} left={d.sku} right="" />
            ))}
          </Column>
        </div>
      )}
    </div>
  );
}

const Tab = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
  <button onClick={onClick} className="border px-2.5 py-1 text-[11.5px] font-semibold"
    style={on ? { borderColor: "var(--brand)", background: "var(--brand)", color: "#fff" }
              : { borderColor: "var(--border)", color: "var(--muted)" }}>
    {label}
  </button>
);
const Column = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="label mb-1">{label}</div>
    <div className="max-h-[300px] overflow-y-auto border border-[var(--border-soft)]">{children}</div>
  </div>
);
const Row = ({ on, onClick, left, right }: { on: boolean; onClick: () => void; left: string; right: string }) => (
  <button onClick={onClick}
          className="flex w-full items-baseline justify-between gap-2 border-b border-[var(--border-soft)] px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--card-2)]"
          style={on ? { background: "var(--card-2)", fontWeight: 700 } : undefined}>
    <span className="truncate">{left}</span>
    <span className="mono shrink-0 text-[11px] text-[var(--muted)]">{right}</span>
  </button>
);
const Hint = ({ children }: { children: React.ReactNode }) => (
  <div className="p-2.5 text-[12px] text-[var(--muted)]">{children}</div>
);
