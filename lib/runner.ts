// Automated remediation runner. Orchestrates Meta Muse Code editing a repository inside an isolated GitHub Actions
// job (.github/workflows/remediate.yml + scripts/remediate/run.mjs). The production server never executes
// repository code; the runner never pushes. Flow:
//   user authorizes (mode pr|push) -> startRun() dispatches the workflow with {fix_id, nonce}
//   runner -> POST /api/fix/:id/runner          (nonce + ARGUS_RUNNER_SECRET) -> brief: allowed files, conditions, clone token
//   runner -> POST /api/fix/:id/runner/result   -> acceptResult(): allowlist, syntax, static assessment, tests gate;
//            the validated patch then WAITS (status "validated") for the user to review and approve that exact patch
//   user   -> approveValidated(): branch + commit + PR through the GitHub App (lib/fix-apply.ts). Push mode merges only
//            after the repository's own check-runs succeed (tryMerge, re-queued by QStash) and only if branch protection allows.
//   user   -> cancelRun(): revokes the runner's nonce (no brief, no result accepted) and cancels the Actions run.
import { createHash, randomBytes } from "node:crypto";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
import { FORBIDDEN_PATH, RunnerError, event, lockfileAllowed, mergeDecision, outsideAllowlist, validationSummary, type RunnerInstall, type RunnerLockfile, type RunnerTestSummary } from "./runner-gates";
export { FORBIDDEN_PATH, RunnerError, checkRunnerAuth, event, mergeDecision, outsideAllowlist, runnerSecretOk } from "./runner-gates";
import { env, hasQStash, hasRunner } from "./env";
import { applyFix } from "./fix-apply";
import { assessFix } from "./fixassess";
import { fixableFiles, gitBlobSha, syntaxCheck, unifiedDiff } from "./fix";
import { scopedRepoOctokit, scopedRepoToken } from "./github-app";
import { createAgentToken, revokeRunnerTokens } from "./agent-token";
import { notifyFix } from "./notify";
import { readFile, tree } from "./repo";
import type { Assessment, Finding, Fix } from "./schema";
import { store } from "./store";
import { cancellable, cancelRun, checkApprovable, patchVersion } from "./remediation-control";
import { assertWrite, recordApproval, revoke, WriteAuthError } from "./write-auth";
export { cancellable, cancelRun, checkApprovable, patchVersion };

/** Files the runner may change: the cited source files plus the manifests the preview touched. Never lockfiles, env, keys or workflows. */
export function allowedFilesFor(a: Assessment, fix: Fix): string[] {
  const set = new Set<string>([...fixableFiles(a), ...fix.files.map((f) => f.path)]);
  return [...set].filter((p) => !FORBIDDEN_PATH.test(p)).slice(0, 12);
}

/** Step 1: user authorization -> dispatch the workflow. Session, allow_pr, installation and FIX_ENABLED are checked by the route. */
export async function startRun(fix: Fix, a: Assessment, mode: "pr" | "push" | "branch" | "preview", userLogin: string): Promise<Fix> {
  if (!hasRunner()) throw new RunnerError("automated remediation is not configured on this deployment (FIX_ENABLED, RUNNER_DISPATCH_TOKEN, ARGUS_RUNNER_SECRET)", 503);
  const nonce = randomBytes(24).toString("base64url");
  const allowed = allowedFilesFor(a, fix);
  if (!allowed.length) throw new RunnerError("no editable files: only lockfiles, env or workflow files were cited", 400);
  let next: Fix = { ...fix, status: "queued", mode, allowed_files: allowed, nonce_hash: sha256(nonce), approved_at: now(), error: null, agent: "muse-code",
    runner: { run_url: null, dispatched_at: now(), started_at: null, finished_at: null, muse_version: null, steps: null, summary: "", changed_files: [], rejected_files: [], tests: null, error: null } };
  next = event(next, userLogin, "authorized", `mode=${mode}; Muse Code may edit only: ${allowed.join(", ")}`);
  const r = await fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/${env.RUNNER_WORKFLOW}/dispatches`, {
    method: "POST", headers: { authorization: `Bearer ${env.RUNNER_DISPATCH_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "ArgusWatch/0.1" },
    body: JSON.stringify({ ref: "main", inputs: { fix_id: fix.id, nonce } }),
  });
  if (r.status !== 204) {
    const msg = (await r.text()).slice(0, 200);
    next = event({ ...next, status: "failed", nonce_hash: null, error: `runner dispatch failed (${r.status}): ${msg}` }, "argus", "dispatch_failed", msg);
    await store.putFix(next);
    throw new RunnerError(`could not start the runner (GitHub ${r.status}): ${msg}`, 502);
  }
  next = event(next, "argus", "dispatched", `workflow ${env.RUNNER_WORKFLOW} in ${env.RUNNER_REPO}`, `https://github.com/${env.RUNNER_REPO}/actions/workflows/${env.RUNNER_WORKFLOW}`);
  await store.putFix(next);
  await store.log({ kind: "fix", source: "runner", detail: `dispatched Muse Code runner for ${fix.repo} (mode ${mode})`, ref: fix.assessment_id });
  return next;
}

