// Client credentials is what a bot will hold. These tests pin the properties
// that decide how a leak plays out, and the ones that stop a token being forged.

import assert from "node:assert/strict";
import {
  mintClient, hashSecret, secretMatches, mintToken, verifyToken,
  resolveScopes, parseBasicAuth, TOKEN_TTL_SECONDS, CLIENT_ID_PREFIX, CLIENT_SECRET_PREFIX,
} from "../oauth.ts";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  pass  " + n); } catch (e) { fail++; console.log("  FAIL  " + n + "\n        " + e.message); } };

const SIGNING = "a-signing-secret-at-least-32-chars-long";

console.log("clients");
t("id and secret are prefixed, long and unique", () => {
  const c = mintClient();
  assert.ok(c.clientId.startsWith(CLIENT_ID_PREFIX));
  assert.ok(c.clientSecret.startsWith(CLIENT_SECRET_PREFIX));
  assert.ok(c.clientSecret.length > 30);
  const ids = new Set(Array.from({ length: 200 }, () => mintClient().clientId));
  assert.equal(ids.size, 200);
});
t("THE SECRET IS NOT RECOVERABLE FROM WHAT IS STORED", () => {
  const c = mintClient();
  assert.notEqual(c.secretHash, c.clientSecret);
  assert.equal(hashSecret(c.clientSecret), c.secretHash);
  assert.equal(secretMatches(c.clientSecret, c.secretHash), true);
  assert.equal(secretMatches(c.clientSecret + "x", c.secretHash), false);
});
t("empty credentials never authenticate", () => {
  assert.equal(secretMatches("", ""), false);
  assert.equal(secretMatches("anything", ""), false);
});

console.log("\ntokens");
t("a fresh token verifies and carries its claims", () => {
  const tok = mintToken("tic_abc", ["read", "write"], SIGNING);
  const c = verifyToken(tok, SIGNING);
  assert.equal(c.sub, "tic_abc");
  assert.deepEqual(c.scopes, ["read", "write"]);
  assert.ok(c.exp > Math.floor(Date.now() / 1000));
});
t("A TAMPERED PAYLOAD IS REJECTED — scopes cannot be edited in flight", () => {
  const tok = mintToken("tic_abc", ["read"], SIGNING);
  const [payload, sig] = tok.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  claims.scopes = ["read", "write"];
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url") + "." + sig;
  assert.equal(verifyToken(forged, SIGNING), null);
});
t("a token signed with another key is rejected", () => {
  const tok = mintToken("tic_abc", ["read"], "some-other-secret-entirely-xxxxxx");
  assert.equal(verifyToken(tok, SIGNING), null);
});
t("AN EXPIRED TOKEN IS REJECTED", () => {
  const past = Date.now() - (TOKEN_TTL_SECONDS + 60) * 1000;
  assert.equal(verifyToken(mintToken("tic_abc", ["read"], SIGNING, past), SIGNING), null);
  // ...and one minted a moment ago is not.
  assert.ok(verifyToken(mintToken("tic_abc", ["read"], SIGNING), SIGNING));
});
t("NO SIGNING KEY MEANS NOBODY IS AUTHENTICATED, not everybody", () => {
  const tok = mintToken("tic_abc", ["read"], SIGNING);
  assert.equal(verifyToken(tok, ""), null);
  assert.equal(verifyToken(tok, undefined), null);
});
t("malformed tokens are rejected rather than throwing", () => {
  for (const bad of ["", "a", "a.b.c", "....", "notbase64.sig", "eyJhIjoxfQ"]) {
    assert.equal(verifyToken(bad, SIGNING), null, bad);
  }
});
t("the TTL is short enough that an unrevokable token still expires", () => {
  // Tokens are signed, not stored, so they cannot be revoked early. An hour is
  // the trade for not putting a database read in front of every request.
  assert.ok(TOKEN_TTL_SECONDS <= 3600);
});

console.log("\nscopes");
t("no requested scope means everything the client holds", () => {
  assert.deepEqual(resolveScopes(undefined, ["read", "write"]), { ok: true, scopes: ["read", "write"] });
  assert.deepEqual(resolveScopes("", ["read"]), { ok: true, scopes: ["read"] });
});
t("ASKING FOR MORE THAN GRANTED IS AN ERROR, not a quiet downgrade", () => {
  // Silently issuing less produces a bot that fails later, at a write, with a
  // confusing 403 far from the cause.
  const r = resolveScopes("read write", ["read"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /not granted: write/);
});
t("an unknown scope is named", () => {
  const r = resolveScopes("read admin", ["read", "write"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown scope: admin/);
});
t("a client with no scopes gets nothing", () => {
  assert.equal(resolveScopes(undefined, []).ok, false);
});
t("scopes may be space or comma separated", () => {
  assert.deepEqual(resolveScopes("read,write", ["read", "write"]).scopes, ["read", "write"]);
  assert.deepEqual(resolveScopes("read write", ["read", "write"]).scopes, ["read", "write"]);
});

console.log("\nbasic auth, per RFC 6749");
t("credentials round-trip through a Basic header", () => {
  const header = "Basic " + Buffer.from("tic_abc:tis_xyz").toString("base64");
  assert.deepEqual(parseBasicAuth(header), { id: "tic_abc", secret: "tis_xyz" });
});
t("a secret containing a colon survives", () => {
  const header = "Basic " + Buffer.from("tic_abc:tis:with:colons").toString("base64");
  assert.deepEqual(parseBasicAuth(header), { id: "tic_abc", secret: "tis:with:colons" });
});
t("anything else is null", () => {
  assert.equal(parseBasicAuth("Bearer xyz"), null);
  assert.equal(parseBasicAuth("Basic !!!notbase64"), null);
  assert.equal(parseBasicAuth(""), null);
  assert.equal(parseBasicAuth(null), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
