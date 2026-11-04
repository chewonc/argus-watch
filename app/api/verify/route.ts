// POST {assessment_id} — run a fresh, read-only verification of one finding against the repository's current commit.
// The verification itself lives in lib/reverify.ts (shared with autonomous remediation windows): candidate files at the
// pinned commit, Muse Spark proposes a state per condition with a file:line citation, SaveBell re-reads every cited line
// (uncited or mismatched claims are dropped), and the verdict comes from the fixed rule in lib/verdict.ts.
// Read-only: nothing is written to the repository. The result is stored as a NEW assessment record (the earlier one is
// kept, never overwritten), exactly as a pipeline re-run would, so the finding's status follows the same evidence rules.
// Scoped: the caller must be able to see the repository; one run per user and finding every 10 minutes; hosted budget applies.
import { oneWithAgentFor } from "@/lib/authz";
import { env } from "@/lib/env";
import { reverify, ReverifyError } from "@/lib/reverify";
import { canSee, currentUser } from "@/lib/session";
import { store } from "@/lib/store";
import { hostedBudgetLeft } from "@/lib/usage";

export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!env.META_API_KEY) return Response.json({ error: "Verification is not available on this deployment (the Meta model is not configured)." }, { status: 503 });
  const { assessment_id } = (await req.json().catch(() => ({}))) as { assessment_id?: string };
  const prev = assessment_id ? await store.getAssessment(assessment_id) : null;
  if (!prev || !(await canSee(user.id, prev.repo))) return Response.json({ error: "not found" }, { status: 404 });
  // Checked before the rate-limit claim so a refused request does not use up the 10-minute slot (lib/reverify.ts re-checks).
  if (!(await hostedBudgetLeft(prev.repo))) return Response.json({ error: "This month's analysis limit for this repository is used up, so a new check cannot run now." }, { status: 429 });
  const bucket = Math.floor(Date.now() / 600e3);
  if (!(await store.claim(`verify:${user.id}:${prev.finding_id}:${prev.repo}:${bucket}`))) return Response.json({ error: "This finding was just checked. Try again in a few minutes." }, { status: 429 });
  try {
    const { assessment, ms } = await reverify(prev, "verify");
    return Response.json({ assessment: await oneWithAgentFor(user.id, assessment), previous_id: prev.id, ms });
  } catch (e) {
    if (e instanceof ReverifyError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
