import { provenance } from "@/lib/provenance.ts";
import { queryOne } from "@/lib/db.ts";

/**
 * Shown on every screen that displays a number.
 * Connects directly to PostgreSQL 'price_iq' schema.
 */
export default async function SeedBanner() {
  const p = await provenance();
  const row = await queryOne<{ c: number }>("SELECT count(*) c FROM market_prices");
  const sell = Number(row?.c || 0);

  if (p.realObservations === 0) {
    return (
      <div className="mb-5 border-l-[3px] px-4 py-2.5 text-[12.5px]"
           style={{ borderColor: "var(--gold-2)", background: "color-mix(in srgb, var(--yellow) 14%, transparent)" }}>
        <b style={{ color: "var(--amber-ink)" }}>No prices yet.</b>{" "}
        <span className="text-[var(--muted)]">
          Import a source or record one by hand — nothing here is invented, so until then it is empty.
        </span>
      </div>
    );
  }

  const names = p.realPrograms.slice(0, 3).map((r) => r.name).join(", ");
  const more = p.realPrograms.length > 3 ? ` and ${p.realPrograms.length - 3} more` : "";

  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-[3px] px-4 py-2.5 text-[12.5px]"
         style={{ borderColor: "var(--green-ink)", background: "var(--green-soft)" }}>
      <b style={{ color: "var(--green-ink)" }}>
        {p.realObservations.toLocaleString()} observed price{p.realObservations === 1 ? "" : "s"} from {names}{more}.
      </b>
      <span className="text-[var(--muted)]">
        {sell === 0
          ? "No market prices yet — these say what programmes will pay, not what devices sell for, so no spread can be computed."
          : `${sell.toLocaleString()} market price${sell === 1 ? "" : "s"} on the sell side.`}
      </span>
    </div>
  );
}
