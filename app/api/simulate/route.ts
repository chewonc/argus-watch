// POST {assessment_id, force?} -> a grounded, hypothetical end-user impact walkthrough (lib/simulate.ts). Read-only:
// one Meta Muse Spark call per assessment/fix version, cached. Nothing is executed against any system.
import { canSee, currentUser } from "@/lib/session";
import { simulate } from "@/lib/simulate";
import { store } from "@/lib/store";

export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { assessment_id, force, locale } = (await req.json().catch(() => ({}))) as { assessment_id?: string; force?: boolean; locale?: string };
  if (!assessment_id) return Response.json({ error: "assessment_id required" }, { status: 400 });
  const a = await store.getAssessment(assessment_id);
  if (!a || !(await canSee(user.id, a.repo))) return Response.json({ error: "not found" }, { status: 404 });
  if (a.verdict === "Not Affected") return Response.json({ error: "this threat does not affect the repository, so there is no user impact to simulate" }, { status: 400 });
  const f = await store.getFinding(a.finding_id);
  const fix = (await store.listFixes(a.id)).find((x) => x.files.length > 0) ?? null;
  try {
    const sim = await simulate(a, f, fix, { force: !!force, locale: typeof locale === "string" ? locale.slice(0, 12) : "en" });
    await store.log({ kind: "process", source: "simulate", detail: `${sim.applicable ? `${sim.steps.length} step(s)` : "not applicable"}; ${sim.downgraded} claim(s) downgraded to hypothetical`, ref: a.id, ms: sim.ms });
    return Response.json({ simulation: sim });
  } catch (e) {
    return Response.json({ error: `simulation failed: ${String((e as Error).message ?? e).slice(0, 200)}` }, { status: 502 });
  }
}
