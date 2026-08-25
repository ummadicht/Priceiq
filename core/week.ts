/**
 * WEEKS — the reporting rhythm for hand-entered prices.
 *
 * Manual entry is irregular by nature. Somebody enters Tuesday's wholesale
 * number this week, forgets next week, enters twice the week after, and comes
 * back a fortnight later. Any honest week-on-week view has to survive that,
 * because the alternative is a chart that quietly lies in two specific ways:
 *
 *   1. TWO ENTRIES IN ONE WEEK. Which one is "the week"? Averaging them invents
 *      a price nobody quoted. The last entry wins here — with manual entry a
 *      later figure is a correction or a refinement of an earlier one, not an
 *      independent sample of the same thing.
 *
 *   2. A MISSED WEEK. The tempting shortcut is to compare against whatever the
 *      previous entry was and call it week-on-week. But "up 5% since a
 *      fortnight ago" is a different claim from "up 5% week on week", and
 *      collapsing them makes a slow drift look like a sudden move. So a
 *      comparison that spans a gap is MARKED as spanning a gap, and carries the
 *      number of weeks it actually covers.
 *
 * ISO-8601 weeks throughout: Monday starts the week, and week 1 is the one
 * containing the first Thursday. That matters at new year, where 31 December
 * can legitimately belong to week 1 of the following year.
 */

export type WeekKey = string; // "2026-W34"

const DAY = 86_400_000;

function utcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** ISO week number and week-year for an instant. */
export function isoWeek(input: string | Date): { year: number; week: number; key: WeekKey } | null {
  const d0 = typeof input === "string" ? new Date(input) : input;
  if (!(d0 instanceof Date) || !Number.isFinite(d0.getTime())) return null;

  // Shift to the Thursday of this week: the ISO year is whatever year that
  // Thursday falls in, which is what makes the new-year cases come out right.
  const d = utcDate(d0);
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(d.getTime() + (3 - dayNum) * DAY);
  const year = thursday.getUTCFullYear();

  // Week 1 is the week containing 4 January, so count from that week's Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY);
  const week = Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * DAY)) + 1;

  return { year, week, key: `${year}-W${String(week).padStart(2, "0")}` };
}

/** The Monday that starts a given ISO week, as an ISO date string. */
export function weekStart(key: WeekKey): string | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]), week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4Day * DAY);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * DAY).toISOString().slice(0, 10);
}

/** Whole weeks between two week keys. Negative if `b` precedes `a`. */
export function weeksBetween(a: WeekKey, b: WeekKey): number | null {
  const sa = weekStart(a), sb = weekStart(b);
  if (!sa || !sb) return null;
  return Math.round((Date.parse(sb) - Date.parse(sa)) / (7 * DAY));
}

export type WeekPoint = {
  week: WeekKey;
  /** Minor units. The LAST entry of the week — see the note at the top. */
  amountMinor: number;
  currency: string;
  /** How many entries were made that week. >1 means the earlier ones were superseded. */
  entries: number;
  /** The instant of the representative entry. */
  at: string;
  by: string;
};

export type WeeklyInput = {
  observedAt: string;
  amountMinor: number;
  currency: string;
  enteredBy?: string;
};

/** Collapse a stream of entries into one representative point per ISO week. */
export function toWeekly(items: WeeklyInput[]): WeekPoint[] {
  const buckets = new Map<WeekKey, WeekPoint>();
  for (const it of items) {
    const w = isoWeek(it.observedAt);
    if (!w) continue;
    const existing = buckets.get(w.key);
    if (!existing) {
      buckets.set(w.key, {
        week: w.key, amountMinor: it.amountMinor, currency: it.currency,
        entries: 1, at: it.observedAt, by: it.enteredBy || "",
      });
      continue;
    }
    existing.entries += 1;
    // Last entry wins — a later figure supersedes an earlier one.
    if (it.observedAt >= existing.at) {
      existing.amountMinor = it.amountMinor;
      existing.currency = it.currency;
      existing.at = it.observedAt;
      existing.by = it.enteredBy || "";
    }
  }
  return [...buckets.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export type WoWKind = "first" | "unchanged" | "up" | "down" | "currency_changed";

export type WoWPoint = WeekPoint & {
  kind: WoWKind;
  previousWeek: WeekKey | null;
  deltaMinor: number;
  pctChange: number | null;
  /**
   * Weeks actually spanned by the comparison. 1 is a true week-on-week move;
   * anything larger means the run had a gap and the label must say so.
   */
  spanWeeks: number;
  spansGap: boolean;
};

/**
 * Week-on-week movement across a series of weekly points.
 *
 * Compares each week to the most recent PRECEDING WEEK THAT HAS DATA, and
 * reports how many weeks that comparison actually spans. A three-week span is
 * still worth showing — it is just not a week-on-week number, and calling it
 * one is how a slow drift gets mistaken for a sudden move.
 */
export function weekOnWeek(points: WeekPoint[]): WoWPoint[] {
  const sorted = [...points].sort((a, b) => a.week.localeCompare(b.week));
  const out: WoWPoint[] = [];
  let prev: WeekPoint | null = null;

  for (const p of sorted) {
    if (!prev) {
      out.push({ ...p, kind: "first", previousWeek: null, deltaMinor: 0, pctChange: null, spanWeeks: 0, spansGap: false });
      prev = p;
      continue;
    }
    const span = weeksBetween(prev.week, p.week) ?? 1;
    const base = {
      ...p, previousWeek: prev.week, spanWeeks: span, spansGap: span > 1,
    };

    if (p.currency !== prev.currency) {
      // Re-denomination is not a price move. Same rule as the observation
      // module: computing a percentage across it manufactures a fake collapse.
      out.push({ ...base, kind: "currency_changed", deltaMinor: 0, pctChange: null });
      prev = p;
      continue;
    }

    const delta = p.amountMinor - prev.amountMinor;
    if (delta === 0) {
      out.push({ ...base, kind: "unchanged", deltaMinor: 0, pctChange: 0 });
    } else {
      const pct = prev.amountMinor === 0 ? null : Math.round((delta / prev.amountMinor) * 10000) / 100;
      out.push({ ...base, kind: delta > 0 ? "up" : "down", deltaMinor: delta, pctChange: pct });
    }
    prev = p;
  }
  return out;
}

/** Human label for a movement, honest about the span it covers. */
export function wowLabel(p: WoWPoint): string {
  if (p.kind === "first") return "first entry";
  if (p.kind === "currency_changed") return "currency changed — not a price move";
  const dir = p.kind === "unchanged" ? "unchanged" : p.kind === "up" ? "up" : "down";
  if (p.kind === "unchanged") return p.spansGap ? `unchanged over ${p.spanWeeks} weeks` : "unchanged";
  const pct = p.pctChange === null ? "" : ` ${Math.abs(p.pctChange)}%`;
  return p.spansGap ? `${dir}${pct} over ${p.spanWeeks} weeks` : `${dir}${pct} week on week`;
}

/** The week an entry form should default to. */
export function currentWeek(now: Date = new Date()): WeekKey {
  return isoWeek(now)!.key;
}