/** Step 2: the brief the runner needs: a short-lived installation token (clone only) and a per-fix MCP agent token (read-only tools). */
export async function briefFor(fix: Fix, a: Assessment, f: Finding | null, installationId: number, runUrl: string | null): Promise<Record<string, unknown>> {
  if (fix.status !== "queued") throw new RunnerError(`fix is ${fix.status}, not queued`, 409);
  // Read-only and limited to this one repository: the runner clones, it never writes.
  const cloneToken = await scopedRepoToken(installationId, fix.repo.split("/")[1], { contents: "read", metadata: "read" });
  const mcpToken = await createAgentToken(fix.user_id, `muse-code runner ${fix.id.slice(0, 8)}`);
  const w = await store.getRepo(fix.repo_key);
  const subdir = a.repo.split("/").slice(2).join("/");
  let next: Fix = { ...fix, status: "running", runner: { ...fix.runner!, started_at: now(), run_url: runUrl ?? fix.runner?.run_url ?? null } };
  next = event(next, "runner", "started", "isolated runner fetched the brief", runUrl);
  await store.putFix(next);
  return {
    fix_id: fix.id, repo: fix.repo, base_sha: fix.base_sha, default_branch: w?.default_branch ?? "main", subdir,
    clone_token: cloneToken, allowed_files: fix.allowed_files,
    finding: { ids: f?.ids ?? [], title: f?.title ?? "", summary: f?.claim?.summary ?? "", verdict: a.verdict, tier: a.tier },
    conditions: a.conditions.map((c) => ({ id: c.id, state: c.state, text: c.text, evidence: c.evidence.map((e) => `${e.file}:${e.line ?? "?"}`) })),
    recommendations: a.recommendations.map((r) => r.text),
    preview: { by: fix.model, summary: fix.summary, caveats: fix.caveats, patches: fix.files.filter((x) => x.patch).map((x) => ({ path: x.path, patch: x.patch })) },
    mcp: { url: `${env.APP_URL}/api/mcp`, token: mcpToken, assessment_id: a.id },
    callback: `${env.APP_URL}/api/fix/${fix.id}/runner/result`,
    limits: { max_model_steps: 40, test_timeout_s: 600 },
  };
}

export type RunnerResult = {
  ok: boolean; error?: string; muse_version?: string; steps?: number; summary?: string; run_url?: string;
  files?: { path: string; after: string }[]; changed_files?: string[];
  tests?: { command: string | null; executed: boolean; exit_code: number | null; log: string; duration_ms: number | null; summary?: RunnerTestSummary };
  // lockfiles regenerated by the runner itself (never by Muse Code) after a manifest change; see lockfileAllowed()
  lockfiles?: RunnerLockfile[];
  install?: RunnerInstall;
};

