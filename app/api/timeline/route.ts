// POST {assessment_id, force?} -> the Threat Timeline for the assessment's finding (lib/timeline.ts) plus the
// repository lane (Argus's own records for this repository). Read-only; cached per finding version.
import { assessmentFor } from "@/lib/authz";
import { fixesFor } from "@/lib/authz";
import { canSee, currentUser } from "@/lib/session";
import { store } from "@/lib/store";
import { buildTimeline, repoEvents } from "@/lib/timeline";
import type { Item } from "@/lib/schema";

export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { assessment_id, force } = (await req.json().catch(() => ({}))) as { assessment_id?: string; force?: boolean };
  if (!assessment_id) return Response.json({ error: "assessment_id required" }, { status: 400 });
  const a = await assessmentFor(user.id, assessment_id);
  if (!a || !(await canSee(user.id, a.repo))) return Response.json({ error: "not found" }, { status: 404 });
  const f = await store.getFinding(a.finding_id);
  if (!f) return Response.json({ error: "threat record not found" }, { status: 404 });
  const items = (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x): x is Item => !!x);
  try {
    const t = await buildTimeline(f, items, { force: !!force });
    if (force) await store.log({ kind: "process", source: "timeline", detail: `${t.events.length} event(s); model accepted ${t.model.accepted}/${t.model.proposed}${t.wonder.reviews.length ? `; wonder ${t.wonder.reviews[0].resolution}` : ""}`, ref: f.id });
    return Response.json({ timeline: t, repo: repoEvents(a, await fixesFor(user.id, a.id)) });
  } catch (e) {
    return Response.json({ error: `timeline failed: ${String((e as Error).message ?? e).slice(0, 200)}` }, { status: 502 });
  }
}
