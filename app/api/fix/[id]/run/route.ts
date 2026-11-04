// POST {mode: "pr"|"push", reviewed: true} — the user's explicit authorization for automated remediation by
// Meta Muse Code. Same preconditions as a manual draft PR (session, fix owner, FIX_ENABLED, per-repo allow_pr,
// not a shared demo repo, App installation with write permission), then the isolated runner is dispatched.
// GET returns what the authorization dialog must show (allowed files, detected test command, runner availability).
import { env, hasGitHubApp, hasRunner } from "@/lib/env";
import { installationPermissions } from "@/lib/github-app";
import { allowedFilesFor, detectTestCommand, RunnerError, startRun } from "@/lib/runner";
import { currentUser, isSystemRepo } from "@/lib/session";
import { store } from "@/lib/store";

export const maxDuration = 60;

async function load(id: string) {
  const user = await currentUser();
  if (!user) throw new RunnerError("unauthorized", 401);
  const fix = await store.getFix(id);
  if (!fix) throw new RunnerError("not found", 404);
  if (fix.user_id !== user.id) throw new RunnerError("only the user who drafted this fix can authorize it", 403);
  const a = await store.getAssessment(fix.assessment_id);
  if (!a) throw new RunnerError("assessment missing", 404);
  const ur = await store.getUserRepo(user.id, fix.repo_key);
  const w = await store.getRepo(fix.repo_key);
  return { user, fix, a, ur, w, inst: w?.installation_id ?? ur?.installation_id ?? null };
}

const fail = (e: unknown) => Response.json({ error: String((e as Error).message ?? e) }, { status: e instanceof RunnerError ? e.status : 500 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { fix, a, ur, w, inst } = await load((await ctx.params).id);
    const blockers: string[] = [];
    if (!env.FIX_ENABLED) blockers.push("Automated fixes are turned off on this deployment.");
    else if (!hasRunner()) blockers.push("The Muse Code runner is not configured on this deployment.");
    if (await isSystemRepo(fix.repo_key)) blockers.push("Shared demo repositories never receive changes.");
    if (!ur?.allow_pr) blockers.push("Changes are not enabled for this repository (Repos → Allow fixes).");
    if (!hasGitHubApp() || !inst) blockers.push("This repository is not connected through the GitHub App.");
    else { const p = await installationPermissions(inst).catch(() => ({} as Record<string, string>)); if (p.contents !== "write" || p.pull_requests !== "write") blockers.push("The GitHub App installation has not been granted Contents and Pull requests write access."); }
    const test = await detectTestCommand(fix.repo, fix.base_sha, a.repo.split("/").slice(2).join("/")).catch(() => null);
    return Response.json({ allowed_files: allowedFilesFor(a, fix), test_command: test, default_branch: w?.default_branch ?? "main", blockers });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, fix, a, ur, inst } = await load((await ctx.params).id);
    if (!env.FIX_ENABLED) throw new RunnerError("automated fixes are turned off on this deployment", 403);
    const body = (await req.json().catch(() => ({}))) as { mode?: string; reviewed?: boolean };
    if (body.mode !== "pr" && body.mode !== "push") throw new RunnerError("mode must be pr or push", 400);
    if (!body.reviewed) throw new RunnerError("authorization requires confirming that the proposed change was reviewed", 400);
    if (!["drafted", "failed", "validation_failed"].includes(fix.status)) throw new RunnerError(`fix is ${fix.status}`, 409);
    if (await isSystemRepo(fix.repo_key)) throw new RunnerError("shared demo repositories never receive changes", 403);
    if (!ur?.allow_pr) throw new RunnerError("changes are not enabled for this repository (Repos → Allow fixes)", 403);
    if (!hasGitHubApp() || !inst) throw new RunnerError("this repository is not connected through the GitHub App installation", 403);
    const p = await installationPermissions(inst).catch(() => ({} as Record<string, string>));
    if (p.contents !== "write" || p.pull_requests !== "write") throw new RunnerError("the GitHub App installation lacks Contents/Pull requests write permission", 403);
    const out = await startRun(fix, a, body.mode, user.login);
    return Response.json({ fix: out });
  } catch (e) { return fail(e); }
}
