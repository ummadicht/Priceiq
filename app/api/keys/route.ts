import { NextRequest, NextResponse } from "next/server";
import { currentUserId, authDisabled } from "@/lib/superiqAuth.ts";
import { listKeys, createKey, revokeKey } from "@/lib/apikeys.ts";
import type { Scope } from "@/core/apikey.ts";
import { seed } from "@/lib/seed.ts";

export const dynamic = "force-dynamic";

/**
 * Key management is SESSION-ONLY, deliberately.
 *
 * An API key must never be able to mint another API key. That is the difference
 * between a leaked key being a contained incident and a leaked key being a
 * permanent foothold that survives revoking the original.
 */
async function human(): Promise<string | null> {
  if (authDisabled()) return "dev";
  return currentUserId();
}

export async function GET() {
  const user = await human();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await seed();
  return NextResponse.json({ keys: await listKeys() });
}

export async function POST(req: NextRequest) {
  const user = await human();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await seed();

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (b.revoke) {
    return NextResponse.json({ revoked: await revokeKey(String(b.revoke)) });
  }

  const scopes = (Array.isArray(b.scopes) ? b.scopes : ["read"])
    .map(String).filter((s): s is Scope => s === "read" || s === "write");
  if (!scopes.length) return NextResponse.json({ error: "pick at least one scope" }, { status: 400 });

  const { row, secret } = await createKey(String(b.name || "unnamed"), scopes, user);
  // The only time this value ever leaves the server.
  return NextResponse.json({ key: row, secret, warning: "Copy this now — it cannot be shown again." });
}
