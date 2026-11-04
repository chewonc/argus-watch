// A fresh, read-only verification of one finding against the repository's current commit, shared by the on-demand
// route (app/api/verify) and autonomous remediation windows (lib/window-run.ts) so both follow the same evidence rules.
// Reuses the pipeline's analyzer (lib/analyze.ts assess); the verdict comes from the fixed rule in lib/verdict.ts.
// The result is stored as a NEW assessment record; the earlier one is kept.
import { assess } from "./analyze";
import type { Assessment } from "./schema";
import { store } from "./store";
import { chargeHosted, hostedBudgetLeft } from "./usage";

export class ReverifyError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function reverify(prev: Assessment, actor: string): Promise<{ assessment: Assessment; ms: number }> {
  const f = await store.getFinding(prev.finding_id);
  const repo = await store.getRepo(prev.repo);
  if (!f?.claim || !repo?.sha) throw new ReverifyError("This finding cannot be re-checked yet: its threat details or the repository snapshot are missing.", 409);
  if (!(await hostedBudgetLeft(prev.repo))) throw new ReverifyError("This month's analysis limit for this repository is used up, so a new check cannot run now.", 429);
  const items = (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x) => !!x);
  // Same credibility rule as the pipeline: a disputed report is assessed at the lowest tier and can never become "Affected".
  const cred = f.credibility?.label;
  const fx = cred === "disputed" || cred === "likely_false" || (cred === "unverified" && f.tier === "corroborated") ? { ...f, tier: "signal" as const } : f;
  const t0 = Date.now();
  let a;
  try { a = await assess(fx, f.claim, repo, { items, budget: true }); }
  catch (e) { throw new ReverifyError(`The check could not finish: ${String((e as Error).message ?? e).slice(0, 160)}`, 502); }
  if (a.hosted === "model" && a.model !== "none") await chargeHosted(prev.repo);
  const id = (await store.getAssessment(a.id)) ? `${a.id}:v${Date.now().toString(36)}` : a.id;
  const saved = { ...a, id, timestamps: { ...a.timestamps, discovered_at: prev.timestamps.discovered_at, notified_at: prev.timestamps.notified_at } };
  await store.putAssessment(saved);
  await store.log({ kind: "process", source: actor, detail: `verification of ${prev.repo}: ${saved.verdict} (${saved.conditions.filter((c) => c.state === "Observed").length} observed condition(s))`, ref: id, ms: Date.now() - t0 });
  return { assessment: saved, ms: Date.now() - t0 };
}
