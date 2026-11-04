// POST: the user's explicit approval. Checks: session, fix owner, per-repo allow_pr, not a shared demo repo,
// App installation present. Then branch + commit + DRAFT pull request (lib/fix-apply.ts). Never merges.
import { applyFix } from "@/lib/fix-apply";
import { env, hasGitHubApp } from "@/lib/env";
import { notifyFix } from "@/lib/notify";
import { modeOf, writeModeFor } from "@/lib/remediation-mode";
import { currentUser, isSystemRepo } from "@/lib/session";
import { store } from "@/lib/store";

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
  const body = (await req.json().catch(() => ({}))) as { reviewed?: boolean; mode?: string };
  if (!body.reviewed) return Response.json({ error: "approval requires confirming that the diff was reviewed" }, { status: 400 });
  const wm = writeModeFor(modeOf(user.settings), body.mode ?? "pr");
  if (!wm.ok || wm.mode === "push") return Response.json({ error: wm.ok ? "automatic merge is only offered for validated runner patches" : wm.error }, { status: 409 });
  if (await isSystemRepo(fix.repo_key)) return Response.json({ error: "shared demo repositories cannot receive pull requests" }, { status: 403 });
  const ur = await store.getUserRepo(user.id, fix.repo_key);
  if (!ur?.allow_pr) return Response.json({ error: "draft pull requests are not enabled for this repository (Repos → Allow draft pull requests)" }, { status: 403 });
  const w = await store.getRepo(fix.repo_key);
  const inst = w?.installation_id ?? ur.installation_id;
  if (!hasGitHubApp() || !inst) return Response.json({ error: "this repository is not connected through the GitHub App installation, so no write is possible" }, { status: 403 });
  const a = await store.getAssessment(fix.assessment_id);
  if (!a) return Response.json({ error: "assessment missing" }, { status: 404 });
  const f = await store.getFinding(a.finding_id);
  try {
    const done = await applyFix({ ...fix, status: "approved", mode: wm.mode }, a, f, inst, { openPr: wm.mode !== "branch" });
    if (done.pr_number) await notifyFix(user.id, "fix_pr_created", a, f, `${fix.repo}#${done.pr_number}`).catch(() => {});
    return Response.json({ fix: done });
  } catch (e) {
    const status = (e as { status?: number }).status;
    const msg = String((e as { message?: string }).message ?? e).slice(0, 300);
    const failed = { ...fix, status: "failed" as const, error: msg };
    await store.putFix(failed);
    await store.log({ kind: "fix", source: "apply", detail: `failed (${status ?? "?"}): ${msg}`, ref: fix.assessment_id });
    return Response.json({ error: status === 403 ? `GitHub refused the write (${msg}). The App installation may not have accepted Contents/Pull requests write permission yet.` : msg, fix: failed }, { status: status === 409 ? 409 : 502 });
  }
}
