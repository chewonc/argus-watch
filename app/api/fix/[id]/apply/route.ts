// POST: the user's explicit approval. Checks: session, fix owner, per-repo allow_pr, not a shared demo repo,
// App installation present. Then branch + commit + DRAFT pull request (lib/fix-apply.ts). Never merges.
import { assertUserCanWrite } from "@/lib/access";
import { applyFix } from "@/lib/fix-apply";
import { env, hasGitHubApp } from "@/lib/env";
import { notifyFix } from "@/lib/notify";
import { writeModeFor } from "@/lib/remediation-mode";
import { currentUser, githubUserToken, isSystemRepo } from "@/lib/session";
import { event } from "@/lib/runner-gates";
import { patchVersion } from "@/lib/remediation-control";
import { store } from "@/lib/store";
import { recordApproval, revoke, WriteAuthError } from "@/lib/write-auth";

export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!env.FIX_ENABLED) return Response.json({ error: "fixes are turned off on this deployment" }, { status: 403 });
  const fix = await store.getFix((await ctx.params).id);
  if (!fix) return Response.json({ error: "not found" }, { status: 404 });
  if (fix.user_id !== user.id) return Response.json({ error: "only the user who drafted this fix can approve it" }, { status: 403 });
  // A failed apply (e.g. the App's write permission not yet accepted → 403) may be retried without re-drafting.
  if (fix.status !== "drafted" && fix.status !== "failed") return Response.json({ error: `fix is ${fix.status}` , fix }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { reviewed?: boolean; mode?: string; patch_version?: string };
  if (!body.reviewed) return Response.json({ error: "approval requires confirming that the diff was reviewed" }, { status: 400 });
  const wm = writeModeFor(body.mode);
  if (!wm.ok || wm.mode === "push") return Response.json({ error: wm.ok ? "automatic merge is only offered for validated runner patches" : wm.error }, { status: 409 });
  if (await isSystemRepo(fix.repo_key)) return Response.json({ error: "shared demo repositories cannot receive pull requests" }, { status: 403 });
  const ur = await store.getUserRepo(user.id, fix.repo_key);
  if (!ur?.allow_pr) return Response.json({ error: "draft pull requests are not enabled for this repository (Repos → Allow draft pull requests)" }, { status: 403 });
  const w = await store.getRepo(fix.repo_key);
  const inst = w?.installation_id ?? ur.installation_id;
  if (!hasGitHubApp() || !inst) return Response.json({ error: "this repository is not connected through the GitHub App installation, so no write is possible" }, { status: 403 });
  try { await assertUserCanWrite(await githubUserToken(), fix.repo_key); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 403 }); } // V6
  const a = await store.getAssessment(fix.assessment_id);
  if (!a) return Response.json({ error: "assessment missing" }, { status: 404 });
  const f = await store.getFinding(a.finding_id);
  // Bind the approval to the exact proposal the user reviewed (patch_version) and the destination from the preference.
  let approved;
  try {
    approved = await recordApproval(fix.id, { userId: user.id, userLogin: user.login, reviewedVersion: String(body.patch_version ?? ""), action: wm.mode === "branch" ? "branch" : "pr", defaultBranch: w?.default_branch ?? "main", event,
      detail: "approved the proposed change",
      check: (x, v) => {
        if (x.status !== "drafted" && x.status !== "failed") throw new WriteAuthError(`fix is ${x.status}`, 409);
        if (!x.patch_version || v !== x.patch_version || patchVersion(x.files) !== x.patch_version) throw new WriteAuthError("the proposed change differs from what you reviewed; review it again", 409);
      } });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: e instanceof WriteAuthError ? e.status : 500 }); }
  try {
    const done = await applyFix({ ...approved, mode: wm.mode }, a, f, inst, { openPr: wm.mode !== "branch" });
    if (done.pr_number) await notifyFix(user.id, "fix_pr_created", a, f, `${fix.repo}#${done.pr_number}`).catch(() => {});
    return Response.json({ fix: done });
  } catch (e) {
    const status = (e as { status?: number }).status;
    const msg = String((e as { message?: string }).message ?? e).slice(0, 300);
    const fresh = (await store.getFix(fix.id)) ?? approved;
    const failed = { ...fresh, status: "failed" as const, error: msg, grant: revoke(fresh.grant) }; // a retry needs a new approval
    await store.putFix(failed);
    await store.log({ kind: "fix", source: "apply", detail: `failed (${status ?? "?"}): ${msg}`, ref: fix.assessment_id });
    if (e instanceof WriteAuthError) return Response.json({ error: `write refused: ${e.message}`, fix: failed }, { status: e.status });
    return Response.json({ error: status === 403 ? `GitHub refused the write (${msg}). The App installation may not have accepted Contents/Pull requests write permission yet.` : msg, fix: failed }, { status: status === 409 ? 409 : 502 });
  }
}
