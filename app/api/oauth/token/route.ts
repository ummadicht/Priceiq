import { NextRequest, NextResponse } from "next/server";
import { authenticateClient, tokenSigningSecret } from "@/lib/oauthClients.ts";
import { mintToken, resolveScopes, parseBasicAuth, TOKEN_TTL_SECONDS } from "@/core/oauth.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * OAuth 2.0 token endpoint — client_credentials grant (RFC 6749 §4.4).
 *
 *   POST /priceiq/api/oauth/token
 *   Authorization: Basic base64(client_id:client_secret)      ← preferred
 *   Content-Type: application/x-www-form-urlencoded
 *   grant_type=client_credentials&scope=read write
 *
 * Credentials may also go in the body, which the spec permits and most bot
 * frameworks default to.
 *
 * Errors use the shapes RFC 6749 §5.2 defines, because a client library will be
 * branching on `error` and a bespoke error body is the thing that makes an
 * otherwise standard integration need custom code.
 */
function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export async function POST(req: NextRequest) {
  seed();

  const signing = tokenSigningSecret();
  if (!signing) {
    // Fail closed and say so: a missing signing key must never mean "issue
    // unsigned tokens" or "let everybody in".
    return oauthError("server_error", "token signing is not configured on this server", 500);
  }

  const ct = req.headers.get("content-type") || "";
  let body: Record<string, string> = {};
  if (ct.includes("application/json")) {
    body = (await req.json().catch(() => ({}))) as Record<string, string>;
  } else {
    const form = await req.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) body[k] = String(v);
  }

  if ((body.grant_type || "") !== "client_credentials") {
    return oauthError("unsupported_grant_type", "only client_credentials is supported");
  }

  const basic = parseBasicAuth(req.headers.get("authorization"));
  const clientId = basic?.id || body.client_id || "";
  const clientSecret = basic?.secret || body.client_secret || "";
  if (!clientId || !clientSecret) {
    return oauthError("invalid_client", "send client_id and client_secret, by Basic auth or in the body", 401);
  }

  const client = authenticateClient(clientId, clientSecret);
  if (!client) {
    // One message for unknown, revoked and wrong-secret alike — anything more
    // specific lets somebody enumerate valid client ids.
    return oauthError("invalid_client", "client authentication failed", 401);
  }

  const scopes = resolveScopes(body.scope, client.scopes);
  if (!scopes.ok) return oauthError("invalid_scope", scopes.error);

  return NextResponse.json(
    {
      access_token: mintToken(client.clientId, scopes.scopes, signing),
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      scope: scopes.scopes.join(" "),
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}
