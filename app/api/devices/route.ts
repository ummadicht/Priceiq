import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/apiAuth.ts";
import { listDevices } from "@/lib/repo.ts";
import { brandsOf, modelsOf, skusOf, searchDevices, skuLabel, fullLabel, type SearchableDevice } from "@/core/search.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * Device lookup against PostgreSQL 'price_iq.devices'.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: auth.status });
  await seed();

  const q = req.nextUrl.searchParams;
  const devices = await listDevices();

  const shape = (d: SearchableDevice) => ({
    id: d.id, brand: d.brand, model: d.model, storageGb: d.storageGb, ramGb: d.ramGb,
    sku: skuLabel(d), label: fullLabel(d),
  });

  const text = q.get("q");
  if (text) {
    return NextResponse.json({
      query: text,
      results: searchDevices(devices, text, Number(q.get("limit")) || 40).map((h) => shape(h.device)),
    });
  }

  const brand = q.get("brand");
  const model = q.get("model");

  if (brand && model) return NextResponse.json({ skus: skusOf(devices, brand, model).map(shape) });
  if (brand) return NextResponse.json({ models: modelsOf(devices, brand) });
  return NextResponse.json({ brands: brandsOf(devices), total: devices.length });
}
