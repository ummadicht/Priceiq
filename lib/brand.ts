/**
 * PRODUCT IDENTITY.
 *
 * ⚠ NAMING COLLISION, FLAGGED RATHER THAN SILENTLY RESOLVED.
 *
 * thesuperiq.com already ships an engine called **PricingIQ** at /pricingiq,
 * described as "Price & channel — Buy and sell against live market data."
 * That is precisely this product. Naming the build PriceIQ therefore leaves two
 * names for one engine and orphans a live marketing page.
 *
 * It is named PriceIQ here because that is what was asked for, and the choice
 * is defensible: PricingIQ is the only gerund in a family of GradeIQ, CoreIQ,
 * RefurbIQ, ProcureIQ. But the decision has to be made in ONE direction —
 * either rename the marketing page, or change PRODUCT below. It is a single
 * constant precisely so that switch costs nothing.
 */
export const PRODUCT = "PriceIQ";
export const PRODUCT_TAGLINE = "Price & channel intelligence";
export const SUITE = "SuperIQ";

/** The engines this one sits beside, for the family strip. */
export const SUITE_ENGINES = [
  { name: "GradeIQ", role: "Inspection & grading" },
  { name: "RefurbIQ", role: "Refurb & warehouse ops" },
  { name: "CoreIQ", role: "Inventory & invoicing" },
  { name: PRODUCT, role: "Price & channel", self: true },
  { name: "ProcureIQ", role: "Sourcing & procurement" },
  { name: "DeviceFax", role: "Proof & compliance" },
];