/** Step 3: validate the runner's output, gate on tests, then write through the GitHub App. */
export async function acceptResult(fix: Fix, a: Assessment, f: Finding | null, installationId: number, res: RunnerResult): Promise<Fix> {
  if (fix.status !== "running" && fix.status !== "queued") throw new RunnerError(`fix is ${fix.status}`, 409);
  await revokeRunnerTokens(fix.user_id, fix.id).catch(() => {}); // the run is over: its MCP token is no longer needed
  const tests = res.tests ? { ...res.tests, log: (res.tests.log ?? "").slice(-6000), summary: res.tests.summary ?? null } : null;
  const install = res.install ? { ...res.install, log: (res.install.log ?? "").slice(-4000) } : null;
  const validation_label = validationSummary({ install, tests }).label;
  let next: Fix = { ...fix, nonce_hash: null, runner: { ...fix.runner!, finished_at: now(), muse_version: res.muse_version ?? null, steps: res.steps ?? null, summary: (res.summary ?? "").slice(0, 2000), run_url: res.run_url ?? fix.runner?.run_url ?? null, tests, install, validation_label, changed_files: (res.changed_files ?? []).slice(0, 50), rejected_files: [] } };
  const fail = async (reason: string, status: Fix["status"] = "validation_failed") => {
    next = event({ ...next, status, error: reason, runner: { ...next.runner!, error: reason } }, "argus", status, reason);
    await store.putFix(next);
    await store.log({ kind: "fix", source: "runner", detail: `${status}: ${reason}`.slice(0, 300), ref: fix.assessment_id });
    await notifyFix(fix.user_id, "fix_failed", a, f, reason.slice(0, 100)).catch(() => {});
    return next;
  };
  if (!res.ok) return fail(`runner failed: ${(res.error ?? "unknown").slice(0, 300)}`, "failed");
  const changed = res.files ?? [];
  if (!changed.length) return fail("Muse Code made no changes");
  // The allowlist is enforced here, on the result, regardless of what the runner reports about itself.
  const outside = outsideAllowlist([...new Set([...(res.changed_files ?? []), ...changed.map((c) => c.path)])], fix.allowed_files);
  if (outside.length) { next.runner!.rejected_files = outside; return fail(`changes outside the authorized files were rejected: ${outside.join(", ")}`); }
  // Lockfiles: only the runner may regenerate them (never Muse Code), and only next to a manifest that changed.
  const lockfiles = res.lockfiles ?? [];
  const badLock = lockfiles.filter((l) => !lockfileAllowed(l.path, changed.map((c) => c.path), l.regenerated_by));
  if (badLock.length) { next.runner!.rejected_files = badLock.map((l) => l.path); return fail(`lockfile changes not allowed: ${badLock.map((l) => l.path).join(", ")}`); }
  if (install?.executed && install.exit_code !== 0) return fail(`dependencies failed to install in the runner (${install.command ?? "install"}, exit ${install.exit_code}); not validated, nothing was written`);
  const before = new Map<string, string>();
  const files: Fix["files"] = [];
  const lockPaths = new Set(lockfiles.map((l) => l.path));
  for (const c of [...changed.slice(0, 12), ...lockfiles.map((l) => ({ path: l.path, after: l.after }))]) {
    if (typeof c.after !== "string" || c.after.length > (lockPaths.has(c.path) ? 5_000_000 : 500_000)) return fail(`${c.path}: invalid or oversized content`);
    const was = (await readFile(fix.repo, fix.base_sha, c.path)) ?? (lockPaths.has(c.path) ? "" : null); // a regenerated lockfile may be new
    if (was == null) return fail(`${c.path} does not exist at the assessed commit`);
    if (was === c.after) continue;
    before.set(c.path, was);
    files.push({ path: c.path, before_sha: gitBlobSha(was), patch: unifiedDiff(c.path, was, c.after, fix.base_sha), after: c.after, hunks: [] });
  }
  if (!files.length) return fail("Muse Code's result is identical to the assessed files");
  const syntax = files.map((x) => syntaxCheck(x.path, x.after));
  next = { ...next, files, syntax_check: syntax, rejected_hunks: [], summary: res.summary?.trim() ? res.summary.slice(0, 1000) : fix.summary, model: `muse-code${res.muse_version ? " " + res.muse_version : ""}` };
  if (syntax.some((s) => !s.ok)) return fail(`syntax check failed: ${syntax.filter((s) => !s.ok).map((s) => s.path).join(", ")}`);
  next.assessment = await assessFix(a, f, next, before).catch(() => null);
  if (tests?.executed && tests.exit_code !== 0) return fail(`repository tests failed in the runner (${tests.command}, exit ${tests.exit_code}); nothing was pushed`);
  // Nothing is written yet: Muse Code's patch can differ from the preview the user saw, so the user now reviews and
  // approves THIS patch (patch_version) before any repository write (approveValidated).
  next = event({ ...next, status: "validated", patch_version: patchVersion(files) }, "argus", "validated", tests?.executed ? `tests executed in the isolated runner: ${tests.command} (exit 0); syntax checked; static assessment ${next.assessment?.label ?? "n/a"}; awaiting your approval` : `no test command detected, no tests executed; syntax checked; static assessment ${next.assessment?.label ?? "n/a"}; awaiting your approval`);
  await store.putFix(next);
  await store.log({ kind: "fix", source: "runner", detail: `validated patch ${next.patch_version} for ${fix.repo}; awaiting the user's approval`, ref: fix.assessment_id });
  return next;
}

