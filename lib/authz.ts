// Central authorization for user-facing reads: the one place that decides what a signed-in user may see.
// Ownership model (lib/store.ts): findings/items are public threat intelligence; repositories, assessments and the audit
// log are shared objects without an owner; fixes, notifications, settings, agent tokens and agent reports belong to one
// user. Every user-facing response passes shared objects through these helpers:
//   fixesFor           only the caller's own remediation jobs, patches and PRs (V3)
//   withAgentFor       only the caller's own AI-agent report on a shared assessment (V4)
//   redactFinding      no other users' repository names in relevant_repos (V2)
//   logVisibleTo       audit-log entries about the caller's repositories, or about no repository at all (V1, V7)
import type { Assessment, Finding, Fix, LogEntry } from "./schema";
import { SYSTEM_USER, store } from "./store";

/** The caller's own fix records for an assessment. Other users watching the same repository never see them. */
export async function fixesFor(uid: string, assessmentId: string): Promise<Fix[]> {
  return (await store.listFixes(assessmentId)).filter((f) => f.user_id === uid);
}

/** A fix the caller owns, or null (callers answer 404 so ids cannot be probed). */
export async function ownFix(uid: string, fixId: string): Promise<Fix | null> {
  const f = await store.getFix(fixId);
  return f && f.user_id === uid ? f : null;
}

type Agent = NonNullable<Assessment["agent"]>;

/**
 * Personalize shared assessments: `agent` becomes the caller's own report. Reports written before per-user storage
 * (legacy `assessment.agent`) are shown only to a user who is the repository's sole real watcher, since the writer is
 * unknown; on shared demo repositories they are hidden from everyone.
 */
export async function withAgentFor<T extends Assessment>(uid: string, as: T[]): Promise<T[]> {
  if (!as.length) return as;
  const own = await store.getAgentReports(uid, as.map((a) => a.id));
  const soleWatcher = new Map<string, boolean>();
  for (const k of new Set(as.filter((a, i) => !own[i] && a.agent).map((a) => a.repo))) {
    const users = await store.repoUsers(k);
    soleWatcher.set(k, !users.includes(SYSTEM_USER) && users.length === 1 && users[0] === uid);
  }
  return as.map((a, i) => ({ ...a, agent: own[i] ?? (a.agent && soleWatcher.get(a.repo) ? a.agent : undefined) }));
}
export const oneWithAgentFor = async <T extends Assessment>(uid: string, a: T): Promise<T> => (await withAgentFor(uid, [a]))[0];

/** A finding as one user may see it: relevant_repos limited to repositories that user can see. */
export function redactFinding(f: Finding, visible: Set<string>): Finding {
  return { ...f, relevant_repos: f.relevant_repos.filter((r) => visible.has(r)) };
}

const REPO_RE = /\b[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}\b/g;
/**
 * Whether an audit-log entry may be shown to a user: it concerns one of their repositories, or it names no repository
 * and is not about a user action (pipeline heartbeats, polls). Entries about other users' repositories or accounts are
 * never shown. `known` = every watched repository (owner/name), so unknown "a/b" strings (URLs, paths) are not counted.
 */
export function logVisibleTo(e: Pick<LogEntry, "kind" | "detail" | "ref">, visible: Set<string>, known: Set<string>): boolean {
  const text = `${e.detail} ${e.ref ?? ""}`;
  const mentioned = [...new Set((text.match(REPO_RE) ?? []).filter((m) => known.has(m)))];
  const mine = new Set([...visible].map((k) => k.split("/").slice(0, 2).join("/")));
  if (mentioned.length) return mentioned.every((m) => mine.has(m));
  return !(e.kind === "auth" || e.kind === "fix" || e.kind === "notify" || e.kind === "alert");
}

export async function knownRepoNames(): Promise<Set<string>> {
  return new Set((await store.listRepos()).map((w) => w.repo.split("/").slice(0, 2).join("/")));
}

export type { Agent };

/** Load one assessment personalized for the caller (their own agent report only). Visibility is still checked by the caller with canSee. */
export async function assessmentFor(uid: string, id: string): Promise<Assessment | null> {
  const a = await store.getAssessment(id);
  return a ? oneWithAgentFor(uid, a) : null;
}
