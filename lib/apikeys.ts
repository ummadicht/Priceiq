import { db, j } from "./db.ts";
import { mintKey, hashKey, sameHash, type Scope } from "../core/apikey.ts";
import crypto from "node:crypto";

export type KeyRow = {
  id: string; name: string; display: string; scopes: Scope[];
  createdBy: string; createdAt: string; lastUsedAt: string | null; revoked: boolean;
};

export function listKeys(): KeyRow[] {
  return (db().prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as Array<Record<string, unknown>>)
    .map((r) => ({
      id: String(r.id), name: String(r.name || ""), display: String(r.display || ""),
      scopes: j<Scope[]>(String(r.scopes || "[]"), []),
      createdBy: String(r.created_by || ""), createdAt: String(r.created_at || ""),
      lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
      revoked: !!r.revoked_at,
    }));
}

/** Create a key. The secret is returned ONCE and never stored. */
export function createKey(name: string, scopes: Scope[], by: string): { row: KeyRow; secret: string } {
  const k = mintKey();
  const id = "key_" + crypto.randomBytes(6).toString("hex");
  db().prepare(
    "INSERT INTO api_keys (id, name, hash, display, scopes, created_by) VALUES (?,?,?,?,?,?)"
  ).run(id, name.slice(0, 60) || "unnamed", k.hash, k.display, JSON.stringify(scopes), by);
  const row = listKeys().find((r) => r.id === id)!;
  return { row, secret: k.secret };
}

export function revokeKey(id: string): boolean {
  return db().prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id=? AND revoked_at IS NULL")
    .run(id).changes > 0;
}

export type KeyAuth = { id: string; name: string; scopes: Scope[] };

/**
 * Verify a presented key.
 *
 * Looks the key up BY HASH rather than scanning and comparing — the index does
 * the work, and the only comparison left is constant-time. `last_used_at` is
 * stamped so an unused key can be spotted and retired.
 */
export function verifyKey(secret: string): KeyAuth | null {
  const h = hashKey(secret);
  const row = db().prepare("SELECT * FROM api_keys WHERE hash = ?").get(h) as Record<string, unknown> | undefined;
  if (!row || row.revoked_at) return null;
  if (!sameHash(String(row.hash), h)) return null;
  db().prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id=?").run(String(row.id));
  return { id: String(row.id), name: String(row.name || ""), scopes: j<Scope[]>(String(row.scopes || "[]"), []) };
}
