import { seed } from "@/lib/seed.ts";
import { requireSuperIQ } from "@/lib/guard.ts";
import EntryForm from "@/components/EntryForm";

export const dynamic = "force-dynamic";

export default async function Entry() {
  await requireSuperIQ("/priceiq/entry");
  seed();
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

  return (
    <>
      <div className="editorial-rule mb-4 w-full max-w-[420px]" />
      <h1 className="text-[28px] font-extrabold tracking-[-.04em]">Record a price</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--muted)]">
        Hand entry is a first-class source here, not a stopgap. A person reading a real quote and
        typing it in exercises the whole pipeline against real numbers today — nothing downstream
        can tell the difference, and the figure carries your name and your stated source.
      </p>
      <div className="mt-6">
        <EntryForm base={base} />
      </div>
    </>
  );
}
