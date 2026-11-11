import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { query, queryOne, execute, j } from "@/lib/db.ts";
import { listDevices } from "@/lib/repo.ts";
import { seed } from "@/lib/seed.ts";
import { ingestCashifyScraper } from "@/lib/cashifyIngest.ts";
import { derive, enrolDevices } from "@/lib/enrol.ts";

export const dynamic = "force-dynamic";

export interface QuarantinedItem {
  id: number;
  program_id: string;
  run_id: string;
  reason: string;
  why: string;
  device_text: string;
  condition_text: string;
  price_major: number | null;
  currency: string;
  source_url: string;
  candidate_ids: string[];
  observed_at: string;
  resolved_at: string | null;
}

async function fetchQuarantineItems(includeResolved: boolean): Promise<QuarantinedItem[]> {
  const whereSql = includeResolved ? "" : "WHERE resolved_at IS NULL";
  const rows = await query<Record<string, unknown>>(
    `SELECT id, program_id, run_id, reason, why, device_text, condition_text, price_major, currency, source_url, candidate_ids, observed_at, resolved_at
       FROM quarantine ${whereSql}
      ORDER BY observed_at DESC, id DESC`
  );

  return rows.map((r) => ({
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
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const summary = await ingestCashifyScraper({ force });

  const includeResolved = req.nextUrl.searchParams.get("all") === "1";
  const items = await fetchQuarantineItems(includeResolved);
  const devices = await listDevices();

  return NextResponse.json({
    count: items.length,
    ingest: {
      runId: summary.runId,
      totalRowsScraped: summary.totalRowsScraped,
      observationsCaptured: summary.observationsCaptured,
      quarantinedCount: items.length,
      matchRate: summary.matchRate,
    },
    quarantine: items,
    devices: devices.map((d) => ({
      id: d.id,
      label: `${d.brand} ${d.model} ${d.storageGb}GB${d.ramGb ? ` / ${d.ramGb}GB RAM` : ""}`,
    })),
  });
}

/**
 * Resolve quarantined items by:
 * 1) Mapping raw device_text as an alias to an existing canonical device (action: "map" | default)
 * 2) Enrolling a new canonical device into the master catalogue from a quarantine row (action: "enrol")
 * 3) Bulk-enrolling all derivable unresolved quarantine models into the master catalogue (action: "enrol_all")
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req, "write");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "map");

  if (action === "enrol_all") {
    const unresolved = await fetchQuarantineItems(false);
    const rawStrings = unresolved.map((u) => u.device_text);
    const enrolled = await enrolDevices(rawStrings, { commit: true });

    for (const u of unresolved) {
      const d = derive(u.device_text);
      if (d) {
        const devRow = await queryOne<{ aliases: string }>("SELECT aliases FROM devices WHERE id = $1", [d.id]);
        const existingAliases = j<string[]>(
          typeof devRow?.aliases === "string" ? devRow.aliases : JSON.stringify(devRow?.aliases || []),
          []
        );
        if (!existingAliases.includes(u.device_text)) {
          existingAliases.push(u.device_text);
          await execute("UPDATE devices SET aliases = $1 WHERE id = $2", [JSON.stringify(existingAliases), d.id]);
        }
        await execute("UPDATE quarantine SET resolved_at = CURRENT_TIMESTAMP WHERE id = $1", [u.id]);
      }
    }

    const summary = await ingestCashifyScraper({ force: true });
    const items = await fetchQuarantineItems(false);
    const devices = await listDevices();

    return NextResponse.json({
      ok: true,
      action: "enrol_all",
      enrolledCount: enrolled.added,
      remainingQuarantined: items.length,
      quarantine: items,
      devices: devices.map((d) => ({
        id: d.id,
        label: `${d.brand} ${d.model} ${d.storageGb}GB${d.ramGb ? ` / ${d.ramGb}GB RAM` : ""}`,
      })),
      ingest: {
        runId: summary.runId,
        totalRowsScraped: summary.totalRowsScraped,
        observationsCaptured: summary.observationsCaptured,
        quarantinedCount: items.length,
        matchRate: summary.matchRate,
      },
    });
  }

  const quarantineId = Number(body.quarantineId);
  if (!quarantineId) {
    return NextResponse.json({ error: "'quarantineId' is required." }, { status: 400 });
  }

  const row = await queryOne<Record<string, unknown>>("SELECT * FROM quarantine WHERE id = $1", [quarantineId]);
  if (!row) {
    return NextResponse.json({ error: `Quarantine entry #${quarantineId} not found.` }, { status: 404 });
  }

  const rawDeviceText = String(row.device_text || "").trim();
  const cleanedAlias = rawDeviceText.replace(/^cashify\s+(?:grade\s+[a-e][+-]?\s+)?/i, "").trim();

  if (action === "enrol") {
    let derived = derive(rawDeviceText);
    if (!derived) {
      const fallbackText = /\d+\s*(?:gb|tb)\b/i.test(rawDeviceText) ? rawDeviceText : `${rawDeviceText} 128GB`;
      derived = derive(fallbackText);
      if (derived) {
        await enrolDevices([fallbackText], { commit: true });
      }
    } else {
      await enrolDevices([rawDeviceText], { commit: true });
    }

    if (!derived) {
      return NextResponse.json(
        { error: `Could not automatically derive brand/model/storage from "${rawDeviceText}". Map it to an existing device instead.` },
        { status: 422 }
      );
    }

    const targetDeviceId = derived.id;

    // Ensure the raw device text is also stored in the device's aliases
    const devRow = await queryOne<{ aliases: string }>("SELECT aliases FROM devices WHERE id = $1", [targetDeviceId]);
    const existingAliases = j<string[]>(
      typeof devRow?.aliases === "string" ? devRow.aliases : JSON.stringify(devRow?.aliases || []),
      []
    );
    for (const a of [rawDeviceText, cleanedAlias]) {
      if (a && !existingAliases.includes(a)) existingAliases.push(a);
    }
    await execute("UPDATE devices SET aliases = $1 WHERE id = $2", [JSON.stringify(existingAliases), targetDeviceId]);

    await execute(
      "UPDATE quarantine SET resolved_at = CURRENT_TIMESTAMP WHERE id = $1 OR (resolved_at IS NULL AND lower(device_text) = lower($2))",
      [quarantineId, rawDeviceText]
    );

    const summary = await ingestCashifyScraper({ force: true });
    const items = await fetchQuarantineItems(false);
    const devices = await listDevices();

    return NextResponse.json({
      ok: true,
      action: "enrol",
      quarantineId,
      resolvedDeviceId: targetDeviceId,
      mappedAlias: rawDeviceText,
      remainingQuarantined: items.length,
      quarantine: items,
      devices: devices.map((d) => ({
        id: d.id,
        label: `${d.brand} ${d.model} ${d.storageGb}GB${d.ramGb ? ` / ${d.ramGb}GB RAM` : ""}`,
      })),
      ingest: {
        runId: summary.runId,
        totalRowsScraped: summary.totalRowsScraped,
        observationsCaptured: summary.observationsCaptured,
        quarantinedCount: items.length,
        matchRate: summary.matchRate,
      },
    });
  }

  // Default action: "map" alias to an existing canonical device
  const deviceId = String(body.deviceId || "").trim();
  const customAlias = typeof body.alias === "string" ? body.alias.trim() : "";

  if (!deviceId) {
    return NextResponse.json(
      { error: "Both 'quarantineId' and 'deviceId' are required to map a quarantine row." },
      { status: 400 }
    );
  }

  const devRow = await queryOne<{ aliases: string }>("SELECT aliases FROM devices WHERE id = $1", [deviceId]);
  if (!devRow) {
    return NextResponse.json({ error: `Catalogue device '${deviceId}' not found.` }, { status: 404 });
  }

  const existingAliases = j<string[]>(
    typeof devRow.aliases === "string" ? devRow.aliases : JSON.stringify(devRow.aliases || []),
    []
  );

  const aliasesToAdd = [customAlias, rawDeviceText, cleanedAlias].filter(Boolean);
  for (const a of aliasesToAdd) {
    if (!existingAliases.includes(a)) {
      existingAliases.push(a);
    }
  }

  await execute("UPDATE devices SET aliases = $1 WHERE id = $2", [JSON.stringify(existingAliases), deviceId]);

  await execute(
    "UPDATE quarantine SET resolved_at = CURRENT_TIMESTAMP WHERE id = $1 OR (resolved_at IS NULL AND lower(device_text) = lower($2))",
    [quarantineId, rawDeviceText]
  );

  // Re-run Cashify scraper ingestion so the newly mapped alias converts matching scraped rows into observations
  const summary = await ingestCashifyScraper({ force: true });
  const items = await fetchQuarantineItems(false);
  const devices = await listDevices();

  return NextResponse.json({
    ok: true,
    action: "map",
    quarantineId,
    resolvedDeviceId: deviceId,
    mappedAlias: customAlias || rawDeviceText,
    remainingQuarantined: items.length,
    quarantine: items,
    devices: devices.map((d) => ({
      id: d.id,
      label: `${d.brand} ${d.model} ${d.storageGb}GB${d.ramGb ? ` / ${d.ramGb}GB RAM` : ""}`,
    })),
    ingest: {
      runId: summary.runId,
      totalRowsScraped: summary.totalRowsScraped,
      observationsCaptured: summary.observationsCaptured,
      quarantinedCount: items.length,
      matchRate: summary.matchRate,
    },
  });
}
