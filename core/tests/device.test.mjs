// Device identity decides whether two prices are comparable at all, so these
// tests are aimed squarely at the ways a resolver silently corrupts a dataset:
// matching a base model to a Pro Max, inventing a storage variant, or quietly
// picking a winner when it should have said "I don't know".

import assert from "node:assert/strict";
import { resolveDevice, parseStorageGb, tokenise } from "../device.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

const dev = (id, brand, model, storageGb, releaseYear, aliases = []) =>
  ({ id, brand, model, storageGb, releaseYear, aliases });

const CAT = [
  dev("apple-iphone-15-256", "Apple", "iPhone 15", 256, 2023),
  dev("apple-iphone-15-pro-256", "Apple", "iPhone 15 Pro", 256, 2023),
  dev("apple-iphone-15-pro-max-256", "Apple", "iPhone 15 Pro Max", 256, 2023),
  dev("apple-iphone-15-pro-max-512", "Apple", "iPhone 15 Pro Max", 512, 2023, ["A2849"]),
  dev("apple-iphone-15-pro-max-1024", "Apple", "iPhone 15 Pro Max", 1024, 2023),
  dev("samsung-galaxy-s23-ultra-512", "Samsung", "Galaxy S23 Ultra", 512, 2023, ["SM-S918B"]),
  dev("samsung-galaxy-s23-256", "Samsung", "Galaxy S23", 256, 2023),
  dev("google-pixel-8-pro-256", "Google", "Pixel 8 Pro", 256, 2023),
];

console.log("storage parsing");
t("gigabytes and terabytes both land in GB", () => {
  assert.equal(parseStorageGb("iPhone 15 Pro Max 512GB"), 512);
  assert.equal(parseStorageGb("iPhone 15 Pro Max 512 GB"), 512);
  assert.equal(parseStorageGb("iPhone 15 Pro Max 1TB"), 1024);
  assert.equal(parseStorageGb("1 TB model"), 1024);
  assert.equal(parseStorageGb("iPhone 15 Pro Max"), null);
});
t("a UNIT-LESS capacity is read, a unit-less model number is not", () => {
  // Programs really do write "IPHONE 15 PRO MAX 512".
  assert.equal(parseStorageGb("IPHONE 15 PRO MAX 512"), 512);
  assert.equal(parseStorageGb("Galaxy S23 Ultra 256"), 256);
  // ...but the 15 here is a model, and 23 is a model, and neither is storage.
  assert.equal(parseStorageGb("iPhone 15"), null);
  assert.equal(parseStorageGb("Galaxy S23"), null);
  assert.equal(parseStorageGb("Pixel 8 Pro"), null);
});

console.log("\ntokenising");
t("a closed-up name still splits", () => {
  assert.ok(tokenise("iPhone15 Pro Max").includes("iphone"));
  assert.ok(tokenise("iPhone15 Pro Max").includes("15"));
});
t("listing noise is dropped but 5G is kept", () => {
  const tk = tokenise("Apple iPhone 15 Pro Max (512 GB) — Unlocked, Dual SIM, Refurbished");
  assert.ok(!tk.includes("unlocked"));
  assert.ok(!tk.includes("refurbished"));
  assert.ok(!tk.includes("gb"));
  assert.ok(tk.includes("pro") && tk.includes("max"));
  // 5G separates real handsets in several Android families — never noise.
  assert.ok(tokenise("Galaxy S23 5G").includes("5"));
});

console.log("\nthe substring trap — the expensive one");
t("A BASE MODEL LISTING NEVER MATCHES A PRO MAX", () => {
  const r = resolveDevice("Apple iPhone 15 256GB", CAT);
  assert.equal(r.status, "matched");
  assert.equal(r.device.model, "iPhone 15");
});
t("A PRO MAX LISTING NEVER SETTLES FOR THE BASE MODEL", () => {
  const r = resolveDevice("Apple iPhone 15 Pro Max 512GB", CAT);
  assert.equal(r.status, "matched");
  assert.equal(r.device.model, "iPhone 15 Pro Max");
  assert.equal(r.device.storageGb, 512);
});
t("Pro and Pro Max stay distinct", () => {
  const pro = resolveDevice("iPhone 15 Pro 256GB", CAT);
  assert.equal(pro.device.model, "iPhone 15 Pro");
  const max = resolveDevice("iPhone 15 Pro Max 256GB", CAT);
  assert.equal(max.device.model, "iPhone 15 Pro Max");
});

