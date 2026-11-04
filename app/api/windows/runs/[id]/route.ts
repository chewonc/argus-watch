// GET  -> one remediation-window run (owner only), for the live run page.
// POST {action: "pause"|"resume"|"cancel"|"step"} -> user controls. "step" runs one bounded step now (same limits,
// same per-minute claim as the scheduler tick), so a run can be advanced without waiting for the next 5-minute tick.
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";
import { windowDeps } from "@/lib/window-deps";
import { controlRun, stepRun, type WindowRun } from "@/lib/window-run";

export const maxDuration = 300;

async function own(id: string) {
  const user = await currentUser();
  if (!user) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const run = await store.getRun<WindowRun>(id);
  if (!run || run.user_id !== user.id) return { error: Response.json({ error: "not found" }, { status: 404 }) };
  return { user, run };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const o = await own(decodeURIComponent((await ctx.params).id));
  return o.error ?? Response.json({ run: o.run });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const o = await own(decodeURIComponent((await ctx.params).id));
  if (o.error) return o.error;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (action === "step") { const r = await stepRun(o.run.id, windowDeps()); return Response.json({ run: r.run, did: r.did }); }
    if (action === "pause" || action === "resume" || action === "cancel") return Response.json({ run: await controlRun(o.run.id, o.user.id, action, windowDeps()) });
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: String((e as Error).message ?? e) }, { status: 409 }); }
}
