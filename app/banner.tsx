/**
 * Shown on every screen that displays a number.
 *
 * No programme is cleared for collection, so nothing here was observed. A
 * price-intelligence product whose demo data looks exactly like its real data
 * is one screenshot away from somebody trading on a figure nobody measured —
 * so the label is permanent and prominent rather than a footnote.
 */
export default function SeedBanner() {
  return (
    <div
      className="mb-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-[3px] px-4 py-2.5 text-[12.5px]"
      style={{ borderColor: "var(--gold-2)", background: "color-mix(in srgb, var(--yellow) 14%, transparent)" }}
    >
      <b style={{ color: "var(--amber-ink)" }}>Worked example data.</b>
      <span className="text-[var(--muted)]">
        No programme is cleared for collection yet, so none of these prices were observed.
        The pipeline is real; the numbers are illustrative.
      </span>
    </div>
  );
}
