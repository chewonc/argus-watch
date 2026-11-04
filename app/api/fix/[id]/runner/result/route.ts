// POST ?nonce=… with header x-argus-runner-secret — the runner's result (changed file contents, Muse Code summary,
// test execution). Argus validates (allowlist, syntax, static assessment, tests gate) and only then writes to GitHub.
import { runnerSecretOk, acceptResult, checkRunnerAuth, RunnerError, type RunnerResult } from "@/lib/runner";
import { store } from "@/lib/store";

export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(req.url);
    if (!runnerSecretOk(req)) throw new RunnerError("unauthorized", 401); // before any lookup: no fix-id oracle
    const fix = await store.getFix((await ctx.params).id);
    if (!fix) throw new RunnerError("not found", 404);
    checkRunnerAuth(fix, req, url.searchParams.get("nonce"));
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 4_000_000) throw new RunnerError("result too large", 413);
    const res = (await req.json().catch(() => null)) as RunnerResult | null;
    if (!res || typeof res.ok !== "boolean") throw new RunnerError("invalid result", 400);
    const a = await store.getAssessment(fix.assessment_id);
    if (!a) throw new RunnerError("assessment missing", 404);
    const f = await store.getFinding(a.finding_id);
    const w = await store.getRepo(fix.repo_key);
    const inst = w?.installation_id ?? (await store.getUserRepo(fix.user_id, fix.repo_key))?.installation_id;
    if (!inst) throw new RunnerError("no installation", 400);
    const out = await acceptResult(fix, a, f, inst, res);
    return Response.json({ status: out.status, pr_url: out.pr_url, error: out.error });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: e instanceof RunnerError ? e.status : 500 });
  }
}
