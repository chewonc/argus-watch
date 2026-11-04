// Remediation windows, "Create draft pull requests" level: the ONLY place a window may write to a repository.
//
// Before every write, each check is made fresh (nothing cached) and every failure or error HOLDS the validated patch
// for the user's review instead of opening a pull request:
//   1. the run is active, at the draft_pr level, and inside its window
//   2. the user's consent (lib/window-consent.ts) covers this occurrence and repository and is not revoked or expired
//   3. the deployment allows fixes and the repository is not a shared demo repository
//   4. the user still monitors the repository, it allows changes, and access has not been lost
//   5. the installation exists, is not suspended, and grants Contents + Pull requests write
//   6. GitHub says, right now, that the user (matched by numeric id) has write or admin permission on the repository
//   7. the patch is validated, its repository tests ran in the isolated runner and passed, and its base commit is still the branch head
// Only then is the ordinary single-use, 10-minute grant issued for that exact patch and a DRAFT pull request opened from
// a new branch (lib/runner.ts approveValidated -> lib/write-auth.ts -> lib/fix-apply.ts). Never a merge, never a push to
// an existing branch, never the default branch.
import { consentProblem, type Consent } from "./window-consent";
import type { Assessment, Finding, Fix, Installation, UserRepo, WatchedRepo } from "./schema";
import type { WindowRun } from "./window-run";

export type WriteDeps = {
  now(): number;
  fixEnabled(): boolean;
  consent(occurrenceKey: string): Promise<Consent | null>;
  isSystemRepo(repoKey: string): Promise<boolean>;
  userRepo(uid: string, repoKey: string): Promise<UserRepo | null>;
  repo(repoKey: string): Promise<WatchedRepo | null>;
  installation(id: number): Promise<Installation | null>;
  installationPermissions(id: number): Promise<Record<string, string>>;
  livePermission(installationId: number, full: string, login: string): Promise<{ permission: string; user_id: number | null }>;
  branchHead(installationId: number, full: string, branch: string): Promise<string>;
  getFix(id: string): Promise<Fix | null>;
  context(fix: Fix): Promise<{ a: Assessment; f: Finding | null } | null>;
  /** lib/runner.ts approveValidated with mode "pr": single-use grant for this exact patch, then a draft pull request. */
  approveDraftPr(fix: Fix, a: Assessment, f: Finding | null, installationId: number, approver: string): Promise<Fix>;
};

export type WriteOutcome = { ok: true; pr_url: string | null } | { ok: false; held: string };

const hold = (why: string): WriteOutcome => ({ ok: false, held: why });

/** Run every check; open a draft pull request only if all pass. Never throws: an unexpected error holds the patch. */
export async function openDraftPr(run: WindowRun, fixId: string, d: WriteDeps): Promise<WriteOutcome> {
  try {
    const now = d.now();
    if (run.level !== "draft_pr") return hold("this window may not open pull requests");
    if (run.status !== "running" || now >= run.end_ms) return hold("the window is not active, so no pull request is opened");
    const fix = await d.getFix(fixId);
    if (!fix || fix.user_id !== run.user_id) return hold("the fix record is missing");
    const repoKey = fix.repo_key;
    const cp = consentProblem(await d.consent(run.occurrence_key), { userId: run.user_id, occurrenceKey: run.occurrence_key, repoKey, now });
    if (cp) return hold(cp);
    if (!d.fixEnabled()) return hold("automated fixes are turned off on this deployment");
    if (await d.isSystemRepo(repoKey)) return hold("shared demo repositories never receive changes");
    const ur = await d.userRepo(run.user_id, repoKey);
    if (!ur || ur.paused || ur.access_lost) return hold("you no longer monitor this repository or lost access to it");
    if (!ur.allow_pr) return hold("changes are turned off for this repository");
    const w = await d.repo(repoKey);
    const inst = w?.installation_id ?? ur.installation_id;
    if (!inst) return hold("the repository is not connected through the GitHub App");
    const i = await d.installation(inst);
    if (!i || i.suspended) return hold("the GitHub App installation is suspended or removed");
    const p = await d.installationPermissions(inst);
    if (p.contents !== "write" || p.pull_requests !== "write") return hold("the GitHub App installation lacks Contents and Pull requests write access");
    const login = (await d.consent(run.occurrence_key))!.login;
    const live = await d.livePermission(inst, fix.repo, login);
    const ghId = Number(run.user_id.replace(/^gh:/, ""));
    if (!live.user_id || live.user_id !== ghId) return hold("GitHub could not confirm your identity on this repository");
    if (live.permission !== "admin" && live.permission !== "write") return hold(`GitHub reports your permission on this repository is now "${live.permission}", not write`);
    if (fix.status !== "validated" || !fix.patch_version) return hold(`the fix is ${fix.status}, not a validated patch`);
    const t = fix.runner?.tests;
    if (!t?.executed || t.exit_code !== 0) return hold("the repository's tests did not run and pass in the isolated runner, so the patch waits for your review");
    if (fix.window_run_id !== run.id) return hold("this patch was not prepared by this window");
    const head = await d.branchHead(inst, fix.repo, w?.default_branch ?? "main");
    if (head !== fix.base_sha) return hold("the repository changed since the patch was prepared; it needs a fresh review");
    const ctx = await d.context(fix);
    if (!ctx) return hold("the finding's assessment is missing");
    const done = await d.approveDraftPr(fix, ctx.a, ctx.f, inst, `${login} (autonomous window ${run.id.slice(0, 24)})`);
    return { ok: true, pr_url: done.pr_url ?? null };
  } catch (e) {
    return hold(`a check could not be completed (${String((e as Error).message ?? e).slice(0, 140)}), so no pull request was opened`);
  }
}
