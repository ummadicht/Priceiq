import { query, queryOne, execute, j } from "./db.ts";
import { mintClient, secretMatches, type Scope } from "../core/oauth.ts";

export type ClientRow = {
  clientId: string; name: string; scopes: Scope[];
  createdBy: string; createdAt: string; lastUsedAt: string | null; revoked: boolean;
};

function hydrate(r: Record<string, unknown>): ClientRow {
  return {
    clientId: String(r.client_id), name: String(r.name || ""),
    scopes: j<Scope[]>(typeof r.scopes === "string" ? r.scopes : JSON.stringify(r.scopes || []), []),
    createdBy: String(r.created_by || ""), createdAt: String(r.created_at || ""),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    revoked: !!r.revoked_at,
  };
}

export async function listClients(): Promise<ClientRow[]> {
  const rows = await query("SELECT * FROM oauth_clients ORDER BY created_at DESC");
  return rows.map(hydrate);
}

/** Create a client in PostgreSQL price_iq.oauth_clients. The secret is returned ONCE and never stored. */
export async function createClient(name: string, scopes: Scope[], by: string): Promise<{ client: ClientRow; clientSecret: string }> {
  const c = mintClient();
  await execute(
    "INSERT INTO oauth_clients (client_id, name, secret_hash, scopes, created_by) VALUES ($1,$2,$3,$4,$5)",
    [c.clientId, name.slice(0, 60) || "unnamed", c.secretHash, JSON.stringify(scopes), by]
  );
  const clients = await listClients();
  return { client: clients.find((x) => x.clientId === c.clientId)!, clientSecret: c.clientSecret };
}

export async function revokeClient(clientId: string): Promise<boolean> {
  const res = await execute(
    "UPDATE oauth_clients SET revoked_at = CURRENT_TIMESTAMP WHERE client_id=$1 AND revoked_at IS NULL",
    [clientId]
  );
  return res.rowCount > 0;
}

/**
 * Authenticate a client's credentials against PostgreSQL price_iq.oauth_clients.
 */
export async function authenticateClient(clientId: string, clientSecret: string): Promise<ClientRow | null> {
  const row = await queryOne("SELECT * FROM oauth_clients WHERE client_id = $1", [clientId]);
  if (!row || row.revoked_at) return null;
  if (!secretMatches(clientSecret, String(row.secret_hash))) return null;
  await execute("UPDATE oauth_clients SET last_used_at = CURRENT_TIMESTAMP WHERE client_id=$1", [clientId]);
  return hydrate(row);
}

/** The key access tokens are signed with. Never the SuperIQ session secret. */
export function tokenSigningSecret(): string {
  return process.env.PRICEIQ_TOKEN_SECRET || "";
}
