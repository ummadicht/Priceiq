import type { ConditionSpan } from "./condition.ts";
import type { Money } from "./money.ts";
import type { MarketCode } from "./markets.ts";

/**
 * MARKET PRICING — what a device SELLS for, as distinct from what a programme
 * pays for it.
 *
 * A trade-in price on its own answers almost nothing. "Programme A pays $890"
 * is only a fact; whether it is a GOOD fact depends entirely on what the same
 * handset, in the same condition, actually sells for. The two numbers together
 * are the product:
 *
 *     trade-in  $890      what you pay the customer
 *     market  $1,150      what it sells for, wholesale, in this market
 *     spread    $260      the reason to do the deal at all
 *
 * AND THE CHANNEL CHANGES THE ANSWER. The same phone in the same condition is
 * worth materially different amounts depending on who is buying it: a consumer
 * paying retail, a B2B lot buyer, an enterprise fleet deal, a liquidation
 * auction. A single "market price" per device is a fiction that averages four
 * different businesses together and describes none of them.
 *
 * SAMPLE SIZE IS PART OF THE PRICE. A market price derived from one listing is
 * not a market price, it is an anecdote. It is carried on the record rather
 * than thrown away after the average is taken, because everything downstream
 * needs to know how much weight the figure can bear.
 */

export type Channel = "retail" | "online" | "wholesale" | "enterprise" | "auction";

export const CHANNELS: Array<{ id: Channel; label: string; note: string }> = [
  { id: "retail",     label: "Retail",     note: "Consumer price in a shop — the highest realisation and the slowest" },
  { id: "online",     label: "Online",     note: "Consumer marketplace listing, net of fees" },
  { id: "wholesale",  label: "Wholesale",  note: "B2B lot pricing — the number a trader actually clears at" },
  { id: "enterprise", label: "Enterprise", note: "Bulk supply or lease to a business buyer" },
  { id: "auction",    label: "Auction",    note: "Liquidation. The floor, and the fastest exit" },
];

export const CHANNEL_LABEL: Record<Channel, string> =
  Object.fromEntries(CHANNELS.map((c) => [c.id, c.label])) as Record<Channel, string>;

/**
 * Typical realisation order, best to worst.
 *
 * Used ONLY to sanity-check a dataset, never to derive a missing price. If the
 * wholesale figure for a device exceeds its retail figure, something is wrong
 * with one of them — but the fix is to go and look, not to have the system
 * quietly reorder reality.
 */
export const EXPECTED_ORDER: Channel[] = ["retail", "online", "wholesale", "enterprise", "auction"];

export type MarketPrice = {
  deviceId: string;
  market: MarketCode;
  channel: Channel;
  /** The condition this price is for — a span, exactly as trade-in grades are. */
  condition: ConditionSpan;
  price: Money;
  observedAt: string;
  /**
   * How many comparable sales or listings this figure came from.
   * Below MIN_CREDIBLE_SAMPLE it may still be shown, but never as firm.
   */
  sampleSize: number;
  /**
   * SCATTER of those comps, as a percentage of the median, when known. A tight
   * cluster and a wild scatter can produce the same median and mean very
   * different things.
   *
   * Deliberately NOT called "spread" anywhere user-facing: in this product
   * "spread" means market price minus trade-in price — the margin — and one
   * word cannot mean both the profit and the error bar on a page that shows
   * them side by side.
   */
  dispersionPct: number | null;
  /** Where the figure came from, so a disputed number can be traced. */
  source: string;
};

/**
 * Fewer comps than this and the figure is an anecdote.
 *
 * Five is a judgement call, not a statistical result, and it is deliberately
 * low: in this market a specific device/condition/channel combination genuinely
 * may only trade a handful of times a week, and demanding thirty comps would
 * mean having no price at all for most of the catalogue. It is set here as one
 * named constant so it can be argued with.
 */
export const MIN_CREDIBLE_SAMPLE = 5;

/** Dispersion beyond which a median stops representing the cluster. */
export const MAX_TIGHT_DISPERSION_PCT = 18;

/**
 * Flag orderings that suggest a data problem. Reports, never corrects.
 */
export function channelSanity(prices: MarketPrice[]): string[] {
  const problems: string[] = [];
  const byChannel = new Map<Channel, MarketPrice>();
  for (const p of prices) {
    const seen = byChannel.get(p.channel);
    if (!seen || p.observedAt > seen.observedAt) byChannel.set(p.channel, p);
  }
  const present = EXPECTED_ORDER.filter((c) => byChannel.has(c));
  for (let i = 0; i < present.length - 1; i++) {
    const hi = byChannel.get(present[i])!;
    const lo = byChannel.get(present[i + 1])!;
    if (hi.price.currency !== lo.price.currency) continue;
    if (lo.price.amountMinor > hi.price.amountMinor) {
      problems.push(
        `${CHANNEL_LABEL[lo.channel]} is priced above ${CHANNEL_LABEL[hi.channel]} — one of these figures is probably wrong`
      );
    }
  }
  return problems;
}
