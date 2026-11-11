import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { listDevices } from "@/lib/repo.ts";
import { ingestCashifyScraper } from "@/lib/cashifyIngest.ts";
import { query, j } from "@/lib/db.ts";
import QuarantineClient from "@/components/QuarantineClient";
import SeedBanner from "../banner";
import type { QuarantinedItem } from "@/app/api/quarantine/route.ts";

export const dynamic = "force-dynamic";

export default async function Quarantine() {
  await requireSuperIQ("/priceiq/quarantine");
  await seed();
  const summary = await ingestCashifyScraper();

  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const devices = await listDevices();

  const rows = await query<Record<string, unknown>>(
    `SELECT id, program_id, run_id, reason, why, device_text, condition_text, price_major, currency, source_url, candidate_ids, observed_at, resolved_at
       FROM quarantine WHERE resolved_at IS NULL
      ORDER BY observed_at DESC, id DESC`
  );

  const items: QuarantinedItem[] = rows.map((r) => ({
    id: Number(r.id),
    program_id: String(r.program_id),
    run_id: String(r.run_id),
    reason: String(r.reason),
    why: String(r.why),
    device_text: String(r.device_text),
    condition_text: String(r.condition_text),
    price_major: r.price_major === null || r.price_major === undefined ? null : Number(r.price_major),
    currency: String(r.currency),
    source_url: String(r.source_url),
    candidate_ids: j<string[]>(typeof r.candidate_ids === "string" ? r.candidate_ids : JSON.stringify(r.candidate_ids || []), []),
    observed_at: String(r.observed_at),
    resolved_at: r.resolved_at ? String(r.resolved_at) : null,
  }));

  const deviceOptions = devices.map((d) => ({
    id: d.id,
    label: `${d.brand} ${d.model} ${d.storageGb}GB${d.ramGb ? ` / ${d.ramGb}GB RAM` : ""}`,
  }));

  return (
    <>
      <SeedBanner />
      <div className="editorial-rule mb-4 w-full max-w-[420px]" />
      <h1 className="text-[28px] font-extrabold tracking-[-.04em]">Quarantine Queue</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--muted)]">
        A row that cannot be resolved with certainty is quarantined, never approximated.
        When the Cashify scraper finds new models or messy strings in <span className="mono text-[12px]">cashify_buy_prices</span>,
        they arrive here safely so you can map their aliases or enrol new devices into the master catalogue.
      </p>

      <div className="mt-6">
        <QuarantineClient
          initialItems={items}
          initialDevices={deviceOptions}
          initialIngest={{
            runId: summary.runId,
            totalRowsScraped: summary.totalRowsScraped,
            observationsCaptured: summary.observationsCaptured,
            quarantinedCount: items.length,
            matchRate: summary.matchRate,
          }}
          basePath={base}
        />
      </div>
    </>
  );
}
