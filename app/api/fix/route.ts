// POST {assessment_id, force?} -> draft a fix (read-only: nothing is written to GitHub here).
import { env } from "@/lib/env";
import { draftFix } from "@/lib/fix";
import { isVerified } from "@/lib/labels";
import { canSee, currentUser } from "@/lib/session";
import { store } from "@/lib/store";

export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!env.FIX_ENABLED) return Response.json({ error: "fix drafting is turned off on this deployment" }, { status: 403 });
  const { assessment_id, force } = (await req.json().catch(() => ({}))) as { assessment_id?: string; force?: boolean };
  if (!assessment_id) return Response.json({ error: "assessment_id required" }, { status: 400 });
  const a = await store.getAssessment(assessment_id);
  if (!a || !(await canSee(user.id, a.repo))) return Response.json({ error: "not found" }, { status: 404 });
  if (a.verdict === "Not Affected") return Response.json({ error: "no fix is proposed for a Not Affected verdict" }, { status: 400 });
  // Code changes are proposed only for confirmed findings; possible issues are verified first (read-only).
  if (!isVerified(a)) return Response.json({ error: "this finding is not confirmed yet: verify it first; a fix is only drafted for confirmed findings" }, { status: 409 });
  if (!force) { const existing = (await store.listFixes(a.id)).find((x) => x.status === "drafted" || x.status === "pr_created"); if (existing) return Response.json({ fix: existing, reused: true }); }
  const f = await store.getFinding(a.finding_id);
  const items = f ? (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x) => !!x) : [];
  const fix = await draftFix(a, f, items, user.id);
  return Response.json({ fix });
}
