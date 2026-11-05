// Production wiring for the remediation-window driver (lib/window-run.ts). Every step reuses an existing module:
// re-verification (lib/reverify.ts), fix drafting (lib/fix.ts), the isolated runner in preview mode (lib/runner.ts),
// cancellation (lib/remediation-control.ts) and notifications. Nothing here writes to a repository.
import { createHash } from "node:crypto";
import { fixesFor, withAgentFor } from "./authz";
import { env, hasGitHubApp, hasPush, hasRunner } from "./env";
import { installationPermissions, liveBranchHead, liveUserPermission } from "./github-app";
import { consentFor } from "./window-consent";
import { openDraftPr, type WriteDeps } from "./window-write";
import { draftFix } from "./fix";
import { isVerified } from "./labels";
import { sendPushTo } from "./push";
import { cancellable, cancelRun } from "./remediation-control";
import { reverify } from "./reverify";
import { approveValidated, startRun } from "./runner";
import type { Assessment, Notification } from "./schema";
import { deriveSeverity } from "./severity";
import { isSystemRepo } from "./session";
import { ALERT_HISTORY, store } from "./store";
import { Precondition, type Candidate, type Deps, type WindowRun } from "./window-run";

const ACTOR = "automatic fix run";
/** Fix states that mean the finding is already being handled (or waits for the user): a window never starts a second attempt. */
const BUSY = new Set(["drafting", "queued", "running", "validated", "approved", "pr_created", "merging", "merged", "branch_pushed"]);

/** Repositories the user monitors and may act on: not paused, access not lost. Shared by the driver and the Settings actions. */
export async function activeRepoKeys(uid: string): Promise<string[]> {
  return (await store.listUserRepos(uid)).filter((u) => !u.paused && !u.access_lost).map((u) => u.repo_key);
}

export const windowDeps = (): Deps => ({
  now: () => Date.now(),

  activeRepos: activeRepoKeys,

  async candidates(run, repos) {
    const scope = new Set(repos);
    const [all, findings, resolved] = await Promise.all([store.listAssessments(ALERT_HISTORY), store.listFindings(), store.resolvedSet(run.user_id)]);
    const fmap = new Map(findings.map((f) => [f.id, f]));
    const latest = new Map<string, Assessment>();
    for (const a of all) { if (!scope.has(a.repo)) continue; const k = `${a.finding_id}|${a.repo}`; const p = latest.get(k); if (!p || p.timestamps.processed_at < a.timestamps.processed_at) latest.set(k, a); }
    const withAgent = await withAgentFor(run.user_id, [...latest.values()]);
    const out: Candidate[] = [];
    for (const a of withAgent) {
      if (a.verdict === "Not Affected" || a.withdrawn_at || resolved.includes(a.id)) continue;
      if ((await fixesFor(run.user_id, a.id)).some((f) => BUSY.has(f.status))) continue;
      const f = fmap.get(a.finding_id);
      out.push({ assessment_id: a.id, repo: a.repo, finding_id: a.finding_id, title: (f?.title ?? a.finding_id).slice(0, 140), severity: (a.severity ?? deriveSeverity(a, [])).level, verified: isVerified(a), kev: !!f?.sources?.includes("kev") });
    }
    return out;
  },

  async verify(assessmentId) {
    const prev = await store.getAssessment(assessmentId);
    if (!prev) throw new Precondition("assessment not found");
    if (!env.META_API_KEY) throw new Precondition("verification is not available on this deployment (the Meta model is not configured)");
    const { assessment } = await reverify(prev, "window");
    return { id: assessment.id, verdict: assessment.verdict, verified: isVerified(assessment) };
  },

  async draft(assessmentId, uid) {
    if (!env.FIX_ENABLED) throw new Precondition("automated fixes are turned off on this deployment (FIX_ENABLED)");
    const a = await store.getAssessment(assessmentId);
    if (!a) throw new Precondition("assessment not found");
    // Same rule as the Fix button: code changes are drafted only for confirmed findings.
    const [withAgent] = await withAgentFor(uid, [a]);
    if (!isVerified(withAgent)) throw new Precondition("the finding is not confirmed");
    const f = await store.getFinding(a.finding_id);
    const items = f ? (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x) => !!x) : [];
    const fix = await draftFix(a, f, items, uid);
    return { fix_id: fix.id, files: fix.status === "drafted" ? fix.files.length : 0, error: fix.error };
  },

  async runnerBlocker(repoKey, uid) {
    if (!env.FIX_ENABLED) return "automated fixes are turned off on this deployment";
    if (!hasRunner()) return "the isolated test runner is not configured on this deployment";
    if (await isSystemRepo(repoKey)) return "shared demo repositories never receive fixes";
    const ur = await store.getUserRepo(uid, repoKey);
    if (!ur || ur.paused || ur.access_lost) return "the repository is no longer monitored or accessible";
    const w = await store.getRepo(repoKey);
    if (!hasGitHubApp() || !(w?.installation_id ?? ur.installation_id)) return "the repository is not connected through the GitHub App";
    return null;
  },

  async startRunner(fixId, runId) {
    const fix = await store.getFix(fixId);
    if (!fix) throw new Error("fix not found");
    const a = await store.getAssessment(fix.assessment_id);
    if (!a) throw new Error("assessment missing");
    // Same single-start claim as the Fix dialog: a second caller cannot dispatch a second runner for this attempt.
    if (!(await store.claim(`run:${fix.id}:${fix.events.length}:${fix.status}`))) throw new Error("this fix is already starting");
    // Preview mode: the runner clones read-only and the patch waits for the user's approval. No repository write is authorized.
    await startRun({ ...fix, window_run_id: runId }, a, "preview", ACTOR);
  },

  async fixState(fixId) {
    const f = await store.getFix(fixId);
    if (!f) return null;
    const t = f.runner?.tests;
    const tests = t?.executed ? (t.summary ? `${t.summary.passed} of ${t.summary.total} tests passed` : `${t.command} exited ${t.exit_code}`) : null;
    const a = f.assessment;
    const recheck = a ? `${a.predicted_verdict ? `predicted ${a.predicted_verdict}` : "no prediction"} (${a.label.replace(/_/g, " ")})` : null;
    return { status: f.status, error: f.error, pr_url: f.pr_url, dispatched_at: f.runner?.dispatched_at ?? null, tests, recheck };
  },

  async cancelFix(fixId) {
    const f = await store.getFix(fixId);
    if (f && cancellable(f).ok && f.status !== "validated") await cancelRun(f, ACTOR); // a validated patch is kept for the user's review
  },

  async notify(run: WindowRun) { await notifyRunReport(run); },

  openDraftPr: (fixId, run) => openDraftPr(run, fixId, writeDeps()),
});

