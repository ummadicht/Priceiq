/**
 * CONDITION LADDERS — why two prices are usually not comparable.
 *
 * Every trade-in program invents its own grades. One says Flawless / Excellent
 * / Good / Fair / Broken. Apple famously offers barely two. A recycler might
 * have seven. Put their prices side by side and the comparison reads as
 * authoritative while being, strictly, meaningless:
 *
 *     CellMyPhone   NZD 824   "Flawless"
 *     Noel Leeming  NZD 890   "Excellent"
 *
 * Is 890 the better offer? Unanswerable until you know whether Excellent is the
 * same handset condition as Flawless, better, or worse.
 *
 * THE MODELLING DECISION THAT MATTERS. A program grade is mapped to a SPAN of
 * the canonical ladder, not a point. A two-rung program cannot express
 * five-rung precision: when Apple says "Good" it is covering everything from
 * pristine to lightly worn, and pretending that is exactly canonical "good"
 * invents precision that the program never offered.
 *
 * Spans then make comparability an honest, computable property. Two prices are
 * EXACT when their spans are identical, APPROXIMATE when they overlap, and
 * INCOMPARABLE when they do not — and the last one is a real answer that the UI
 * must be willing to show, rather than quietly ranking two numbers that
 * describe different phones.
 */

/** Best to worst. Order is load-bearing — every span comparison indexes it. */
export const CANONICAL_ORDER = ["flawless", "good", "fair", "poor", "broken"] as const;
export type CanonicalCondition = (typeof CANONICAL_ORDER)[number];

export const CONDITION_LABEL: Record<CanonicalCondition, string> = {
  flawless: "Flawless",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  broken: "Broken",
};

/** An inclusive range of the canonical ladder. `lo` is the BEST end. */
export type ConditionSpan = { lo: CanonicalCondition; hi: CanonicalCondition };

export type LadderRung = { label: string; span: ConditionSpan };
export type ProgramLadder = { programId: string; rungs: LadderRung[] };

const rank = (c: CanonicalCondition) => CANONICAL_ORDER.indexOf(c);

export function spanOf(lo: CanonicalCondition, hi: CanonicalCondition = lo): ConditionSpan {
  // Normalised so a ladder author cannot create an inverted span by accident.
  return rank(lo) <= rank(hi) ? { lo, hi } : { lo: hi, hi: lo };
}

export function spanWidth(s: ConditionSpan): number {
  return rank(s.hi) - rank(s.lo) + 1;
}

export function describeSpan(s: ConditionSpan): string {
  return s.lo === s.hi ? CONDITION_LABEL[s.lo] : `${CONDITION_LABEL[s.lo]}–${CONDITION_LABEL[s.hi]}`;
}

/**
 * A program's own grade label → canonical span.
 *
 * Matching is case- and space-insensitive because programs are inconsistent
 * with their own labels between pages ("Like New", "like-new", "LIKE NEW").
 * Returns null rather than a default: an unrecognised grade is a gap in the
 * ladder definition, and defaulting it to the middle of the scale would put a
 * fabricated condition on a real price.
 */
export function mapCondition(ladder: ProgramLadder, label: string): ConditionSpan | null {
  const want = norm(label);
  if (!want) return null;
  for (const r of ladder.rungs) if (norm(r.label) === want) return r.span;
  return null;
}

function norm(s: string): string {
  /* PLUS AND MINUS ARE PART OF A GRADE — except when they are punctuation.
   *
   * "B-" and "B" are different rungs, and collapsing them filed every B- price
   * a grade too high. But "good-condition" and "good condition" are the same
   * label written two ways, and keeping that hyphen broke the match.
   *
   * The distinction is positional: a modifier TRAILS its grade ("b-", "a+"),
   * while punctuation sits BETWEEN two words. So internal hyphens and pluses
   * become spaces first, and only the trailing ones survive. */
  return (s || "")
    .toLowerCase()
    .replace(/([a-z0-9])[+-]([a-z0-9])/g, "$1 $2")
    .replace(/[^a-z0-9+-]+/g, " ")
    .replace(/\s+/g, " ")
    // A modifier separated from its grade by a stray space ("B -") is still
    // that grade's modifier. Spreadsheets are typed by people.
    .replace(/\s+([+-])/g, "$1")
    .trim();
}

