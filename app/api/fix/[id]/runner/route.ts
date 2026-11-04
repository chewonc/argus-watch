// POST ?nonce=… with header x-argus-runner-secret — called once by the isolated GitHub Actions runner to fetch its
// brief (allowed files, conditions, preview, a short-lived clone token and a per-fix MCP token). Not for browsers.
import { runnerSecretOk, briefFor, checkRunnerAuth, RunnerError } from "@/lib/runner";
import { store } from "@/lib/store";

export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(req.url);
    if (!runnerSecretOk(req)) throw new RunnerError("unauthorized", 401); // before any lookup: no fix-id oracle
    const fix = await store.getFix((await ctx.params).id);
    if (!fix) throw new RunnerError("not found", 404);
    checkRunnerAuth(fix, req, url.searchParams.get("nonce"));
    const a = await store.getAssessment(fix.assessment_id);
    if (!a) throw new RunnerError("assessment missing", 404);
    const f = await store.getFinding(a.finding_id);
    const w = await store.getRepo(fix.repo_key);
    const inst = w?.installation_id ?? (await store.getUserRepo(fix.user_id, fix.repo_key))?.installation_id;
    if (!inst) throw new RunnerError("no installation", 400);
    const body = (await req.json().catch(() => ({}))) as { run_url?: string };
    const runUrl = typeof body.run_url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+/.test(body.run_url) ? body.run_url : null;
    return Response.json(await briefFor(fix, a, f, inst, runUrl));
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: e instanceof RunnerError ? e.status : 500 });
  }
}
