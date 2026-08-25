import { comparability, describeSpan, type ConditionSpan } from "./condition.ts";
import { convert, minorDigits, toMajor, type FxRate, type Money } from "./money.ts";
import {
  MIN_CREDIBLE_SAMPLE, MAX_TIGHT_DISPERSION_PCT, CHANNEL_LABEL,
  type Channel, type MarketPrice,
} from "./channel.ts";
import type { MarketCode } from "./markets.ts";

/**
 * SPREAD — the number the business actually runs on, and the confidence that
 * has to travel with it.
 *
 * Buy at the trade-in price, sell at the market price for a channel, keep the
 * difference. Computing that is one subtraction. Knowing whether to TRUST it is
 * the whole problem, because the subtraction happily produces a confident-
 * looking figure from two numbers that should never have met:
 *
 *   • a trade-in grade that overlaps the market condition only partially
 *   • a currency conversion done on a rate a fortnight out of date
 *   • a "market price" derived from two listings
 *   • prices observed six weeks apart, in a category that reprices monthly
 *
 * THE RULE: CONFIDENCE PROPAGATES FROM THE WEAKEST INPUT. A spread is firm only
 * if every input was firm. Anything less is indicative — still shown, because a
 * rough number beats no number when you are standing at a counter, but never
 * dressed up as precision it does not have. And where the inputs genuinely
 * cannot be compared, no number is produced at all.
 *
 * A NEGATIVE SPREAD IS A VALID ANSWER. Programmes really do pay more than a
 * device clears for, to win the upgrade. Hiding those rows would remove exactly
 * the ones worth knowing about.
 */

export type SpreadConfidence = "firm" | "indicative" | "unusable";

export type Spread = {
  deviceId: string;
  market: MarketCode;
  channel: Channel;
  programId: string;
  /** Both legs, converted into one currency so the subtraction is meaningful. */
  currency: string;
  buy: Money;
  sell: Money;
  grossMinor: number;
  /** Margin ON THE SELL PRICE — the retail convention, not markup on cost. */
  grossPct: number;
  confidence: SpreadConfidence;
  /** Every reason the confidence is not firm, in plain language. */
  caveats: string[];
};

export type SpreadInput = {
  programId: string;
  deviceId: string;
  market: MarketCode;
  tradeIn: { price: Money; condition: ConditionSpan; observedAt: string };
  marketPrice: MarketPrice;
  /** Currency to express the spread in. Defaults to the market price's own. */
  reportIn?: string;
  rates: FxRate[];
};

export type SpreadResult = { ok: true; spread: Spread } | { ok: false; why: string };

/**
 * Prices further apart than this are describing different weeks.
 *
 * Handset values move on launch cycles and promotions; a fortnight is enough
 * for a flagship to shift several percent. Beyond it the two legs are still
 * worth subtracting, but nobody should call the result firm.
 */
export const MAX_LEG_GAP_DAYS = 14;

const DAY = 86_400_000;

