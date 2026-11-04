// Approve-the-exact-patch and backend cancellation (lib/runner.ts). No network: GitHub calls are never reached.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cancellable, cancelRun, checkApprovable, patchVersion } from "../lib/remediation-control";
import { checkRunnerAuth } from "../lib/runner-gates";
import type { Fix } from "../lib/schema";
import { store } from "../lib/store";

const files = [{ path: "src/auth.ts", before_sha: "x", patch: "", after: "export const a = 1;\n", hunks: [] }];
const F = (status: Fix["status"], extra: Partial<Fix> = {}) => ({
  id: "fx" + Math.random().toString(36).slice(2, 8), assessment_id: "a1", user_id: "gh:1", repo: "o/r", repo_key: "o/r", base_sha: "abc", status, summary: "", caveats: [], files, rejected_hunks: [], syntax_check: [],
  assessment: null, verified: false, branch: null, pr_url: null, pr_number: null, pr_draft: null, check_runs: [], checks_at: null, model: "m", created_at: "2026-11-04T00:00:00Z", approved_at: null, error: null,
  mode: "pr", agent: "muse-code", allowed_files: ["src/auth.ts"], nonce_hash: "deadbeef", events: [], runner: { run_url: null, dispatched_at: "2026-11-04T00:00:00Z", started_at: null, finished_at: null, muse_version: null, steps: null, summary: "", changed_files: [], rejected_files: [], tests: null, error: null },
  merge_sha: null, commit_url: null, merge_attempts: 0, patch_version: null, ...extra,
} as Fix);

test("patch version changes when any path or content changes", () => {
  const v = patchVersion(files);
  assert.equal(v, patchVersion([...files]));
  assert.notEqual(v, patchVersion([{ ...files[0], after: "export const a = 2;\n" }]));
  assert.notEqual(v, patchVersion([...files, { ...files[0], path: "package-lock.json" }]), "a regenerated lockfile is part of what the user approves");
});

test("approval only for a validated patch, and only for the exact version the user reviewed", () => {
  assert.throws(() => checkApprovable(F("drafted"), "x"), /nothing to approve/);
  assert.throws(() => checkApprovable(F("approved", { patch_version: patchVersion(files) }), patchVersion(files)), /nothing to approve/, "a second click while the PR is being created is refused");
  const v = F("validated", { patch_version: patchVersion(files) });
  assert.doesNotThrow(() => checkApprovable(v, patchVersion(files)));
  assert.throws(() => checkApprovable(v, "stale-version"), /patch changed since you reviewed it/);
  const tampered = F("validated", { patch_version: patchVersion(files), files: [{ ...files[0], after: "evil" }] });
  assert.throws(() => checkApprovable(tampered, patchVersion(files)), /patch changed/, "stored files must still match the approved version");
});

test("cancellable states and the explanation when it is too late", () => {
  for (const s of ["queued", "running", "validated", "merging"] as const) assert.equal(cancellable({ status: s }).ok, true, s);
  const late = cancellable({ status: "approved" });
  assert.equal(late.ok, false); assert.match(late.why, /being created right now/);
  assert.equal(cancellable({ status: "pr_created" }).ok, false);
});

test("cancel revokes the runner credential in the backend: the runner can no longer fetch the brief or report a result", async () => {
  const q = F("queued");
  await store.putFix(q, true);
  const c = await cancelRun(q, "tester");
  assert.equal(c.status, "cancelled"); assert.equal(c.nonce_hash, null);
  assert.match(c.events.at(-1)!.detail, /credential is revoked/);
  const req = new Request("http://x", { headers: { "x-argus-runner-secret": "s" } });
  const { env } = await import("../lib/env"); env.ARGUS_RUNNER_SECRET = "s";
  assert.throws(() => checkRunnerAuth(c, req, "any-nonce"), /nonce invalid or already used/);
});

test("cancelling an automatic merge leaves the pull request open", async () => {
  const m = F("merging", { pr_url: "https://github.com/o/r/pull/1", pr_number: 1 });
  await store.putFix(m, true);
  const c = await cancelRun(m, "tester");
  assert.equal(c.status, "pr_created"); assert.match(c.events.at(-1)!.action, /merge_cancelled/);
});
