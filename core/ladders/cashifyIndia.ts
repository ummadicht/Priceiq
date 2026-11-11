import { spanOf, type ProgramLadder } from "../condition.ts";

/**
 * THE CASHIFY INDIA CONDITION LADDER.
 *
 * Cashify's buyback quotation flow evaluates devices through cosmetic and
 * functional questions that resolve into grades:
 *
 *   Grade A / Flawless / Superb / Excellent - Pristine, complete working order, no scratches
 *   Grade B / Good / Very Good / Base       - Minor cosmetic signs of use, full functionality
 *   Grade C / Fair / Average                - Heavy scratches, dents, or aged battery
 *   Grade D / Poor / Below Average          - Cracked glass, minor display defects
 *   Grade E / Broken / Dead / Faulty        - Non-functional display, dead board, or power issue
 *
 * Both letter grades ("Grade A".."Grade E", "A".."E") and semantic grades
 * ("Flawless", "Good", "Fair", "Poor", "Broken", "Superb", "Average", etc.)
 * map onto the canonical 5-rung ladder.
 */
export const CASHIFY_INDIA_LADDER: ProgramLadder = {
  programId: "cashify-in",
  rungs: [
    { label: "Grade A",            span: spanOf("flawless") },
    { label: "A",                  span: spanOf("flawless") },
    { label: "Flawless",           span: spanOf("flawless") },
    { label: "Flawless Condition", span: spanOf("flawless") },
    { label: "Superb",             span: spanOf("flawless") },
    { label: "Excellent",          span: spanOf("flawless") },
    { label: "Like New",           span: spanOf("flawless") },

    { label: "Grade B",            span: spanOf("good") },
    { label: "B",                  span: spanOf("good") },
    { label: "Good",               span: spanOf("good") },
    { label: "Good Condition",     span: spanOf("good") },
    { label: "Very Good",          span: spanOf("good") },
    { label: "Working",            span: spanOf("good") },
    { label: "Base",               span: spanOf("good") },
    { label: "Standard",           span: spanOf("good") },

    { label: "Grade C",            span: spanOf("fair") },
    { label: "C",                  span: spanOf("fair") },
    { label: "Fair",               span: spanOf("fair") },
    { label: "Fair Condition",     span: spanOf("fair") },
    { label: "Average",            span: spanOf("fair") },
    { label: "Okay",               span: spanOf("fair") },

    { label: "Grade D",            span: spanOf("poor") },
    { label: "D",                  span: spanOf("poor") },
    { label: "Poor",               span: spanOf("poor") },
    { label: "Poor Condition",     span: spanOf("poor") },
    { label: "Below Average",      span: spanOf("poor") },
    { label: "Cracked",            span: spanOf("poor") },

    { label: "Grade E",            span: spanOf("broken") },
    { label: "E",                  span: spanOf("broken") },
    { label: "Broken",             span: spanOf("broken") },
    { label: "Broken Condition",   span: spanOf("broken") },
    { label: "Dead",               span: spanOf("broken") },
    { label: "Faulty",             span: spanOf("broken") },
  ],
};

export const CASHIFY_INDIA_GRADES = [
  "Grade A",
  "Grade B",
  "Grade C",
  "Grade D",
  "Grade E",
  "Flawless",
  "Good",
  "Fair",
  "Poor",
  "Broken",
] as const;
