import Link from "next/link";
import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import { listDevices } from "@/lib/repo.ts";
import SeedBanner from "../banner";

export const dynamic = "force-dynamic";

export default async function Devices() {
  await requireSuperIQ("/priceiq/devices");
  seed();
  const devices = listDevices();
  return (
    <>
      <SeedBanner />
      <h1 className="text-[26px] font-extrabold tracking-tight">Device catalogue</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-[var(--muted)]">
        The canonical list every programme&apos;s listing string is resolved against. Storage is part of
        the identity, not an attribute — a 256GB and a 512GB handset are different devices with
        different prices, and a listing that omits storage is reported as ambiguous rather than guessed at.
      </p>
      <div className="panel mt-6 overflow-x-auto p-4">
        <table>
          <thead>
            <tr><th>Device</th><th>Storage</th><th>Released</th><th>Model numbers</th><th>Canonical id</th><th></th></tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td className="font-semibold">{d.brand} {d.model}</td>
                <td className="mono">{d.storageGb >= 1024 ? `${d.storageGb / 1024}TB` : `${d.storageGb}GB`}</td>
                <td className="mono">{d.releaseYear}</td>
                <td className="mono text-[12px] text-[var(--muted)]">{d.aliases.join(", ") || "—"}</td>
                <td className="mono text-[11.5px] text-[var(--muted)]">{d.id}</td>
                <td style={{ textAlign: "right" }}>
                  <Link href={`/compare?device=${d.id}`} className="text-[12.5px] font-semibold text-[var(--brand)]">
                    Compare →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
