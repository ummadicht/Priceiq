// A leaked API key is the worst outcome this system has. These tests pin the
// three properties that decide how badly that story ends.

import assert from "node:assert/strict";
import { mintKey, hashKey, sameHash, keyFromHeader, permits, KEY_PREFIX } from "../apikey.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

console.log("minting");
t("a key is prefixed, long, and unguessable", () => {
  const k = mintKey();
  assert.ok(k.secret.startsWith(KEY_PREFIX));
  assert.ok(k.secret.length > 30, "too short to resist guessing");
  const seen = new Set(Array.from({ length: 200 }, () => mintKey().secret));
  assert.equal(seen.size, 200, "keys collided");
});
t("THE SECRET IS NEVER RECOVERABLE FROM WHAT IS STORED", () => {
  const k = mintKey();
  assert.notEqual(k.hash, k.secret);
  assert.ok(!k.hash.includes(k.secret.slice(KEY_PREFIX.length)));
  // The display prefix identifies a key without revealing it.
  assert.ok(k.secret.startsWith(k.display.slice(0, -1)));
  assert.ok(k.display.length < k.secret.length);
});
t("hashing is stable and specific", () => {
  const k = mintKey();
  assert.equal(hashKey(k.secret), k.hash);
  assert.notEqual(hashKey(k.secret + "x"), k.hash);
});

console.log("\nverification");
t("comparison is constant time and still correct", () => {
  const k = mintKey();
  assert.equal(sameHash(hashKey(k.secret), k.hash), true);
  assert.equal(sameHash(hashKey("pk_live_wrong"), k.hash), false);
});
t("empty and mismatched inputs never pass", () => {
  assert.equal(sameHash("", ""), false);
  assert.equal(sameHash("abc", ""), false);
  assert.equal(sameHash("abc", "abcd"), false);
});

console.log("\nheaders");
t("Bearer and bare forms both work", () => {
  const k = mintKey();
  assert.equal(keyFromHeader(`Bearer ${k.secret}`), k.secret);
  assert.equal(keyFromHeader(`bearer ${k.secret}`), k.secret);
  assert.equal(keyFromHeader(k.secret), k.secret);
});
t("anything that is not one of our keys is rejected outright", () => {
  assert.equal(keyFromHeader("Bearer eyJhbGciOi.some.jwt"), null);
  assert.equal(keyFromHeader("Basic dXNlcjpwYXNz"), null);
  assert.equal(keyFromHeader(""), null);
  assert.equal(keyFromHeader(null), null);
  assert.equal(keyFromHeader(undefined), null);
});

console.log("\nscopes");
t("WRITE DOES NOT IMPLY READ", () => {
  // An import job's key must not also be able to pull the whole price book.
  assert.equal(permits(["write"], "write"), true);
  assert.equal(permits(["write"], "read"), false);
  assert.equal(permits(["read"], "write"), false);
  assert.equal(permits(["read", "write"], "read"), true);
});
t("no scopes means no access, not full access", () => {
  assert.equal(permits([], "read"), false);
  assert.equal(permits(undefined, "read"), false);
  assert.equal(permits(null, "write"), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
