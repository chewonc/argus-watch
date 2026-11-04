// Public, read-only demo: findings on the evaluation fixtures that ship in this public repository
// (chewonc/argus-watch/feasibility/cases/*), registered as shared demo repositories. Nothing else is reachable
// without sign-in: an assessment is public only if its repository is BOTH a system (demo) repository AND one of the
// public fixture paths. No user data, fixes, notifications or agent reports are exposed.
import type { Assessment } from "./schema";
import { isSystemRepo } from "./session";
import { store } from "./store";

export const DEMO_PREFIX = "chewonc/argus-watch/feasibility/cases/";

export async function isPublicDemoRepo(repoKey: string): Promise<boolean> {
  return repoKey.startsWith(DEMO_PREFIX) && !repoKey.slice(DEMO_PREFIX.length).includes("..") && (await isSystemRepo(repoKey));
}

/** Latest assessment per (finding, demo repository), newest first. */
export async function demoAssessments(): Promise<Assessment[]> {
  const latest = new Map<string, Assessment>();
  for (const a of await store.listAssessments(1000)) {
    if (!a.repo.startsWith(DEMO_PREFIX)) continue;
    const k = `${a.finding_id}|${a.repo}`;
    if (!latest.has(k) || latest.get(k)!.timestamps.processed_at < a.timestamps.processed_at) latest.set(k, a);
  }
  const out: Assessment[] = [];
  for (const a of latest.values()) if (await isPublicDemoRepo(a.repo)) out.push({ ...a, agent: undefined }); // agent reports are per user: never public
  return out.sort((x, y) => y.timestamps.processed_at.localeCompare(x.timestamps.processed_at));
}

export async function demoAssessment(id: string): Promise<Assessment | null> {
  const a = await store.getAssessment(id);
  if (!a || !(await isPublicDemoRepo(a.repo))) return null;
  return { ...a, agent: undefined };
}

export const demoHref = (aid: string) => `/demo/${aid.split("/").map(encodeURIComponent).join("/")}`;