/** The user's approval of the exact validated patch: only now does Argus write (branch, commit, PR). */
export async function approveValidated(fix: Fix, a: Assessment, f: Finding | null, installationId: number, opts: { userLogin: string; patchVersion: string; mode: "pr" | "push" | "branch" }): Promise<Fix> {
  // Atomic approval with a grant bound to this exact patch and destination (lib/write-auth.ts); the write boundary checks it.
  const w = await store.getRepo(fix.repo_key);
  let next: Fix = await recordApproval(fix.id, { userId: fix.user_id, userLogin: opts.userLogin, reviewedVersion: opts.patchVersion, action: opts.mode === "push" ? "pr_then_merge" : opts.mode, defaultBranch: w?.default_branch ?? "main",
    check: checkApprovable, event, detail: `approved patch ${opts.patchVersion} (${opts.mode === "push" ? "PR, merge after CI passes" : opts.mode === "branch" ? "push to a new branch, no pull request" : "draft pull request"})` });
  next = { ...next, mode: opts.mode };
  await store.putFix(next);
  const tests = fix.runner?.tests ?? null;
  try {
    const testsNote = tests?.executed ? `Repository tests executed in an isolated GitHub Actions runner: \`${tests.command}\` exited 0.` : "No test command was detected, so no tests were executed. Checks performed: syntax parse and static remediation assessment only.";
    const applied = await applyFix(next, a, f, installationId, { draft: opts.mode !== "push", openPr: opts.mode !== "branch", author: "Meta Muse Code (automated remediation)", testsNote }); // PR mode: a draft; push mode needs a mergeable PR
    const keep = { events: next.events, runner: next.runner, mode: next.mode, agent: next.agent, allowed_files: next.allowed_files, patch_version: next.patch_version };
    if (applied.status === "branch_pushed") {
      next = event({ ...next, ...applied, ...keep }, "argus", "branch_pushed", `pushed ${applied.branch} (no pull request)`, applied.commit_url);
      await store.putFix(next);
      return next;
    }
    next = event({ ...next, ...applied, ...keep }, "argus", "pr_opened", `pull request #${applied.pr_number} on ${applied.branch}`, applied.pr_url);
    await store.putFix(next);
    await notifyFix(fix.user_id, "fix_pr_created", a, f, `${fix.repo}#${applied.pr_number}`).catch(() => {});
    if (next.mode === "push") next = await scheduleMerge(next, 0);
    return next;
  } catch (e) {
    const refused = e instanceof WriteAuthError;
    const reason = refused ? `write refused: ${e.message}` : `GitHub write failed: ${String((e as { message?: string }).message ?? e).slice(0, 300)}`;
    // The grant is spent either way; a retry needs a new approval. A cancellation that landed meanwhile is kept.
    const fresh = (await store.getFix(fix.id)) ?? next;
    next = fresh.status === "cancelled" ? fresh : event({ ...fresh, status: "validated", error: reason, grant: revoke(fresh.grant) }, "argus", refused ? "write_refused" : "write_failed", reason);
    await store.putFix(next);
    throw new RunnerError(reason, refused ? e.status : 502);
  }
}

async function scheduleMerge(fix: Fix, attempt: number): Promise<Fix> {
  let next: Fix = { ...fix, status: "merging", merge_attempts: attempt };
  if (attempt === 0) next = event(next, "argus", "merge_scheduled", "waiting for the repository's check-runs before merging");
  await store.putFix(next);
  if (hasQStash()) {
    const { Client } = await import("@upstash/qstash");
    const client = new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}) });
    await client.publishJSON({ url: `${env.APP_URL}/api/fix/${fix.id}/merge`, body: { attempt: attempt + 1 }, delay: attempt === 0 ? "90s" : "120s", retries: 1 }).catch(() => {});
    await store.countMessage();
  }
  return next;
}

