import { query, queryOne, execute, j } from "./db.ts";
import { mintKey, hashKey, sameHash, type Scope } from "../core/apikey.ts";
import crypto from "node:crypto";

export type KeyRow = {
  id: string; name: string; display: string; scopes: Scope[];
  createdBy: string; createdAt: string; lastUsedAt: string | null; revoked: boolean;
};

export async function listKeys(): Promise<KeyRow[]> {
  const rows = await query("SELECT * FROM api_keys ORDER BY created_at DESC");
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name || ""), display: String(r.display || ""),
    scopes: j<Scope[]>(typeof r.scopes === "string" ? r.scopes : JSON.stringify(r.scopes || []), []),
    createdBy: String(r.created_by || ""), createdAt: String(r.created_at || ""),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    revoked: !!r.revoked_at,
  }));
}

/** Create a key. The secret is returned ONCE and never stored. */
export async function createKey(name: string, scopes: Scope[], by: string): Promise<{ row: KeyRow; secret: string }> {
  const k = mintKey();
  const id = "key_" + crypto.randomBytes(6).toString("hex");
  await execute(
    "INSERT INTO api_keys (id, name, hash, display, scopes, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, name.slice(0, 60) || "unnamed", k.hash, k.display, JSON.stringify(scopes), by]
  );
  const keys = await listKeys();
  const row = keys.find((r) => r.id === id)!;
  return { row, secret: k.secret };
}

export async function revokeKey(id: string): Promise<boolean> {
  const res = await execute(
    "UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id=$1 AND revoked_at IS NULL",
    [id]
  );
  return res.rowCount > 0;
}

export type KeyAuth = { id: string; name: string; scopes: Scope[] };

/**
 * Verify a presented key.
 * Looks the key up BY HASH in PostgreSQL price_iq.api_keys.
 */
export async function verifyKey(secret: string): Promise<KeyAuth | null> {
  const h = hashKey(secret);
  const row = await queryOne("SELECT * FROM api_keys WHERE hash = $1", [h]);
  if (!row || row.revoked_at) return null;
  if (!sameHash(String(row.hash), h)) return null;
  await execute("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id=$1", [String(row.id)]);
  return {
    id: String(row.id),
    name: String(row.name || ""),
    scopes: j<Scope[]>(typeof row.scopes === "string" ? row.scopes : JSON.stringify(row.scopes || []), []),
  };
}
