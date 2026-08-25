import { NextRequest, NextResponse } from "next/server";
import { currentUserId, authDisabled } from "@/lib/superiqAuth.ts";
import { listClients, createClient, revokeClient } from "@/lib/oauthClients.ts";
import { ALL_SCOPES, type Scope } from "@/core/oauth.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * Managing API clients is SESSION-ONLY.
 *
 * A client must never be able to create another client. That is the difference
 * between a leaked credential being a contained incident and it being a
 * permanent foothold that outlives revoking the original.
 */
async function human(): Promise<string | null> {
  if (authDisabled()) return "dev";
  return currentUserId();
}

export async function GET() {
  const user = await human();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  seed();
  return NextResponse.json({ clients: listClients() });
}

export async function POST(req: NextRequest) {
  const user = await human();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  seed();

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.revoke) return NextResponse.json({ revoked: revokeClient(String(b.revoke)) });

  const scopes = (Array.isArray(b.scopes) ? b.scopes : ["read"])
    .map(String).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
  if (!scopes.length) return NextResponse.json({ error: "pick at least one scope" }, { status: 400 });

  const { client, clientSecret } = createClient(String(b.name || "unnamed"), scopes, user);
  return NextResponse.json({
    client,
    client_secret: clientSecret,
    warning: "Copy the secret now — it is hashed at rest and cannot be shown again.",
  });
}
