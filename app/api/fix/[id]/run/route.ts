// POST {mode: "pr"|"push", reviewed: true} — the user's explicit authorization for automated remediation by
// Meta Muse Code. Same preconditions as a manual draft PR (session, fix owner, FIX_ENABLED, per-repo allow_pr,
// not a shared demo repo, App installation with write permission), then the isolated runner is dispatched.
// GET returns what the authorization dialog must show (allowed files, detected test command, runner availability).
import { assertUserCanWrite } from "@/lib/access";
import { isStaleRun } from "@/lib/run-stale";
import { env, hasGitHubApp, hasRunner } from "@/lib/env";
import { installationPermissions } from "@/lib/github-app";
import { destinationOf, modeOf, needsWrite, type RemediationMode } from "@/lib/remediation-mode";
import { allowedFilesFor, detectTestCommand, RunnerError, startRun } from "@/lib/runner";
import { currentUser, githubUserToken, isSystemRepo } from "@/lib/session";
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

/** Why the isolated runner cannot start, in the order the server enforces. Deployment configuration first, then repository permissions. */
async function runBlockers(repoKey: string, ur: { allow_pr?: boolean } | null, inst: number | null, mode: RemediationMode): Promise<string[]> {
  const b: string[] = [];
  if (!env.FIX_ENABLED) b.push("Deployment configuration: automated fixes are turned off on this deployment (FIX_ENABLED).");
  else if (!hasRunner()) b.push("Deployment configuration: the Muse Code runner is not configured (RUNNER_DISPATCH_TOKEN, ARGUS_RUNNER_SECRET).");
  if (await isSystemRepo(repoKey)) b.push("Shared demo repositories never receive changes.");
  if (!hasGitHubApp() || !inst) b.push("Repository permission: this repository is not connected through the SaveBell GitHub App, so the runner cannot read it.");
  else if (needsWrite(mode)) {
    if (!ur?.allow_pr) b.push("Repository permission: changes are off for this repository (Repositories → Allow changes), or choose \"No repository writes\" in Settings.");
    const p = await installationPermissions(inst).catch(() => ({} as Record<string, string>));
    if (p.contents !== "write" || (mode === "pr" && p.pull_requests !== "write")) b.push(`Repository permission: the GitHub App installation lacks ${mode === "pr" ? "Contents and Pull requests" : "Contents"} write access.`);
  }
  return b;
}

const fail = (e: unknown) => Response.json({ error: String((e as Error).message ?? e) }, { status: e instanceof RunnerError ? e.status : 500 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, fix, a, ur, w, inst } = await load((await ctx.params).id);
    const mode = destinationOf(new URL(_req.url).searchParams.get("mode"), modeOf(user.settings));
    const blockers = await runBlockers(fix.repo_key, ur, inst, mode);
    const test = await detectTestCommand(fix.repo, fix.base_sha, a.repo.split("/").slice(2).join("/")).catch(() => null);
    return Response.json({ allowed_files: allowedFilesFor(a, fix), test_command: test, default_branch: w?.default_branch ?? "main", blockers, mode });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, fix, a, ur, inst } = await load((await ctx.params).id);
    if (!env.FIX_ENABLED) throw new RunnerError("automated fixes are turned off on this deployment (FIX_ENABLED)", 403);
    const body = (await req.json().catch(() => ({}))) as { mode?: string; reviewed?: boolean };
    // The destination chosen in the modal for this attempt (default: the saved preference). Starting the runner writes nothing.
    const mode = destinationOf(body.mode, modeOf(user.settings));
    if (!body.reviewed) throw new RunnerError("authorization requires confirming that the proposed change was reviewed", 400);
    // A run that never reported back (runner died before its first callback) may be re-authorized after 20 minutes.
    const stale = isStaleRun(fix);
    if (!["drafted", "failed", "validation_failed", "cancelled"].includes(fix.status) && !stale) throw new RunnerError(`fix is ${fix.status}`, 409);
    const blockers = await runBlockers(fix.repo_key, ur, inst, mode);
    if (blockers.length) throw new RunnerError(blockers[0], 403);
    // Write-capable destinations need the user's own GitHub push permission (V6); preview mode only reads.
    if (needsWrite(mode)) await assertUserCanWrite(await githubUserToken(), fix.repo_key).catch((e) => { throw new RunnerError(String((e as Error).message), 403); });
    // The runner never writes; the stored mode only records the destination the user saw when starting it.
    // One run per attempt state: a double click or two tabs cannot dispatch two runners for the same fix.
    if (!(await store.claim(`run:${fix.id}:${fix.events.length}:${fix.status}`))) throw new RunnerError("this fix is already starting", 409);
    const out = await startRun(fix, a, mode === "branch" ? "branch" : mode === "preview" ? "preview" : "pr", user.login);
    return Response.json({ fix: out });
  } catch (e) { return fail(e); }
}
