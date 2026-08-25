import type { ProgramSeed } from "./markets.ts";
import type { ScrapedRow } from "./ingest.ts";

/**
 * COLLECTION — the seam where data would actually come from, and the gate in
 * front of it.
 *
 * DELIBERATELY NOT IMPLEMENTED. There is no scraper in this module and adding
 * one is not a small follow-up task, because how a programme's prices may be
 * collected is a legal and commercial question before it is a technical one:
 *
 *   • Some programmes publish a price API or a partner feed. Best case.
 *   • Some permit automated access under their terms; some forbid it outright.
 *   • Some will licence a feed commercially if asked.
 *   • Some are only lawfully reachable by a human with an account.
 *
 * Those answers differ per programme and per country, and a scraper written
 * before they are known is a liability with a cron schedule. So `cleared` on a
 * programme is a HARD GATE enforced here in code rather than a note in a
 * document that gets skimmed: an uncleared programme cannot run, and the reason
 * is reported rather than silently swallowed.
 *
 * The adapter shape below is what a cleared programme implements. Everything
 * downstream — ingest, change detection, comparison — is already built and
 * tested against this shape, so clearing a programme is genuinely a matter of
 * writing one adapter, not of designing the pipeline.
 */

export type CollectorContext = {
  /** Devices the run should ask about, by canonical id. */
  deviceIds: string[];
  /** Wall-clock budget. A collector that overruns is aborted, not left running. */
  timeoutMs: number;
};

/** What a cleared programme must provide. */
export interface Collector {
  programId: string;
  /**
   * How this programme's data is obtained, recorded so the answer survives the
   * person who found it.
   */
  method: "public_api" | "partner_feed" | "licensed_export" | "permitted_crawl" | "manual_entry";
  /** Where the permission comes from — a contract, a documented ToS clause, etc. */
  authority: string;
  collect(ctx: CollectorContext): Promise<ScrapedRow[]>;
}

export type ClearanceCheck = { allowed: boolean; why: string };

/**
 * May this programme be collected from at all?
 *
 * Called before every run. Returning a refusal rather than throwing keeps one
 * uncleared programme from failing a whole scheduled sweep.
 */
export function checkClearance(
  program: ProgramSeed,
  collectors: Map<string, Collector>
): ClearanceCheck {
  if (!program.cleared) {
    return {
      allowed: false,
      why: `${program.name} is not cleared for collection. Confirm how its prices may lawfully be obtained, record the authority on its collector, then set cleared.`,
    };
  }
  const c = collectors.get(program.id);
  if (!c) {
    return { allowed: false, why: `${program.name} is cleared but has no collector implemented.` };
  }
  if (!c.authority || c.authority.trim().length < 8) {
    // A cleared flag with no stated authority is how a compliance decision gets
    // lost. The reason has to travel with the code.
    return { allowed: false, why: `${program.name}'s collector does not record what authorises collection.` };
  }
  return { allowed: true, why: `${c.method} — ${c.authority}` };
}

/**
 * MANUAL ENTRY is a first-class collector, not a placeholder.
 *
 * The fastest lawful way to have real data on day one is a person reading a
 * public quote page and typing the number in. It is slow and it does not scale,
 * and it is exactly how a price-intelligence product should start: the whole
 * pipeline gets exercised against real prices while the licensing conversations
 * happen, and nothing downstream can tell the difference.
 */
export function manualCollector(programId: string, enteredBy: string): Collector {
  return {
    programId,
    method: "manual_entry",
    authority: `Public quote page read by ${enteredBy}; no automated access`,
    async collect() {
      // Rows arrive through the UI, not from here.
      return [];
    },
  };
}
