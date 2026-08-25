"use client";

import { useRouter } from "next/navigation";
import DevicePicker from "./DevicePicker";

/**
 * Bridges the picker to routing.
 *
 * Takes the destination as DATA — a path and the query to carry — not as a
 * callback. A server component cannot hand a function to a client one, and the
 * first version tried: both pages 500'd with "Functions cannot be passed
 * directly to Client Components". Serialisable props are the boundary.
 */
export default function DevicePickerClient({
  base, current, path, carry,
}: {
  base: string;
  current: { id: string; label: string } | null;
  /** Where a pick lands, e.g. "/compare". */
  path: string;
  /** Query params to preserve, e.g. { market: "IN", channel: "wholesale" }. */
  carry?: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <DevicePicker
      base={base}
      current={current}
      onPick={(id) => {
        const q = new URLSearchParams({ ...(carry || {}), device: id });
        router.push(`${path}?${q.toString()}`);
      }}
    />
  );
}