export function computeSpread(input: SpreadInput): SpreadResult {
  const { tradeIn, marketPrice: mp } = input;
  const caveats: string[] = [];

  if (mp.deviceId !== input.deviceId) {
    return { ok: false, why: "market price is for a different device" };
  }
  if (mp.market !== input.market) {
    return { ok: false, why: "market price is for a different market" };
  }

  // ── 1. Are these the same condition? ────────────────────────────────────
  const cmp = comparability(tradeIn.condition, mp.condition);
  if (cmp === "incomparable") {
    // Refusing outright. Subtracting a flawless market price from a broken
    // trade-in offer yields a wonderful margin and describes nothing real.
    return {
      ok: false,
      why: `conditions do not overlap: trade-in is ${describeSpan(tradeIn.condition)}, market is ${describeSpan(mp.condition)}`,
    };
  }
  if (cmp === "approximate") {
    caveats.push(
      `Condition is an approximate match (${describeSpan(tradeIn.condition)} vs ${describeSpan(mp.condition)}).`
    );
  }

  // ── 2. One currency ─────────────────────────────────────────────────────
  const target = (input.reportIn || mp.price.currency).toUpperCase();
  const buyC = convert(tradeIn.price, target, tradeIn.observedAt, input.rates);
  if (!buyC.ok) return { ok: false, why: `trade-in leg: ${buyC.why}` };
  const sellC = convert(mp.price, target, mp.observedAt, input.rates);
  if (!sellC.ok) return { ok: false, why: `market leg: ${sellC.why}` };

  if (buyC.value.stale || sellC.value.stale) {
    const worst = Math.max(buyC.value.rateAgeDays, sellC.value.rateAgeDays);
    caveats.push(`Converted using an FX rate ${worst} days from the observation.`);
  }

  // ── 3. Is the market price worth anything? ──────────────────────────────
  if (mp.sampleSize < MIN_CREDIBLE_SAMPLE) {
    caveats.push(
      `Market price is based on ${mp.sampleSize} comparable${mp.sampleSize === 1 ? "" : "s"} — below the ${MIN_CREDIBLE_SAMPLE} needed to be firm.`
    );
  }
  if (mp.dispersionPct !== null && mp.dispersionPct > MAX_TIGHT_DISPERSION_PCT) {
    caveats.push(`Comparable sales are scattered (±${mp.dispersionPct}%), so the median is a weak centre.`);
  }

  // ── 4. Are the legs from the same week? ─────────────────────────────────
  const ta = Date.parse(tradeIn.observedAt);
  const tb = Date.parse(mp.observedAt);
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    const gap = Math.abs(ta - tb) / DAY;
    if (gap > MAX_LEG_GAP_DAYS) {
      caveats.push(`The two prices were observed ${Math.round(gap)} days apart.`);
    }
  } else {
    caveats.push("One of the observations has no usable date.");
  }

  const buy = buyC.value.money;
  const sell = sellC.value.money;
  const grossMinor = sell.amountMinor - buy.amountMinor;
  const grossPct =
    sell.amountMinor === 0 ? 0 : Math.round((grossMinor / sell.amountMinor) * 10000) / 100;

  return {
    ok: true,
    spread: {
      deviceId: input.deviceId,
      market: input.market,
      channel: mp.channel,
      programId: input.programId,
      currency: target,
      buy,
      sell,
      grossMinor,
      grossPct,
      confidence: caveats.length === 0 ? "firm" : "indicative",
      caveats,
    },
  };
}

export function formatGross(s: Spread): string {
  const d = minorDigits(s.currency);
  const v = (Math.abs(s.grossMinor) / 10 ** d).toFixed(d);
  return `${s.grossMinor < 0 ? "−" : ""}${s.currency} ${v}`;
}

/**
 * Rank programmes for one channel.
 *
 * FIRM ALWAYS OUTRANKS INDICATIVE, whatever the numbers say. A speculative
 * spread of 30% sitting above a solid 22% would send a buyer at the strongest-
 * looking row, which is precisely the row the system is least sure about.
 * Sorting purely on margin is how a confidence model gets built and then
 * quietly ignored by the one function anybody actually looks at.
 */
export function rankByChannel(spreads: Spread[], channel: Channel): Spread[] {
  return spreads
    .filter((s) => s.channel === channel && s.confidence !== "unusable")
    .sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === "firm" ? -1 : 1;
      if (b.grossPct !== a.grossPct) return b.grossPct - a.grossPct;
      return b.grossMinor - a.grossMinor;
    });
}

export type ChannelSummary = {
  channel: Channel;
  label: string;
  best: Spread | null;
  count: number;
  firmCount: number;
  medianGrossPct: number | null;
};

/** One row per channel — the shape the compare view renders. */
export function summariseByChannel(spreads: Spread[], channels: Channel[]): ChannelSummary[] {
  return channels.map((c) => {
    const ranked = rankByChannel(spreads, c);
    const pcts = ranked.map((s) => s.grossPct).sort((a, b) => a - b);
    const median =
      pcts.length === 0
        ? null
        : pcts.length % 2
          ? pcts[(pcts.length - 1) / 2]
          : Math.round(((pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2) * 100) / 100;
    return {
      channel: c,
      label: CHANNEL_LABEL[c],
      best: ranked[0] ?? null,
      count: ranked.length,
      firmCount: ranked.filter((s) => s.confidence === "firm").length,
      medianGrossPct: median,
    };
  });
}

/** Convenience for a UI that wants the headline figure with its caveats. */
export function spreadHeadline(s: Spread): string {
  const base = `${formatGross(s)} (${s.grossPct}%) via ${CHANNEL_LABEL[s.channel]}`;
  void toMajor;
  return s.confidence === "firm" ? base : `${base} — indicative`;
}
