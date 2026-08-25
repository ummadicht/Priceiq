import { db, j } from "./db.ts";
import { mintClient, secretMatches, type Scope } from "../core/oauth.ts";

export type ClientRow = {
  clientId: string; name: string; scopes: Scope[];
  createdBy: string; createdAt: string; lastUsedAt: string | null; revoked: boolean;
};

function hydrate(r: Record<string, unknown>): ClientRow {
  return {
    clientId: String(r.client_id), name: String(r.name || ""),
    scopes: j<Scope[]>(String(r.scopes || "[]"), []),
    createdBy: String(r.created_by || ""), createdAt: String(r.created_at || ""),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    revoked: !!r.revoked_at,
  };
}

export function listClients(): ClientRow[] {
  return (db().prepare("SELECT * FROM oauth_clients ORDER BY created_at DESC").all() as Array<Record<string, unknown>>)
    .map(hydrate);
}

/** Create a client. The secret is returned ONCE and never stored. */
export function createClient(name: string, scopes: Scope[], by: string): { client: ClientRow; clientSecret: string } {
  const c = mintClient();
  db().prepare(
    "INSERT INTO oauth_clients (client_id, name, secret_hash, scopes, created_by) VALUES (?,?,?,?,?)"
  ).run(c.clientId, name.slice(0, 60) || "unnamed", c.secretHash, JSON.stringify(scopes), by);
  return { client: listClients().find((x) => x.clientId === c.clientId)!, clientSecret: c.clientSecret };
}

export function revokeClient(clientId: string): boolean {
  return db().prepare("UPDATE oauth_clients SET revoked_at = datetime('now') WHERE client_id=? AND revoked_at IS NULL")
    .run(clientId).changes > 0;
}

/**
 * Authenticate a client's credentials.
 *
 * A revoked or unknown client fails the same way a wrong secret does — a
 * different message for each would let somebody enumerate valid client ids.
 */
export function authenticateClient(clientId: string, clientSecret: string): ClientRow | null {
  const row = db().prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as
    | Record<string, unknown> | undefined;
  if (!row || row.revoked_at) return null;
  if (!secretMatches(clientSecret, String(row.secret_hash))) return null;
  db().prepare("UPDATE oauth_clients SET last_used_at = datetime('now') WHERE client_id=?").run(clientId);
  return hydrate(row);
}

/** The key access tokens are signed with. Never the SuperIQ session secret. */
export function tokenSigningSecret(): string {
  return process.env.PRICEIQ_TOKEN_SECRET || "";
}
