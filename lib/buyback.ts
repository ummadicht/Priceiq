import { query, queryOne } from "./db.ts";
import { listDevices, type DeviceRow } from "./repo.ts";
import { mapCondition } from "../core/condition.ts";
import { CASHIFY_INDIA_LADDER } from "../core/ladders/cashifyIndia.ts";
import { resolveDevice, type CanonicalDevice } from "../core/device.ts";

export interface BuybackGradePrice {
  deviceId: string;
  brand: string;
  model: string;
  storageGb: number;
  conditionLabel: string;
  conditionSpan: { lo: string; hi: string } | null;
  cashifyPriceMinor: number;
  cashifyPriceMajor: number;
  currency: string;
  observedAt: string;
  sourceUrl: string;
}

export interface RateCardItem {
  deviceId?: string;
  modelText?: string;
  grade: string;
  offeredPriceMajor: number;
  currency?: string;
}

export interface BuybackMarginRow {
  deviceId: string;
  deviceLabel: string;
  grade: string;
  offeredPriceMajor: number;
  marketBuybackPriceMajor: number | null;
  currency: string;
  spreadMajor: number | null;
  marginPct: number | null;
  verdict: "profitable" | "loss" | "unquoted";
  observedAt: string | null;
  note: string;
}

export interface BuybackMarginReport {
  partnerId?: string;
  evaluatedAt: string;
  totalEvaluated: number;
  profitableCount: number;
  lossCount: number;
  unquotedCount: number;
  avgMarginPct: number | null;
  rows: BuybackMarginRow[];
}

/**
 * Retrieve latest scraped buyback prices by grade from Cashify India observations.
 */
export async function getBuybackPricesByGrade(deviceId?: string): Promise<BuybackGradePrice[]> {
  const devices = await listDevices();
  const devMap = new Map<string, DeviceRow>();
  for (const d of devices) devMap.set(d.id, d);

  const whereClause = deviceId
    ? "WHERE o.program_id = 'cashify-in' AND o.device_id = $1"
    : "WHERE o.program_id = 'cashify-in'";
  const params = deviceId ? [deviceId] : [];

  const rows = await query<{
    device_id: string;
    condition_label: string;
    amount_minor: number;
    currency: string;
    observed_at: string;
    source_url: string;
  }>(
    `SELECT DISTINCT ON (o.device_id, o.condition_label)
            o.device_id, o.condition_label, o.amount_minor, o.currency, o.observed_at, o.source_url
       FROM observations o
      ${whereClause}
      ORDER BY o.device_id, o.condition_label, o.observed_at DESC`,
    params
  );

  return rows.map((r) => {
    const d = devMap.get(r.device_id);
    const span = mapCondition(CASHIFY_INDIA_LADDER, r.condition_label);
    const amountMinor = Number(r.amount_minor || 0);
    return {
      deviceId: r.device_id,
      brand: d?.brand || "",
      model: d?.model || "",
      storageGb: d?.storageGb || 0,
      conditionLabel: r.condition_label,
      conditionSpan: span,
      cashifyPriceMinor: amountMinor,
      cashifyPriceMajor: amountMinor / 100,
      currency: r.currency || "INR",
      observedAt: r.observed_at,
      sourceUrl: r.source_url,
    };
  });
}

/**
 * Compare an uploaded partner rate card against live Cashify scraped buyback prices by grade
 * to compute live margins.
 */
export async function evaluateBuybackMargins(
  rateCard: RateCardItem[],
  partnerId?: string
): Promise<BuybackMarginReport> {
  const devices = await listDevices();
  const catalogue: CanonicalDevice[] = devices.map((d) => ({
    id: d.id,
    brand: d.brand,
    model: d.model,
    storageGb: d.storageGb,
    ramGb: d.ramGb,
    releaseYear: d.releaseYear,
    aliases: d.aliases,
  }));

  const cashifyPrices = await getBuybackPricesByGrade();
  const priceLookup = new Map<string, BuybackGradePrice>();
  for (const cp of cashifyPrices) {
    const key = `${cp.deviceId}|${cp.conditionLabel.toLowerCase().trim()}`;
    priceLookup.set(key, cp);
  }

  const rows: BuybackMarginRow[] = [];
  let profitableCount = 0;
  let lossCount = 0;
  let unquotedCount = 0;
  let sumMarginPct = 0;
  let marginPctCount = 0;

  for (const item of rateCard) {
    let resolvedId = item.deviceId;
    let deviceLabel = item.deviceId || item.modelText || "Unknown device";

    if (!resolvedId && item.modelText) {
      const res = resolveDevice(item.modelText, catalogue);
      if (res.status === "matched") {
        resolvedId = res.device.id;
        deviceLabel = `${res.device.brand} ${res.device.model} ${res.device.storageGb}GB`;
      }
    } else if (resolvedId) {
      const d = catalogue.find((x) => x.id === resolvedId);
      if (d) deviceLabel = `${d.brand} ${d.model} ${d.storageGb}GB`;
    }

    const normGrade = item.grade.toLowerCase().trim();
    const key = resolvedId ? `${resolvedId}|${normGrade}` : "";
    let cashifyMatch = key ? priceLookup.get(key) : undefined;

    // Fallback: match by canonical condition span if grade label string varies (e.g. Good vs Grade B)
    if (!cashifyMatch && resolvedId) {
      const itemSpan = mapCondition(CASHIFY_INDIA_LADDER, item.grade);
      if (itemSpan) {
        cashifyMatch = cashifyPrices.find(
          (cp) =>
            cp.deviceId === resolvedId &&
            cp.conditionSpan &&
            cp.conditionSpan.lo === itemSpan.lo &&
            cp.conditionSpan.hi === itemSpan.hi
        );
      }
    }

    const offeredPrice = Number(item.offeredPriceMajor);
    const currency = item.currency || cashifyMatch?.currency || "INR";

    if (cashifyMatch && Number.isFinite(offeredPrice) && offeredPrice > 0) {
      const marketPrice = cashifyMatch.cashifyPriceMajor;
      const spread = marketPrice - offeredPrice;
      const marginPct = Math.round(((marketPrice - offeredPrice) / offeredPrice) * 1000) / 10;
      const verdict = spread >= 0 ? "profitable" : "loss";

      if (verdict === "profitable") profitableCount++;
      else lossCount++;

      sumMarginPct += marginPct;
      marginPctCount++;

      rows.push({
        deviceId: resolvedId || "unknown",
        deviceLabel,
        grade: item.grade,
        offeredPriceMajor: offeredPrice,
        marketBuybackPriceMajor: marketPrice,
        currency,
        spreadMajor: Math.round(spread * 100) / 100,
        marginPct,
        verdict,
        observedAt: cashifyMatch.observedAt,
        note: `Real-world Cashify buyback quote: ${currency} ${marketPrice.toLocaleString()}`,
      });
    } else {
      unquotedCount++;
      rows.push({
        deviceId: resolvedId || "unknown",
        deviceLabel,
        grade: item.grade,
        offeredPriceMajor: offeredPrice,
        marketBuybackPriceMajor: null,
        currency,
        spreadMajor: null,
        marginPct: null,
        verdict: "unquoted",
        observedAt: null,
        note: "No matching Cashify India buyback price for this device and grade",
      });
    }
  }

  return {
    partnerId,
    evaluatedAt: new Date().toISOString(),
    totalEvaluated: rateCard.length,
    profitableCount,
    lossCount,
    unquotedCount,
    avgMarginPct: marginPctCount > 0 ? Math.round((sumMarginPct / marginPctCount) * 10) / 10 : null,
    rows,
  };
}