/** Push mode: merge the PR once check-runs succeed. Never merges with failing, pending or absent validation; never bypasses protection. */
export async function tryMerge(fix: Fix, installationId: number, attempt: number): Promise<Fix> {
  if (fix.status !== "merging" || !fix.pr_number || !fix.branch) return fix;
  const [owner, repo] = fix.repo.split("/");
  const ok = await scopedRepoOctokit(installationId, repo, { contents: "write", pull_requests: "write", checks: "read", metadata: "read" });
  const { data } = await ok.rest.checks.listForRef({ owner, repo, ref: fix.branch, per_page: 50, filter: "latest" });
  const runs = data.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion ?? null, url: r.html_url ?? null }));
  let next: Fix = { ...fix, check_runs: runs, checks_at: now() };
  const testsPassed = !!fix.runner?.tests?.executed && fix.runner.tests.exit_code === 0;
  const d = mergeDecision(runs, testsPassed, attempt);
  const leave = async (action: string, reason: string) => { next = event({ ...next, status: "blocked_by_protection", error: `${reason}; pull request left open for review` }, "argus", action, reason); await store.putFix(next); return next; };
  if (d === "refuse_failed") return leave("merge_refused", "repository check-runs failed");
  if (d === "timeout") return leave("merge_timeout", "check-runs did not complete within 30 minutes");
  if (d === "refuse_unvalidated") return leave("merge_refused", "the repository has no passing CI check for this change: refusing to merge unvalidated changes");
  if (d === "wait") return scheduleMerge(next, attempt);
  try {
    // A PR approval never authorizes a merge: only a grant that explicitly includes merging, still inside its window.
    await assertWrite(fix.id, { kind: "merge", repo: fix.repo, branch: fix.branch });
    const m = await ok.rest.pulls.merge({ owner, repo, pull_number: fix.pr_number, merge_method: "squash", commit_title: `Argus Watch automated fix ${fix.id.slice(0, 8)} (Meta Muse Code)` });
    const url = `https://github.com/${fix.repo}/commit/${m.data.sha}`;
    next = event({ ...next, status: "merged", merge_sha: m.data.sha, commit_url: url }, "argus", "merged", `squash-merged into the default branch after ${runs.filter((r) => r.conclusion === "success").length} passing check-run(s)${testsPassed ? " and passing runner tests" : ""}`, url);
    await store.putFix(next);
    await store.log({ kind: "fix", source: "runner", detail: `merged ${fix.repo} ${m.data.sha.slice(0, 7)}`, ref: fix.assessment_id });
    return next;
  } catch (e) {
    if (e instanceof WriteAuthError) return leave("merge_refused", `not authorized to merge: ${e.message}`);
    const status = (e as { status?: number }).status;
    return leave("merge_refused", `GitHub refused the merge (${status ?? "?"}: ${String((e as { message?: string }).message ?? e).slice(0, 160)}), e.g. branch protection requires reviews`);
  }
}

/** Test command shown in the authorization dialog (the runner re-detects on the checked-out tree). */
export async function detectTestCommand(repo: string, sha: string, subdir: string): Promise<string | null> {
  const prefix = subdir ? subdir + "/" : "";
  const pkg = await readFile(repo, sha, `${prefix}package.json`).catch(() => null);
  if (pkg) { try { const j = JSON.parse(pkg) as { scripts?: Record<string, string> }; if (j.scripts?.test && !/no test specified/.test(j.scripts.test)) return "npm test"; } catch { /* not JSON */ } }
  const entries = await tree(repo, sha).catch(() => []);
  const names = entries.map((e) => e.path).filter((p) => p.startsWith(prefix));
  if (names.some((p) => /(^|\/)(pytest\.ini|conftest\.py)$/.test(p) || /(^|\/)tests?\/test_.*\.py$/.test(p))) return "pytest -q";
  if (names.includes(`${prefix}go.mod`)) return "go test ./...";
  if (names.includes(`${prefix}Cargo.toml`)) return "cargo test";
  return null;
}
