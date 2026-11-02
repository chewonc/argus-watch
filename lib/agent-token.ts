// Personal tokens for connecting an AI agent (Claude Code, Codex, ...) to the Argus MCP endpoint. Only a SHA-256
// hash is stored; the token is shown once. Tokens are bound to one user and grant the MCP tools only: they are
// never GitHub tokens and are never forwarded anywhere.
import { createHash, randomBytes } from "node:crypto";
import { kv } from "./store";

export type AgentToken = { hash: string; user_id: string; label: string; created_at: string; last_used_at: string | null };
const hashOf = (t: string) => createHash("sha256").update(t).digest("hex");
const K = { tok: (h: string) => `agenttok:${h}`, user: (uid: string) => `user:${uid}:agenttoks` };

export async function createAgentToken(uid: string, label: string): Promise<string> {
  const token = `aw_${randomBytes(24).toString("base64url")}`;
  const rec: AgentToken = { hash: hashOf(token), user_id: uid, label: label.slice(0, 40) || "AI agent", created_at: new Date().toISOString(), last_used_at: null };
  await kv.set(K.tok(rec.hash), rec);
  await kv.sadd(K.user(uid), rec.hash);
  return token;
}

export async function resolveAgentToken(token: string | null): Promise<AgentToken | null> {
  if (!token || !/^aw_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const rec = await kv.get<AgentToken>(K.tok(hashOf(token)));
  if (!rec) return null;
  // last-used is informational; write at most once a minute
  if (!rec.last_used_at || Date.now() - Date.parse(rec.last_used_at) > 60_000) await kv.set(K.tok(rec.hash), { ...rec, last_used_at: new Date().toISOString() });
  return rec;
}

export async function listAgentTokens(uid: string): Promise<AgentToken[]> {
  const hs = await kv.smembers(K.user(uid));
  return (await Promise.all(hs.map((h) => kv.get<AgentToken>(K.tok(h))))).filter((x): x is AgentToken => !!x).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function revokeAgentToken(uid: string, hash: string) {
  const rec = await kv.get<AgentToken>(K.tok(hash));
  if (rec?.user_id !== uid) return;
  await kv.del(K.tok(hash));
  await kv.srem(K.user(uid), hash);
}