export type Comparability = "exact" | "approximate" | "incomparable";

/**
 * Can these two graded prices be put side by side?
 *
 * "approximate" is the common case across programs and is fine to show — as
 * long as it is SHOWN. The failure this prevents is a ranked table that mixes
 * exact and approximate rows without saying which is which.
 */
export function comparability(a: ConditionSpan, b: ConditionSpan): Comparability {
  if (a.lo === b.lo && a.hi === b.hi) return "exact";
  const overlaps = rank(a.lo) <= rank(b.hi) && rank(b.lo) <= rank(a.hi);
  return overlaps ? "approximate" : "incomparable";
}

/** Plain-language reason, for a tooltip on the comparison row. */
export function comparabilityNote(a: ConditionSpan, b: ConditionSpan): string {
  const c = comparability(a, b);
  if (c === "exact") return `Both quoted at ${describeSpan(a)}.`;
  if (c === "incomparable") {
    return `${describeSpan(a)} and ${describeSpan(b)} do not overlap — these are different device conditions.`;
  }
  const wider = spanWidth(a) >= spanWidth(b) ? a : b;
  return `Overlapping but not identical: ${describeSpan(a)} vs ${describeSpan(b)}. The ${describeSpan(wider)} grade is the coarser of the two.`;
}

/**
 * Does a ladder cover the whole canonical scale exactly once?
 *
 * A gap means some real handset condition has no price. An overlap means one
 * condition has two prices and the ingest cannot tell which applies. Both are
 * definition bugs worth catching when the ladder is written rather than when a
 * customer asks why a number looks wrong.
 */
export type LadderCheck = {
  /** False only when something is genuinely broken. */
  ok: boolean;
  /** Conditions with NO price. Always a defect. */
  gaps: string[];
  /** Conditions priced by more than one rung. See below. */
  overlaps: string[];
  /** Duplicate labels — ingest could not tell two rungs apart. Always a defect. */
  duplicates: string[];
};

/**
 * Check a ladder definition.
 *
 * A GAP IS ALWAYS A BUG: some real handset condition has no price at all.
 *
 * AN OVERLAP USUALLY IS NOT. A programme grading in seven rungs against a
 * five-rung canonical scale must have adjacent rungs straddling canonical
 * boundaries — that is finer resolution than the canonical scale can express,
 * and it is exactly what spans exist to represent. Treating it as an error
 * would mean either rejecting the most detailed sources or flattening them into
 * a precision they do not have.
 *
 * Overlaps are still REPORTED, because they are why comparisons involving those
 * rungs come out `approximate` rather than `exact`, and somebody reading a
 * price table deserves to know which.
 */
export function validateLadder(ladder: ProgramLadder): LadderCheck {
  const gaps: string[] = [];
  const overlaps: string[] = [];
  const duplicates: string[] = [];

  const seen = new Map<CanonicalCondition, number>();
  for (const r of ladder.rungs) {
    for (let i = rank(r.span.lo); i <= rank(r.span.hi); i++) {
      const c = CANONICAL_ORDER[i];
      seen.set(c, (seen.get(c) || 0) + 1);
    }
  }
  for (const c of CANONICAL_ORDER) {
    const n = seen.get(c) || 0;
    if (n === 0) gaps.push(`no rung covers "${CONDITION_LABEL[c]}"`);
    else if (n > 1) overlaps.push(`"${CONDITION_LABEL[c]}" is priced by ${n} rungs`);
  }

  const labels = ladder.rungs.map((r) => norm(r.label));
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  for (const d of [...new Set(dupes)]) duplicates.push(`two rungs both read as "${d}"`);

  if (!ladder.rungs.length) gaps.push("ladder has no rungs");

  return { ok: gaps.length === 0 && duplicates.length === 0, gaps, overlaps, duplicates };
}
