// Picking one device out of 2,566 is the difference between the compare page
// being usable and being a 1.5 MB wall of chips.

import assert from "node:assert/strict";
import { searchDevices, brandsOf, modelsOf, skusOf, skuLabel, fullLabel } from "../search.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

const dev = (id, brand, model, storageGb, ramGb) => ({ id, brand, model, storageGb, ramGb });
const CAT = [
  dev("samsung-galaxy-s24-ultra-12-512", "Samsung", "Galaxy S24 Ultra", 512, 12),
  dev("samsung-galaxy-s24-ultra-12-256", "Samsung", "Galaxy S24 Ultra", 256, 12),
  dev("samsung-galaxy-s24-8-256", "Samsung", "Galaxy S24", 256, 8),
  dev("samsung-galaxy-a54-8-128", "Samsung", "Galaxy A54", 128, 8),
  dev("apple-iphone-15-pro-max-512", "Apple", "iPhone 15 Pro Max", 512),
  dev("apple-iphone-15-256", "Apple", "iPhone 15", 256),
  dev("honor-90-8-256", "Honor", "90", 256, 8),
  dev("honor-90-12-256", "Honor", "90", 256, 12),
];

console.log("labels");
t("a SKU reads as RAM / storage, and drops RAM when it is not part of identity", () => {
  assert.equal(skuLabel(CAT[0]), "12GB / 512GB");
  assert.equal(skuLabel(CAT[4]), "512GB");
  assert.equal(skuLabel({ id: "x", brand: "B", model: "M", storageGb: 1024 }), "1TB");
  assert.equal(fullLabel(CAT[4]), "Apple iPhone 15 Pro Max 512GB");
});

console.log("\nthe three levels");
t("manufacturers come back with counts, busiest first", () => {
  const b = brandsOf(CAT);
  assert.equal(b[0].brand, "Samsung");
  assert.equal(b[0].count, 4);
  assert.equal(b.length, 3);
});
t("models are per manufacturer and sort naturally", () => {
  const m = modelsOf(CAT, "Samsung").map((x) => x.model);
  assert.deepEqual(m, ["Galaxy A54", "Galaxy S24", "Galaxy S24 Ultra"]);
  assert.equal(modelsOf(CAT, "Honor").length, 1);
  assert.equal(modelsOf(CAT, "Nokia").length, 0);
});
t("SKUS ARE WHERE THE PRICE LIVES — every variant is offered", () => {
  // 370 real RAM variants are priced apart; the third level is the product.
  const s = skusOf(CAT, "Honor", "90");
  assert.equal(s.length, 2);
  assert.deepEqual(s.map(skuLabel), ["8GB / 256GB", "12GB / 256GB"]);
});
t("variants list smallest first", () => {
  assert.deepEqual(skusOf(CAT, "Samsung", "Galaxy S24 Ultra").map((d) => d.storageGb), [256, 512]);
});

console.log("\nfree text");
t("EVERY TERM MUST MATCH — more words narrows, never widens", () => {
  const broad = searchDevices(CAT, "galaxy");
  const narrow = searchDevices(CAT, "galaxy s24 ultra");
  assert.ok(narrow.length < broad.length);
  assert.ok(narrow.every((h) => h.device.model === "Galaxy S24 Ultra"));
});
t("the obvious answer ranks first", () => {
  assert.equal(searchDevices(CAT, "s24 ultra")[0].device.model, "Galaxy S24 Ultra");
  assert.equal(searchDevices(CAT, "iphone 15 pro max")[0].device.id, "apple-iphone-15-pro-max-512");
  // "iPhone 15" must not be beaten by the Pro Max that also contains it.
  assert.equal(searchDevices(CAT, "iphone 15 256")[0].device.id, "apple-iphone-15-256");
});
t("pasting a full device name lands on it", () => {
  assert.equal(searchDevices(CAT, "Apple iPhone 15 Pro Max 512GB")[0].device.id, "apple-iphone-15-pro-max-512");
});
t("SEARCH REACHES THE SKU, not just the model", () => {
  const r = searchDevices(CAT, "honor 90 12");
  assert.equal(r[0].device.id, "honor-90-12-256");
});
t("case and punctuation are irrelevant", () => {
  for (const q of ["GALAXY S24 ULTRA", "galaxy-s24-ultra", "  galaxy   s24  ultra "]) {
    assert.equal(searchDevices(CAT, q)[0].device.model, "Galaxy S24 Ultra", q);
  }
});
t("nonsense and empty queries return nothing, not everything", () => {
  assert.deepEqual(searchDevices(CAT, "zzzz"), []);
  assert.deepEqual(searchDevices(CAT, ""), []);
  assert.deepEqual(searchDevices(CAT, "   "), []);
});
t("results are capped so a broad query cannot ship the whole catalogue", () => {
  const many = Array.from({ length: 500 }, (_, i) => dev("d" + i, "Samsung", "Galaxy X" + i, 128, 8));
  assert.equal(searchDevices(many, "galaxy", 40).length, 40);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
