import crypto from "node:crypto";

/**
 * API KEYS — machine access, without a browser session.
 *
 * The UI is one client of this API, not the product. A spreadsheet macro, a
 * cron job on the ERP, or CounterIQ asking "what is this device worth" all need
 * to authenticate with no cookie and no login page.
 *
 * THREE RULES, each of which is the reason a leaked-key story ends badly.
 *
 * 1. THE KEY IS SHOWN EXACTLY ONCE, at creation, and only its SHA-256 is
 *    stored. A database that can print its own API keys is a database whose
 *    backups are credentials.
 * 2. Verification is CONSTANT TIME. A plain === on a hex digest leaks the
 *    prefix a byte at a time to anyone willing to measure.
 * 3. Every key carries a visible PREFIX (`pk_live_9f3a…`). Without one, a key
 *    found in a log or a config file cannot be identified, so it cannot be
 *    revoked with any confidence — and the safe response becomes "rotate
 *    everything", which nobody does.
 */

export const KEY_PREFIX = "pk_live_";
const SECRET_BYTES = 24;

export type NewKey = {
  /** Shown once. Never stored, never logged. */
  secret: string;
  /** Stored: the only thing the database ever sees. */
  hash: string;
  /** Stored: the first characters, for identifying a key without revealing it. */
  display: string;
};

export function mintKey(): NewKey {
  const raw = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  const secret = `${KEY_PREFIX}${raw}`;
  return { secret, hash: hashKey(secret), display: `${secret.slice(0, KEY_PREFIX.length + 6)}…` };
}

export function hashKey(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Pull a key out of a request's Authorization header. */
export function keyFromHeader(header: string | null | undefined): string | null {
  const h = (header || "").trim();
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  const candidate = m ? m[1] : h;
  return candidate.startsWith(KEY_PREFIX) ? candidate : null;
}

export type Scope = "read" | "write";

/** Does a key with these scopes permit this action? */
export function permits(scopes: Scope[], needed: Scope): boolean {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  // Write does NOT imply read. They are granted explicitly, so a key issued for
  // an import job cannot also be used to pull the whole price book.
  return scopes.includes(needed);
}
