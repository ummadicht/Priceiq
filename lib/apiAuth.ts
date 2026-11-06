import { NextRequest } from "next/server";
import { currentUserId, authDisabled } from "./superiqAuth.ts";
import { verifyKey } from "./apikeys.ts";
import { keyFromHeader, permits, type Scope } from "../core/apikey.ts";
import { verifyToken } from "../core/oauth.ts";
import { tokenSigningSecret } from "./oauthClients.ts";

/**
 * One gate, two credentials.
 *
 * A browser arrives with the SuperIQ session cookie; a machine arrives with a
 * bearer key. Both resolve to the same thing — an actor and a set of scopes —
 * so no route has to care which it got, and there is exactly one place where
 * "who is this" is decided.
 *
 * A signed-in human implicitly holds both scopes: they can already do anything
 * through the UI, so pretending otherwise at the API boundary would be theatre.
 */
export type Actor = { kind: "user" | "key" | "client"; id: string; label: string; scopes: Scope[] };

export async function authenticate(req: NextRequest, needed: Scope): Promise<
  { ok: true; actor: Actor } | { ok: false; status: number; why: string }
> {
  const authHeader = req.headers.get("authorization");

  /* An OAuth access token, tried FIRST. */
  const bearer = /^Bearer\s+(\S+)$/i.exec((authHeader || "").trim())?.[1];
  if (bearer && !bearer.startsWith("pk_live_")) {
    const claims = verifyToken(bearer, tokenSigningSecret());
    if (claims) {
      if (!permits(claims.scopes, needed)) {
        return { ok: false, status: 403, why: `this token does not have "${needed}" scope` };
      }
      return { ok: true, actor: { kind: "client", id: claims.sub, label: `client:${claims.sub}`, scopes: claims.scopes } };
    }
    return { ok: false, status: 401, why: "that access token is invalid or has expired — request a new one from /api/oauth/token" };
  }

  const presented = keyFromHeader(authHeader);
  if (presented) {
    const k = await verifyKey(presented);
    if (!k) return { ok: false, status: 401, why: "that API key is not valid or has been revoked" };
    if (!permits(k.scopes, needed)) {
      return { ok: false, status: 403, why: `this key does not have "${needed}" scope` };
    }
    return { ok: true, actor: { kind: "key", id: k.id, label: `key:${k.name}`, scopes: k.scopes } };
  }

  if (authDisabled()) {
    return { ok: true, actor: { kind: "user", id: "dev", label: "dev", scopes: ["read", "write"] } };
  }
  const user = await currentUserId();
  if (!user) {
    return { ok: false, status: 401, why: "sign in, or send an API key as `Authorization: Bearer pk_live_…`" };
  }
  return { ok: true, actor: { kind: "user", id: user, label: user, scopes: ["read", "write"] } };
}
