import { type Money, minorDigits } from "./money.ts";

/**
 * OBSERVATIONS AND CHANGE DETECTION.
 *
 * A program is polled on a cadence — every 48 hours, say. Most polls find
 * exactly the price the last poll found. Those are CONFIRMATIONS, not changes,
 * and the distinction is the entire product:
 *
 *     "Last change 3mo"   this program is asleep; its prices are stale
 *     "Last change 8h"    this program is actively repricing; watch it
 *
 * Treat every observation as a change and both readings collapse to "just now",
 * which is the single most useful column on the dashboard destroyed by the
 * cheapest possible bug. So `unchanged` is a first-class outcome here, and the
 * "last change" a program reports is the last time a number actually MOVED.
 *
 * Two other events matter and are routinely conflated with a price of zero:
 * a program DELISTING a device (it no longer quotes it at all) and RELISTING
 * it. "We stopped buying this phone" and "we will pay you nothing for this
 * phone" are different commercial facts, and a null is not a zero.
 */

export type Observation = {
  programId: string;
  deviceId: string;
  /** The program's own grade label, as scraped. */
  conditionLabel: string;
  /** null = the program did not quote this device on this run. Not zero. */
  price: Money | null;
  /** ISO timestamp of the observation. */
  observedAt: string;
  runId: string;
  sourceUrl: string;
};

export type ChangeKind =
  | "first_seen"
  | "unchanged"
  | "increase"
  | "decrease"
  | "delisted"
  | "relisted"
  | "currency_changed";

export type ChangeEvent = {
  kind: ChangeKind;
  at: string;
  from: Money | null;
  to: Money | null;
  /** Signed movement in minor units. Zero unless the kind is a real move. */
  deltaMinor: number;
  /** Signed percentage, rounded to 2dp. Null when a percentage is meaningless. */
  pctChange: number | null;
  why: string;
};

/**
 * Classify one observation against the one before it.
 *
 * A CURRENCY SWITCH IS NOT A PRICE MOVE. Programs re-denominate — a regional
 * site flips from USD to local currency, or a country changes its currency
 * outright — and computing a percentage across that boundary produces a
 * spectacular fake price cut. It is reported as its own kind so a human can
 * decide, rather than being quietly turned into an alert.
 */
export function classify(previous: Observation | null, next: Observation): ChangeEvent {
  const base = { at: next.observedAt, from: previous?.price ?? null, to: next.price, deltaMinor: 0, pctChange: null as number | null };

  if (!previous || previous.price === null) {
    if (next.price === null) {
      return { ...base, kind: "unchanged", why: "still not quoted" };
    }
    return previous
      ? { ...base, kind: "relisted", why: "quoted again after being delisted" }
      : { ...base, kind: "first_seen", why: "first observation of this device at this program" };
  }

  if (next.price === null) {
    return { ...base, kind: "delisted", why: "program no longer quotes this device" };
  }

  if (previous.price.currency !== next.price.currency) {
    return {
      ...base,
      kind: "currency_changed",
      why: `quote currency changed ${previous.price.currency} → ${next.price.currency}; not a price movement`,
    };
  }

  const delta = next.price.amountMinor - previous.price.amountMinor;
  if (delta === 0) return { ...base, kind: "unchanged", why: "same price as the previous observation" };

  const pct =
    previous.price.amountMinor === 0
      ? null // a move away from zero has no meaningful percentage
      : Math.round((delta / previous.price.amountMinor) * 10000) / 100;

  const d = minorDigits(next.price.currency);
  const human = (Math.abs(delta) / 10 ** d).toFixed(d);
  return {
    ...base,
    kind: delta > 0 ? "increase" : "decrease",
    deltaMinor: delta,
    pctChange: pct,
    why: `${delta > 0 ? "up" : "down"} ${next.price.currency} ${human}`,
  };
}

/** Kinds that represent a real movement in what the program will pay. */
export function isMovement(k: ChangeKind): boolean {
  return k === "increase" || k === "decrease" || k === "delisted" || k === "relisted";
}

/**
 * Reduce a series to the events worth showing.
 *
 * Confirmations are dropped. `first_seen` is kept because a series has to start
 * somewhere and the reader needs the anchor, but it is not counted as a change
 * by lastChangeAt below.
 */
export function changeLog(series: Observation[]): ChangeEvent[] {
  const sorted = [...series].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const out: ChangeEvent[] = [];
  let prev: Observation | null = null;
  for (const o of sorted) {
    const e = classify(prev, o);
    if (e.kind !== "unchanged") out.push(e);
    // The baseline advances on EVERY observation, including confirmations —
    // otherwise a long flat run would be compared against an ancient price.
    prev = o;
  }
  return out;
}

/**
 * When did this price last actually move?
 *
 * Deliberately excludes first_seen and currency_changed. A device first seen
 * yesterday has never changed price, and saying "last change: yesterday" would
 * make a brand-new listing look like an actively repriced one.
 */
export function lastChangeAt(series: Observation[]): string | null {
  const moves = changeLog(series).filter((e) => isMovement(e.kind));
  return moves.length ? moves[moves.length - 1].at : null;
}

/** Human "3mo" / "8h" / "2w", the way the dashboard reads. */
export function since(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

export type RunSummary = {
  runId: string;
  programId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  /** Prices captured, and observations that could not be parsed or resolved. */
  captured: number;
  errors: number;
  /** Observations quarantined because the device could not be resolved. */
  quarantined: number;
};

/**
 * A run's headline, as shown on a program card: "succeeded 1425/1".
 *
 * Quarantined rows are reported separately from errors on purpose. An error is
 * the scraper breaking; a quarantine is the scraper working and the CATALOGUE
 * being incomplete. They need different people to fix them, and rolling them
 * together hides the one that is quietly growing.
 */
export function runHeadline(r: RunSummary): string {
  const q = r.quarantined > 0 ? ` · ${r.quarantined} unmatched` : "";
  return `${r.status} ${r.captured}/${r.errors}${q}`;
}
