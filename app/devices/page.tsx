import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { listDevices } from "@/lib/repo.ts";
import { brandsOf } from "@/core/search.ts";
import DevicePickerClient from "@/components/DevicePickerClient";
import SeedBanner from "../banner";

export const dynamic = "force-dynamic";

export default async function Devices() {
  await requireSuperIQ("/priceiq/devices");
  await seed();
  const devices = await listDevices();
  const brands = brandsOf(devices);
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const withRam = devices.filter((d) => d.ramGb !== undefined).length;

  return (
    <>
      <SeedBanner />
      <div className="editorial-rule mb-4 w-full max-w-[420px]" />
      <h1 className="text-[28px] font-extrabold tracking-[-.04em]">Device catalogue</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--muted)]">
        {devices.length.toLocaleString()} canonical devices across {brands.length} manufacturers —
        the list every programme&apos;s listing string is resolved against. Storage is part of the
        identity, and so is RAM on the {withRam.toLocaleString()} devices whose sources price it
        separately.
      </p>

      <div className="mt-6">
        <DevicePickerClient
          base={base}
          current={null}
          path="/compare"
        />
      </div>

      <div className="panel mt-5 p-5">
        <div className="label">By manufacturer</div>
        <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {brands.map((b) => (
            <div key={b.brand} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-soft)] pb-1">
              <span className="text-[13px] font-semibold">{b.brand}</span>
              <span className="mono text-[12px] text-[var(--muted)]">{b.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
