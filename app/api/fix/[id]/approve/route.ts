// POST {patch_version, mode: "pr"|"push", reviewed: true} — the user's approval of the EXACT patch Muse Code produced
// and Argus validated (status "validated"). Only now is anything written: branch + commit + pull request through the
// GitHub App. A patch_version that does not match the stored patch is refused (the user must review the current one).
// The destination is the user's saved preference (lib/remediation-mode.ts): "preview" refuses every write, "branch" pushes a
// branch without a PR, "pr" opens a draft PR ("push" = PR merged after CI, a separate per-fix opt-in). Never escalated.
import { assertUserCanWrite } from "@/lib/access";
import { env, hasGitHubApp } from "@/lib/env";
import { installationPermissions } from "@/lib/github-app";
import { writeModeFor } from "@/lib/remediation-mode";
import { approveValidated, RunnerError } from "@/lib/runner";
import { currentUser, githubUserToken, isSystemRepo } from "@/lib/session";
import { store } from "@/lib/store";

export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new RunnerError("unauthorized", 401);
    if (!env.FIX_ENABLED) throw new RunnerError("automated fixes are turned off on this deployment", 403);
    const fix = await store.getFix((await ctx.params).id);
    if (!fix) throw new RunnerError("not found", 404);
    if (fix.user_id !== user.id) throw new RunnerError("only the user who started this fix can approve it", 403);
    const body = (await req.json().catch(() => ({}))) as { patch_version?: string; mode?: string; reviewed?: boolean };
    if (!body.reviewed) throw new RunnerError("approval requires confirming that you reviewed this patch", 400);
    const wm = writeModeFor(body.mode); // the destination the user picked for this attempt; the button click authorizes it
    if (!wm.ok) throw new RunnerError(wm.error, 409);
    if (typeof body.patch_version !== "string") throw new RunnerError("patch_version required", 400);
    if (await isSystemRepo(fix.repo_key)) throw new RunnerError("shared demo repositories never receive changes", 403);
    const ur = await store.getUserRepo(user.id, fix.repo_key);
    if (!ur?.allow_pr) throw new RunnerError("changes are not enabled for this repository (Repositories → Allow draft pull requests)", 403);
    const w = await store.getRepo(fix.repo_key);
    const inst = w?.installation_id ?? ur.installation_id;
    if (!hasGitHubApp() || !inst) throw new RunnerError("this repository is not connected through the GitHub App installation", 403);
    const p = await installationPermissions(inst).catch(() => ({} as Record<string, string>));
    if (p.contents !== "write" || (wm.mode !== "branch" && p.pull_requests !== "write")) throw new RunnerError("the GitHub App installation lacks Contents/Pull requests write permission", 403);
    // The user's own GitHub permission must allow pushing; the App's permission alone is not enough (V6).
    await assertUserCanWrite(await githubUserToken(), fix.repo_key).catch((e) => { throw new RunnerError(String((e as Error).message), 403); });
    const a = await store.getAssessment(fix.assessment_id);
    if (!a) throw new RunnerError("assessment missing", 404);
    const out = await approveValidated(fix, a, await store.getFinding(a.finding_id), inst, { userLogin: user.login, patchVersion: body.patch_version, mode: wm.mode });
    return Response.json({ fix: out });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: e instanceof RunnerError ? e.status : 500 });
  }
}
