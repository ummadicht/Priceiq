"use client";

import { useState } from "react";
import type { QuarantinedItem } from "@/app/api/quarantine/route.ts";

interface IngestStats {
  runId: string;
  totalRowsScraped: number;
  observationsCaptured: number;
  quarantinedCount: number;
  matchRate: number;
}

interface Props {
  initialItems: QuarantinedItem[];
  initialDevices: Array<{ id: string; label: string }>;
  initialIngest?: IngestStats;
  basePath: string;
}

export default function QuarantineClient({
  initialItems,
  initialDevices,
  initialIngest,
  basePath,
}: Props) {
  const [items, setItems] = useState<QuarantinedItem[]>(initialItems);
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>(initialDevices);
  const [ingestStats, setIngestStats] = useState<IngestStats | undefined>(initialIngest);
  const [selectedDevices, setSelectedDevices] = useState<Record<number, string>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [enrollingAll, setEnrollingAll] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "good" | "warn" } | null>(null);

  const handleDeviceChange = (itemId: number, deviceId: string) => {
    setSelectedDevices((prev) => ({ ...prev, [itemId]: deviceId }));
  };

  const resolveItem = async (item: QuarantinedItem) => {
    const targetDeviceId = selectedDevices[item.id] || item.candidate_ids[0];
    if (!targetDeviceId) {
      setMessage({ text: "Please select a master catalogue device to map this alias to, or click 'Enrol as New Device'.", tone: "warn" });
      return;
    }

    setLoadingId(item.id);
    setMessage(null);

    try {
      const res = await fetch(`${basePath}/api/quarantine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "map",
          quarantineId: item.id,
          deviceId: targetDeviceId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error || "Failed to resolve item", tone: "warn" });
      } else {
        if (Array.isArray(data.quarantine)) setItems(data.quarantine);
        else setItems((prev) => prev.filter((i) => i.id !== item.id));
        if (Array.isArray(data.devices)) setDevices(data.devices);
        if (data.ingest) setIngestStats(data.ingest);
        setMessage({
          text: `Mapped alias "${data.mappedAlias}" to device ${data.resolvedDeviceId} and ingested its price into observations. Remaining quarantined: ${data.remainingQuarantined}`,
          tone: "good",
        });
      }
    } catch {
      setMessage({ text: "Network error while resolving item.", tone: "warn" });
    } finally {
      setLoadingId(null);
    }
  };

  const enrolSingleItem = async (item: QuarantinedItem) => {
    setLoadingId(item.id);
    setMessage(null);

    try {
      const res = await fetch(`${basePath}/api/quarantine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enrol",
          quarantineId: item.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error || "Could not enrol device automatically.", tone: "warn" });
      } else {
        if (Array.isArray(data.quarantine)) setItems(data.quarantine);
        else setItems((prev) => prev.filter((i) => i.id !== item.id));
        if (Array.isArray(data.devices)) setDevices(data.devices);
        if (data.ingest) setIngestStats(data.ingest);
        setMessage({
          text: `Enrolled new canonical device "${data.resolvedDeviceId}" into master catalogue and ingested "${data.mappedAlias}" into observations.`,
          tone: "good",
        });
      }
    } catch {
      setMessage({ text: "Network error while enrolling new device.", tone: "warn" });
    } finally {
      setLoadingId(null);
    }
  };

  const enrolAllItems = async () => {
    setEnrollingAll(true);
    setMessage(null);
    try {
      const res = await fetch(`${basePath}/api/quarantine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enrol_all" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error || "Failed to bulk-enrol devices.", tone: "warn" });
      } else {
        if (Array.isArray(data.quarantine)) setItems(data.quarantine);
        if (Array.isArray(data.devices)) setDevices(data.devices);
        if (data.ingest) setIngestStats(data.ingest);
        setMessage({
          text: `Enrolled ${data.enrolledCount} new canonical device(s) into the master catalogue and re-ran Cashify scraper ingestion. Remaining quarantined: ${data.remainingQuarantined}`,
          tone: "good",
        });
      }
    } catch {
      setMessage({ text: "Network error during bulk enrolment.", tone: "warn" });
    } finally {
      setEnrollingAll(false);
    }
  };

  const triggerIngest = async () => {
    setIngesting(true);
    setMessage(null);
    try {
      const qRes = await fetch(`${basePath}/api/quarantine?refresh=1`);
      if (qRes.ok) {
        const qData = await qRes.json();
        setItems(qData.quarantine || []);
        if (Array.isArray(qData.devices)) setDevices(qData.devices);
        if (qData.ingest) setIngestStats(qData.ingest);
        setMessage({
          text: `Synchronized with Cashify scraper database feed (${qData.ingest?.totalRowsScraped ?? 0} raw rows, ${qData.ingest?.observationsCaptured ?? 0} observations captured).`,
          tone: "good",
        });
      }
    } catch {
      setMessage({ text: "Could not trigger sync.", tone: "warn" });
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {ingestStats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="panel p-4">
            <div className="label">Scraper Feed (cashify_buy_prices)</div>
            <div className="mono mt-1 text-[22px] font-extrabold text-[var(--text)]">
              {ingestStats.totalRowsScraped.toLocaleString()}
            </div>
            <div className="text-[11.5px] text-[var(--muted)]">raw rows pulled from PostgreSQL</div>
          </div>
          <div className="panel p-4">
            <div className="label">Normalized Observations</div>
            <div className="mono mt-1 text-[22px] font-extrabold text-[var(--green-ink)]">
              {ingestStats.observationsCaptured.toLocaleString()}
            </div>
            <div className="text-[11.5px] text-[var(--muted)]">matched to device &amp; grade ladder</div>
          </div>
          <div className="panel p-4">
            <div className="label">Quarantined Queue</div>
            <div
              className="mono mt-1 text-[22px] font-extrabold"
              style={{ color: items.length > 0 ? "var(--amber-ink)" : "var(--green-ink)" }}
            >
              {items.length.toLocaleString()}
            </div>
            <div className="text-[11.5px] text-[var(--muted)]">awaiting alias mapping or enrolment</div>
          </div>
          <div className="panel p-4">
            <div className="label">Catalogue Match Rate</div>
            <div className="mono mt-1 text-[22px] font-extrabold text-[var(--text)]">
              {Math.round((ingestStats.matchRate || 0) * 100)}%
            </div>
            <div className="text-[11.5px] text-[var(--muted)]">run: {ingestStats.runId}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="label">Ingestion Gate &amp; Quarantine Queue</div>
          <div className="text-[13.5px] text-[var(--muted)] mt-0.5">
            {items.length === 0
              ? "No active quarantined rows. All scraper rows are resolved."
              : `${items.length} uncatalogued or ambiguous rows awaiting operator resolution.`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {items.some((i) => i.reason === "device_unresolved") && (
            <button
              type="button"
              onClick={enrolAllItems}
              disabled={enrollingAll}
              className="px-3.5 py-1.5 text-[12px] font-bold text-white transition-colors cursor-pointer"
              style={{ background: "var(--brand)" }}
            >
              {enrollingAll ? "Enrolling Models..." : "Enrol All New Models into Catalogue"}
            </button>
          )}
          <button
            type="button"
            onClick={triggerIngest}
            disabled={ingesting}
            className="px-3.5 py-1.5 text-[12px] font-semibold border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-2)] transition-colors cursor-pointer"
          >
            {ingesting ? "Ingesting..." : "Refresh Scraper Queue"}
          </button>
        </div>
      </div>

      {message && (
        <div
          className="p-3.5 text-[13px] border-l-[3px] panel"
          style={{
            borderColor: message.tone === "good" ? "var(--green-ink)" : "var(--amber-ink)",
            background: message.tone === "good" ? "var(--green-soft)" : "rgba(255,213,40,0.15)",
          }}
        >
          {message.text}
        </div>
      )}

      {items.length === 0 ? (
        <div className="panel p-8 text-center">
          <div className="mono text-[28px] font-extrabold text-[var(--green-ink)]">0</div>
          <div className="font-bold text-[15px] mt-1">Catalogue is fully resolved</div>
          <p className="text-[13px] text-[var(--muted)] max-w-md mx-auto mt-1">
            Every listing string from Cashify India and other programmes has been mapped to a canonical handset.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="panel p-4 border border-[var(--border)] space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="mono px-2 py-0.5 text-[10.5px] font-bold uppercase rounded-[2px]"
                    style={{
                      background: item.reason === "device_unresolved" ? "var(--amber-ink)" : "var(--brand)",
                      color: "#fff",
                    }}
                  >
                    {item.reason}
                  </span>
                  <span className="mono text-[11px] text-[var(--muted)]">Program: {item.program_id}</span>
                  <span className="mono text-[11px] text-[var(--muted)]">Run: {item.run_id}</span>
                </div>
                <div className="mono text-[11px] text-[var(--muted)]">
                  {new Date(item.observed_at).toLocaleString()}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="label">Raw Scraped String</div>
                  <div className="font-bold text-[14.5px] mt-0.5 text-[var(--text)]">
                    &ldquo;{item.device_text}&rdquo;
                  </div>
                  <div className="text-[12px] text-[var(--muted)] mt-1">
                    Grade: <span className="font-semibold">{item.condition_text || "—"}</span> · Price:{" "}
                    <span className="font-semibold mono">
                      {item.currency} {item.price_major ? item.price_major.toLocaleString() : "unquoted"}
                    </span>
                  </div>
                  <div className="text-[12px] text-[var(--bad-ink)] mt-1">{item.why}</div>
                </div>

                <div className="bg-[var(--bg-soft)] p-3 border border-[var(--border-soft)] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="label">Map Alias or Enrol in Master Catalogue</div>
                    <button
                      type="button"
                      onClick={() => enrolSingleItem(item)}
                      disabled={loadingId === item.id}
                      className="px-2.5 py-1 text-[11px] font-bold border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-white transition-colors cursor-pointer"
                    >
                      {loadingId === item.id ? "Working..." : "+ Enrol as New Device"}
                    </button>
                  </div>

                  {item.candidate_ids.length > 0 && (
                    <div className="text-[11.5px] text-[var(--muted)]">
                      Suggested candidates:{" "}
                      {item.candidate_ids.map((cid, i) => (
                        <button
                          key={cid}
                          type="button"
                          onClick={() => handleDeviceChange(item.id, cid)}
                          className="font-semibold text-[var(--brand)] hover:underline mr-1 cursor-pointer"
                        >
                          {cid}{i < item.candidate_ids.length - 1 ? "," : ""}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedDevices[item.id] || item.candidate_ids[0] || ""}
                      onChange={(e) => handleDeviceChange(item.id, e.target.value)}
                      className="inp text-[12.5px] py-1.5"
                    >
                      <option value="">Select target canonical device...</option>
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label} ({d.id})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => resolveItem(item)}
                      disabled={loadingId === item.id}
                      className="px-3 py-1.5 text-[12px] font-bold text-white shrink-0 cursor-pointer"
                      style={{ background: "var(--brand)" }}
                    >
                      {loadingId === item.id ? "Mapping..." : "Map & Resolve"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