console.log("\nmessy real-world listings");
t("shouty, punctuated and closed-up spellings all resolve the same", () => {
  const want = "apple-iphone-15-pro-max-512";
  for (const s of [
    "IPHONE 15 PRO MAX 512",
    "Apple iPhone 15 Pro Max (512 GB) — Unlocked",
    "iPhone15 Pro Max 512GB Dual SIM",
    "  apple   iphone  15  pro  max  512gb  ",
  ]) {
    const r = resolveDevice(s, CAT);
    assert.equal(r.status, "matched", `${s} → ${r.status} (${r.why})`);
    assert.equal(r.device.id, want, `${s} resolved to ${r.device.id}`);
  }
});
t("a terabyte listing finds the 1024GB variant", () => {
  const r = resolveDevice("iPhone 15 Pro Max 1TB", CAT);
  assert.equal(r.device.id, "apple-iphone-15-pro-max-1024");
});
t("a model number beats every other signal", () => {
  const r = resolveDevice("Apple A2849 handset", CAT);
  assert.equal(r.status, "matched");
  assert.equal(r.device.id, "apple-iphone-15-pro-max-512");
  assert.ok(r.confidence > 0.95);
});

console.log("\nrefusing to guess");
t("NO STORAGE means ambiguous, never a picked variant", () => {
  const r = resolveDevice("iPhone 15 Pro Max", CAT);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.candidates.length, 3);          // 256 / 512 / 1024
  assert.match(r.why, /storage/i);
});
t("an unknown storage variant is unresolved, not rounded to the nearest", () => {
  const r = resolveDevice("iPhone 15 Pro Max 2TB", CAT);
  assert.equal(r.status, "unresolved");
});
t("an unknown brand is unresolved", () => {
  assert.equal(resolveDevice("Nokia 3310 64GB", CAT).status, "unresolved");
});
t("a known brand with an unknown model is unresolved", () => {
  const r = resolveDevice("Apple iPhone 42 Pro 256GB", CAT);
  assert.equal(r.status, "unresolved");
});
t("empty and junk input never match anything", () => {
  assert.equal(resolveDevice("", CAT).status, "unresolved");
  assert.equal(resolveDevice("   ", CAT).status, "unresolved");
  assert.equal(resolveDevice("!!! ???", CAT).status, "unresolved");
});
t("brands never cross", () => {
  const r = resolveDevice("Samsung Galaxy S23 Ultra 512GB", CAT);
  assert.equal(r.device.brand, "Samsung");
  assert.equal(resolveDevice("Google Pixel 8 Pro 256GB", CAT).device.brand, "Google");
  // Galaxy S23 must not absorb an S23 Ultra listing, same trap as Pro Max.
  assert.equal(resolveDevice("Galaxy S23 256GB", CAT).device.model, "Galaxy S23");
  assert.equal(resolveDevice("Galaxy S23 Ultra 512GB", CAT).device.model, "Galaxy S23 Ultra");
});
t("an empty catalogue resolves nothing rather than throwing", () => {
  assert.equal(resolveDevice("iPhone 15 Pro Max 512GB", []).status, "unresolved");
});

console.log("\nevery match explains itself");
t("a resolution always carries a reason a human can audit", () => {
  for (const s of ["iPhone 15 Pro Max 512GB", "iPhone 15 Pro Max", "Nokia 1"]) {
    const r = resolveDevice(s, CAT);
    assert.ok(r.why && r.why.length > 5, `"${s}" gave no reason`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
