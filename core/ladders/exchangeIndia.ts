import { spanOf, type ProgramLadder } from "../condition.ts";

/**
 * THE INDIAN EXCHANGE LADDER — A / B / B- / C / C- / D / E.
 *
 * Seven rungs, read off the grading rules the programme publishes alongside its
 * price list: thirty-seven quality-check questions, each answering to a grade.
 * Reproduced here so the mapping can be argued with rather than assumed.
 *
 *   A   Original box, under warranty, pristine
 *   B   Fewer than three minor scratches on screen and body
 *   B-  Cosmetically fine, ONE working part failed — proximity sensor, volume
 *       button, speaker, microphone, charging port, ear receiver
 *   C   Major dents; a camera, wifi, GPS, bluetooth or fingerprint failure;
 *       battery draining fast or health below 85%; deep scratches
 *   C-  Body cracked, screen loose or coming away, aftermarket display fitted
 *   D   Screen broken or cracked, display lines/ghosting, device bent,
 *       "unknown parts" warning
 *   E   Will not switch on, SIM dead, or LOCKED — finance, network or iCloud
 *
 * SEVEN RUNGS INTO FIVE. The canonical ladder is deliberately coarser, so
 * adjacent source rungs straddle canonical boundaries and their spans overlap.
 * That is the span model working as intended, not a definition error: this
 * programme grades more finely than the canonical scale can express, and
 * pretending otherwise would either invent precision or throw it away.
 * Comparisons involving overlapping rungs come out `approximate` — the truth.
 *
 * E IS ITS OWN PROBLEM. It bundles "will not power on" with "iCloud locked" —
 * a dead handset and a perfectly working locked one at the same price. Those
 * are very different commercially, and if this source is ever used to justify a
 * purchase, that distinction has to come from somewhere else.
 */
export const EXCHANGE_INDIA_LADDER: ProgramLadder = {
  programId: "exchange-in",
  rungs: [
    { label: "A",  span: spanOf("flawless") },
    { label: "B",  span: spanOf("flawless", "good") },
    { label: "B-", span: spanOf("good") },
    { label: "C",  span: spanOf("good", "fair") },
    { label: "C-", span: spanOf("fair", "poor") },
    { label: "D",  span: spanOf("poor") },
    { label: "E",  span: spanOf("broken") },
  ],
};

/** Column order in the workbook, left to right. */
export const EXCHANGE_INDIA_GRADES = ["A", "B", "B-", "C", "C-", "D", "E"] as const;
