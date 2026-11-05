// Remediation windows, "Create draft pull requests" level: the user's consent to unattended draft PRs.
//
// The GitHub App's installation permission is what makes a write technically possible; this record is the user's
// authorization to use it without them present. It is deliberately narrow:
//   - created only while the user is signed in, after their own push access to each repository is checked with their token
//   - covers ONE window occurrence and the repositories listed in it, and expires when that occurrence ends
//   - revocable: by the user (cancel, turning the window off, deleting it), and automatically when GitHub reports the user
//     revoked the App's authorization, the installation was deleted or suspended, or a repository was removed from it
// A consent never authorizes a write by itself: lib/window-write.ts re-checks the user's live repository permission
// with the installation token and then issues the ordinary single-use grant (lib/write-auth.ts) for one exact patch.
import { randomBytes } from "node:crypto";
import { kv } from "./store";

export type Consent = {
  id: string; user_id: string; login: string; schedule_id: string; occurrence_key: string; repos: string[];
  issued_at: string; expires_at: string; revoked_at: string | null; revoked_reason: string | null;
};

const K = { one: (id: string) => `wconsent:${id}`, occ: (k: string) => `wconsent-occ:${k}`, active: "wconsents:active" };

/** Why this consent does not cover a write to `repoKey` in `occurrenceKey` at `now`, or null when it does. Pure. */
export function consentProblem(c: Consent | null, x: { userId: string; occurrenceKey: string; repoKey: string; now: number }): string | null {
  if (!c) return "you did not authorize draft PRs for this run";
  if (c.user_id !== x.userId) return "the authorization belongs to another user";
  if (c.revoked_at) return `the authorization was revoked (${c.revoked_reason ?? "revoked"})`;
  if (c.occurrence_key !== x.occurrenceKey) return "the authorization is for a different run";
  if (Date.parse(c.expires_at) <= x.now) return "the authorization expired when the run ended";
  if (!c.repos.includes(x.repoKey)) return "this repository was not included when you authorized the run";
  return null;
}

/** Record consent for one occurrence. Callers have verified the user's push access to every listed repository. Replaces an earlier consent for the same occurrence. */
export async function issueConsent(x: { userId: string; login: string; scheduleId: string; occurrenceKey: string; repos: string[]; endMs: number; now?: number }): Promise<Consent> {
  const now = x.now ?? Date.now();
  const prev = await consentFor(x.occurrenceKey);
  if (prev && !prev.revoked_at) await revoke(prev, "replaced by a new authorization", now);
  const c: Consent = { id: randomBytes(9).toString("base64url"), user_id: x.userId, login: x.login, schedule_id: x.scheduleId, occurrence_key: x.occurrenceKey, repos: [...new Set(x.repos)].sort(), issued_at: new Date(now).toISOString(), expires_at: new Date(x.endMs).toISOString(), revoked_at: null, revoked_reason: null };
  await kv.set(K.one(c.id), c); await kv.set(K.occ(c.occurrence_key), c.id); await kv.sadd(K.active, c.id);
  return c;
}

export async function consentFor(occurrenceKey: string): Promise<Consent | null> {
  const id = await kv.get<string>(K.occ(occurrenceKey));
  return id ? kv.get<Consent>(K.one(id)) : null;
}

async function revoke(c: Consent, reason: string, now = Date.now()): Promise<void> {
  await kv.set(K.one(c.id), { ...c, revoked_at: new Date(now).toISOString(), revoked_reason: reason });
  await kv.srem(K.active, c.id);
}

/** Revoke every live consent matching `match`. Returns how many were revoked. Expired ones are retired on the way. */
export async function revokeConsents(match: (c: Consent) => boolean, reason: string, now = Date.now()): Promise<number> {
  let n = 0;
  for (const id of await kv.smembers(K.active)) {
    const c = await kv.get<Consent>(K.one(id));
    if (!c || c.revoked_at) { await kv.srem(K.active, id); continue; }
    if (match(c)) { await revoke(c, reason, now); n++; }
    else if (Date.parse(c.expires_at) <= now) await kv.srem(K.active, id);
  }
  return n;
}