/** Live wiring for lib/window-write.ts: every read is fresh; the write goes through the existing approval path. */
export const writeDeps = (): WriteDeps => ({
  now: () => Date.now(),
  fixEnabled: () => env.FIX_ENABLED && hasGitHubApp(),
  consent: consentFor,
  isSystemRepo,
  userRepo: (uid, k) => store.getUserRepo(uid, k),
  repo: (k) => store.getRepo(k),
  installation: (id) => store.getInstallation(id),
  installationPermissions,
  livePermission: liveUserPermission,
  branchHead: liveBranchHead,
  getFix: (id) => store.getFix(id),
  async context(fix) { const a = await store.getAssessment(fix.assessment_id); return a ? { a, f: await store.getFinding(a.finding_id) } : null; },
  approveDraftPr: (fix, a, f, inst, approver) => approveValidated(fix, a, f, inst, { userLogin: approver, patchVersion: fix.patch_version!, mode: "pr" }),
});

/** The morning summary: an in-app notification linking to the run page, plus Web Push and the user's chat webhook. */
export async function notifyRunReport(run: WindowRun) {
  const user = await store.getUser(run.user_id);
  if (!user || !run.report) return;
  const r = run.report;
  const line = `${r.investigated} investigated, ${r.confirmed} confirmed, ${r.validated} fix(es) ready to review, ${r.needs_review} need review`;
  const now = new Date().toISOString();
  if (user.settings.inapp !== false) {
    const id = createHash("sha256").update(`${run.user_id}:window:${run.id}`).digest("hex").slice(0, 20);
    const n: Notification = { id, user_id: run.user_id, kind: "window_report", assessment_id: `run:${run.id}`, finding_id: "", repo: run.repos[0] ?? "", title: `${run.status === "cancelled" ? "Fix run cancelled" : "Fix run finished"}: ${line}`.slice(0, 160), verdict: "Unclear", severity: { level: "unknown", cvss: null, source: "estimated" }, created_at: now, updated_at: now, read_at: null, published_at: null, notified_at: now, pushed_at: null, received_at: null };
    await store.putNotification(n, true);
    if (user.settings.push && hasPush()) await sendPushTo(run.user_id, n).catch(() => {});
  }
  if (user.settings.webhook_url) {
    const text = `SaveBell fix run ${run.status === "cancelled" ? "cancelled" : "finished"}: ${line}. Estimated cost $${r.spent_usd.toFixed(2)}. ${env.APP_URL}/runs/${encodeURIComponent(run.id)}`;
    const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(user.settings.webhook_url);
    await fetch(user.settings.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isDiscord ? { content: text } : { text }), signal: AbortSignal.timeout(8000) }).catch(() => {});
  }
}
