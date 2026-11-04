// Hosted-inference budget and usage. Monitoring, source collection, matching and alerts never depend on this:
// when a repository's users are over their monthly hosted-analysis budget, the finding is still assessed (version
// checks in code) and still alerts, as "Possible issue", and the user's own AI agent can verify it over MCP.
import { env } from "./env";
import { kv, store } from "./store";

const month = () => new Date().toISOString().slice(0, 7);
const key = (uid: string) => `hosted:${month()}:${uid}`;

/** True while at least one user of this repository still has hosted analyses left this month. */
export async function hostedBudgetLeft(repoKey: string): Promise<boolean> {
  if (env.HOSTED_ANALYSIS_CAP < 0) return true; // negative = unlimited
  const users = await store.repoUsers(repoKey);
  if (!users.length) return true; // admin-registered demo repositories
  const used = await Promise.all(users.map((u) => kv.get<number>(key(u))));
  return used.some((n) => (n ?? 0) < env.HOSTED_ANALYSIS_CAP);
}

/** Hosted analyses charged to this user this month, and the cap (negative = unlimited). */
export async function hostedUsedBy(uid: string): Promise<{ used: number; cap: number }> {
  return { used: (await kv.get<number>(key(uid))) ?? 0, cap: env.HOSTED_ANALYSIS_CAP };
}

export async function chargeHosted(repoKey: string) {
  for (const u of await store.repoUsers(repoKey)) await kv.incr(key(u));
}

/** Every Meta Model API call site, by the usage name it is counted under in lib/spark.ts. */
export const USAGE_NAMES = ["claim", "verify", "investigate", "assessment", "fix", "simulate", "translate", "timeline", "timeline_summary", "timeline_wonder"] as const;

export async function usageSummary(m = month(), names: readonly string[] = ["claim", "assessment", "fix"]): Promise<Record<string, { calls: number; tokens: number; searches?: number }>> {
  const out: Record<string, { calls: number; tokens: number; searches?: number }> = {};
  for (const n of names) {
    out[n] = { calls: (await kv.get<number>(`usage:${m}:${n}:calls`)) ?? 0, tokens: (await kv.get<number>(`usage:${m}:${n}:tokens`)) ?? 0 };
    const s = await kv.get<number>(`usage:${m}:${n}:searches`); if (s) out[n].searches = s;
  }
  return out;
}
