import { provenance } from "@/lib/provenance.ts";

/**
 * Shown on every screen that displays a number.
 *
 * It reports the ACTUAL split rather than a blanket disclaimer. Once one real
 * source has landed, "everything here is an example" is false — and a warning
 * that is false in one direction gets ignored in the other, on exactly the
 * screens that are still invented.
 */
export default function SeedBanner() {
  const p = provenance();

  if (p.realObservations === 0) {
    return (
      <div className="mb-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-[3px] px-4 py-2.5 text-[12.5px]"
           style={{ borderColor: "var(--gold-2)", background: "color-mix(in srgb, var(--yellow) 14%, transparent)" }}>
        <b style={{ color: "var(--amber-ink)" }}>Worked example data.</b>
        <span className="text-[var(--muted)]">
          No programme is cleared for collection yet, so none of these prices were observed.
          The pipeline is real; the numbers are illustrative.
        </span>
      </div>
    );
  }

  const names = p.realPrograms.map((r) => r.name).join(", ");
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-[3px] px-4 py-2.5 text-[12.5px]"
         style={{ borderColor: "var(--green-ink)", background: "var(--green-soft)" }}>
      <b style={{ color: "var(--green-ink)" }}>
        {p.realObservations.toLocaleString()} real price{p.realObservations === 1 ? "" : "s"} from {names}.
      </b>
      <span className="text-[var(--muted)]">
        Every other programme here is still worked-example data
        ({p.seededObservations.toLocaleString()} illustrative prices across {p.seededPrograms} programmes) —
        check the source before trusting a comparison that mixes them.
      </span>
    </div>
  );
}
