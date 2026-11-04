// POST — stop a remediation in the backend (not just in the UI): queued/running runs lose their single-use runner
// credential (no brief, no result is accepted) and the GitHub Actions run is cancelled when its id is known; a
// validated patch is discarded; an automatic merge is cancelled (the PR stays open). Refused while the PR is being
// created. GET says whether and how the current state can be cancelled.
import { cancellable, cancelRun, RunnerError } from "@/lib/runner";
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";

async function own(id: string) {
  const user = await currentUser();
  if (!user) throw new RunnerError("unauthorized", 401);
  const fix = await store.getFix(id);
  if (!fix) throw new RunnerError("not found", 404);
  if (fix.user_id !== user.id) throw new RunnerError("only the user who started this fix can cancel it", 403);
  return { user, fix };
}
const fail = (e: unknown) => Response.json({ error: String((e as Error).message ?? e) }, { status: e instanceof RunnerError ? e.status : 500 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { const { fix } = await own((await ctx.params).id); return Response.json(cancellable(fix)); } catch (e) { return fail(e); }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { const { user, fix } = await own((await ctx.params).id); return Response.json({ fix: await cancelRun(fix, user.login) }); } catch (e) { return fail(e); }
}
