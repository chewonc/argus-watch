// POST {assessment_id} — run a fresh, read-only verification of one finding against the repository's current commit.
// Reuses the pipeline's analyzer (lib/analyze.ts assess): candidate files at the pinned commit, Muse Spark proposes a
// state per condition with a file:line citation, Argus re-reads every cited line (uncited or mismatched claims are
// dropped), and the verdict comes from the fixed rule in lib/verdict.ts, never from the model's opinion.
// Read-only: nothing is written to the repository. The result is stored as a NEW assessment record (the earlier one is
// kept, never overwritten), exactly as a pipeline re-run would, so the finding's status follows the same evidence rules.
// Scoped: the caller must be able to see the repository; one run per user and finding every 10 minutes; hosted budget applies.
import { assess } from "@/lib/analyze";
import { oneWithAgentFor } from "@/lib/authz";
import { env } from "@/lib/env";
import { canSee, currentUser } from "@/lib/session";
import { store } from "@/lib/store";
import { chargeHosted, hostedBudgetLeft } from "@/lib/usage";

export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!env.META_API_KEY) return Response.json({ error: "Verification is not available on this deployment (the Meta model is not configured)." }, { status: 503 });
  const { assessment_id } = (await req.json().catch(() => ({}))) as { assessment_id?: string };
  const prev = assessment_id ? await store.getAssessment(assessment_id) : null;
  if (!prev || !(await canSee(user.id, prev.repo))) return Response.json({ error: "not found" }, { status: 404 });
  const f = await store.getFinding(prev.finding_id);
  const repo = await store.getRepo(prev.repo);
  if (!f?.claim || !repo?.sha) return Response.json({ error: "This finding cannot be re-checked yet: its threat details or the repository snapshot are missing." }, { status: 409 });
  if (!(await hostedBudgetLeft(prev.repo))) return Response.json({ error: "This month's analysis limit for this repository is used up, so a new check cannot run now." }, { status: 429 });
  const bucket = Math.floor(Date.now() / 600e3);
  if (!(await store.claim(`verify:${user.id}:${prev.finding_id}:${prev.repo}:${bucket}`))) return Response.json({ error: "This finding was just checked. Try again in a few minutes." }, { status: 429 });

  const items = (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x) => !!x);
  // Same credibility rule as the pipeline: a disputed report is assessed at the lowest tier and can never become "Affected".
  const cred = f.credibility?.label;
  const fx = cred === "disputed" || cred === "likely_false" || (cred === "unverified" && f.tier === "corroborated") ? { ...f, tier: "signal" as const } : f;
  const t0 = Date.now();
  let a;
  try { a = await assess(fx, f.claim, repo, { items, budget: true }); }
  catch (e) { return Response.json({ error: `The check could not finish: ${String((e as Error).message ?? e).slice(0, 160)}` }, { status: 502 }); }
  if (a.hosted === "model" && a.model !== "none") await chargeHosted(prev.repo);
  // New record, earlier evidence kept: suffix the id when the same commit/claim version already has an assessment.
  const id = (await store.getAssessment(a.id)) ? `${a.id}:v${Date.now().toString(36)}` : a.id;
  const saved = { ...a, id, timestamps: { ...a.timestamps, discovered_at: prev.timestamps.discovered_at, notified_at: prev.timestamps.notified_at } };
  await store.putAssessment(saved);
  await store.log({ kind: "process", source: "verify", detail: `on-demand verification of ${prev.repo}: ${saved.verdict} (${saved.conditions.filter((c) => c.state === "Observed").length} observed condition(s))`, ref: id, ms: Date.now() - t0 });
  return Response.json({ assessment: await oneWithAgentFor(user.id, saved), previous_id: prev.id, ms: Date.now() - t0 });
}
