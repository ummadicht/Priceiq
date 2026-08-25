import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * SITTING BEHIND THE SUPERIQ ERP'S LOGIN.
 *
 * PriceIQ has no login of its own, deliberately. It is deployed alongside the
 * SuperIQ ERP on wholecellmarket.com and simply VERIFIES the session the ERP
 * already issued — one identity, one password, one place to revoke it. A second
 * login screen on the same domain would be a second set of credentials to
 * manage and a second thing to get wrong.
 *
 * THE CONTRACT (src/lib/session-token.ts in denovo-refurb):
 *
 *     cookie   denovo_session
 *     value    <userId>.<expiryMs>.<hmacSha256(userId.expiryMs, secret)[0..32]>
 *
 * Verification is a pure HMAC check — no database, no network call to the ERP.
 * That matters: PriceIQ must not fall over because the ERP is restarting, and
 * it must not hold a second connection to the ERP's SQLite file.
 *
 * ⚠ THE COUPLING, STATED PLAINLY. This shares ONE value with the ERP: its
 * session secret, delivered as SUPERIQ_SESSION_SECRET. If the ERP rotates that
 * secret, every PriceIQ session stops verifying until the new value is
 * redeployed here. That is the price of not running a second login, and it is
 * the right trade at this size — but it is a real operational dependency and it
 * belongs in the runbook, not in someone's memory.
 */

export const SESSION_COOKIE = "denovo_session";

function secret(): string {
  return process.env.SUPERIQ_SESSION_SECRET || "";
}

/** Returns the signed-in user id, or null. Never throws. */
export function verifySessionToken(token: string): string | null {
  const s = secret();
  // No secret configured means nobody is signed in — NOT everybody. A missing
  // env var must fail closed, or a deploy that forgets it silently publishes
  // the whole dashboard.
  if (!s) return null;

  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!userId || !expStr || !sig) return null;

  const expected = crypto
    .createHmac("sha256", s)
    .update(`${userId}.${expStr}`)
    .digest("hex")
    .slice(0, 32);

  // Constant-time compare. The signature is not a password, but comparing it
  // with === leaks its prefix a byte at a time to anyone patient.
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return userId;
}

export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  return raw ? verifySessionToken(raw) : null;
}

/** Where to send someone who is not signed in. */
export function loginUrl(returnTo = "/priceiq"): string {
  const base = process.env.SUPERIQ_LOGIN_URL || "https://wholecellmarket.com/login";
  return `${base}?next=${encodeURIComponent(returnTo)}`;
}

/** True when auth is switched off for local development. */
export function authDisabled(): boolean {
  // Only ever honoured outside production, so a stray env var on the server
  // cannot unlock the dashboard.
  return process.env.NODE_ENV !== "production" && process.env.PRICEIQ_NO_AUTH === "1";
}
