import crypto from "node:crypto";

/**
 * OAUTH 2.0 CLIENT CREDENTIALS — machine-to-machine access.
 *
 * A static API key works, but it is one long-lived secret doing every job: it
 * travels on every request, lives in whatever config the bot reads, and if it
 * leaks it is valid until somebody notices and revokes it.
 *
 * The client-credentials grant splits that in two. The SECRET is exchanged
 * rarely, at a single endpoint, for a short-lived ACCESS TOKEN that does the
 * actual work. A leaked token expires by itself; a leaked secret is still bad
 * but it is handled at one endpoint you can rate-limit and watch.
 *
 * It is also the grant every agent framework already speaks, which matters when
 * the client is a bot somebody else wrote.
 *
 * TOKENS ARE SIGNED, NOT STORED. Verification is an HMAC check, so a busy
 * client does not put a database read in front of every request, and there is
 * no token table to leak. The cost is that a token cannot be revoked before it
 * expires — which is exactly why the TTL is an hour rather than a month.
 */

export const TOKEN_TTL_SECONDS = 3600;
export const CLIENT_ID_PREFIX = "tic_";      // trade-in client
export const CLIENT_SECRET_PREFIX = "tis_";  // trade-in secret

export type Scope = "read" | "write";
export const ALL_SCOPES: Scope[] = ["read", "write"];

export type NewClient = {
  clientId: string;
  /** Shown once, at creation. Only its hash is stored. */
  clientSecret: string;
  secretHash: string;
};

export function mintClient(): NewClient {
  const clientId = CLIENT_ID_PREFIX + crypto.randomBytes(9).toString("base64url");
  const clientSecret = CLIENT_SECRET_PREFIX + crypto.randomBytes(24).toString("base64url");
  return { clientId, clientSecret, secretHash: hashSecret(clientSecret) };
}

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

export function secretMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(presented || ""), "utf8");
  const b = Buffer.from(storedHash || "", "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ── access tokens ─────────────────────────────────────────────────────── */

export type TokenClaims = { sub: string; scopes: Scope[]; exp: number };

const b64u = (b: Buffer | string) =>
  Buffer.from(b).toString("base64url");

/**
 * A compact signed token: base64url(payload).hmac
 *
 * Not a JWT. A JWT would carry a header advertising its own algorithm, and
 * "alg": "none" plus a lenient verifier is the single most repeated auth bug in
 * the wild. There is exactly one algorithm here and the verifier cannot be
 * talked out of it.
 */
export function mintToken(clientId: string, scopes: Scope[], secret: string, now = Date.now()): string {
  const claims: TokenClaims = {
    sub: clientId,
    scopes,
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
  };
  const payload = b64u(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyToken(token: string, secret: string, now = Date.now()): TokenClaims | null {
  if (!secret) return null; // no signing key means nobody is authenticated, not everybody
  const parts = (token || "").split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
  } catch {
    return null;
  }
  if (!claims?.sub || !Array.isArray(claims.scopes) || typeof claims.exp !== "number") return null;
  if (Math.floor(now / 1000) >= claims.exp) return null;
  return claims;
}

/**
 * Narrow the requested scopes to what the client actually holds.
 *
 * A client asking for more than it was granted gets an error rather than a
 * quietly reduced token — silently issuing less than was asked for produces a
 * bot that fails later, at a write, with a confusing 403.
 */
export function resolveScopes(
  requested: string | undefined,
  granted: Scope[]
): { ok: true; scopes: Scope[] } | { ok: false; error: string } {
  if (!granted.length) return { ok: false, error: "this client has no scopes" };
  if (!requested || !requested.trim()) return { ok: true, scopes: granted };

  const asked = requested.split(/[\s,]+/).filter(Boolean);
  const bad = asked.filter((s) => !ALL_SCOPES.includes(s as Scope));
  if (bad.length) return { ok: false, error: `unknown scope: ${bad.join(", ")}` };

  const denied = asked.filter((s) => !granted.includes(s as Scope));
  if (denied.length) return { ok: false, error: `not granted: ${denied.join(", ")}` };

  return { ok: true, scopes: asked as Scope[] };
}

/** Pull client credentials from a Basic auth header, per RFC 6749 §2.3.1. */
export function parseBasicAuth(header: string | null | undefined): { id: string; secret: string } | null {
  const m = /^Basic\s+(\S+)$/i.exec((header || "").trim());
  if (!m) return null;
  try {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const i = raw.indexOf(":");
    if (i < 0) return null;
    return { id: raw.slice(0, i), secret: raw.slice(i + 1) };
  } catch {
    return null;
  }
}
