// "Nothing changes without your approval": the write-authorization grant (lib/write-auth.ts) and the places that must use it.
// No network: GitHub is never called. Static checks guard that every repository-write call sits behind the grant check.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cancelRun, checkApprovable, patchVersion } from "../lib/remediation-control";
import { event } from "../lib/runner-gates";
import type { Fix } from "../lib/schema";
import { store } from "../lib/store";
import { GRANT_TTL_MS, MERGE_TTL_MS, assertWrite, checkWrite, fixBranch, issueGrant, recordApproval, revoke, stillAllowed, WriteAuthError } from "../lib/write-auth";

const files = [{ path: "src/auth.ts", before_sha: "x", patch: "", after: "export const a = 1;\n", hunks: [] }];
const PV = patchVersion(files);
let n = 0;
const F = (extra: Partial<Fix> = {}): Fix => ({
  id: `wa${Date.now().toString(36)}${n++}xxxxxx`, assessment_id: "a1", user_id: "gh:1", repo: "o/r", repo_key: "o/r", base_sha: "abc1234", status: "validated", summary: "", caveats: [], files, rejected_hunks: [], syntax_check: [],
  assessment: null, verified: false, branch: null, pr_url: null, pr_number: null, pr_draft: null, check_runs: [], checks_at: null, model: "m", created_at: "2026-11-04T00:00:00Z", approved_at: null, error: null,
  mode: "pr", agent: "muse-code", allowed_files: ["src/auth.ts"], nonce_hash: null, events: [], runner: null, merge_sha: null, commit_url: null, merge_attempts: 0, patch_version: PV, grant: null, ...extra,
} as Fix);
const op = (fix: Fix, extra: Partial<Parameters<typeof checkWrite>[1]> = {}) => ({ kind: "create_branch" as const, repo: fix.repo, branch: fixBranch(fix.id), baseBranch: "main", files: fix.files.map((x) => ({ path: x.path, after: x.after })), ...extra });
const approve = (fix: Fix, action: "pr" | "branch" | "pr_then_merge" = "pr") => recordApproval(fix.id, { userId: fix.user_id, userLogin: "u", reviewedVersion: PV, action, defaultBranch: "main", check: checkApprovable, event, detail: "test" });

test("1. a write without approval is rejected at the boundary", async () => {
  const fix = F(); await store.putFix(fix, true);
  assert.throws(() => checkWrite(fix, op(fix)), /no approval/);
  await assert.rejects(assertWrite(fix.id, op(fix)), WriteAuthError);
});

test("2. approval for repository A cannot write to repository B (subfolders do not change the repository)", async () => {
  const fix = F(); await store.putFix(fix, true); const ok = await approve(fix);
  assert.throws(() => checkWrite(ok, op(ok, { repo: "o/other" })), /different repository/);
  assert.doesNotThrow(() => checkWrite(ok, op(ok, { repo: "o/r/packages/api" })));
  assert.throws(() => checkWrite({ ...ok, repo: "evil/r" }, op(ok, { repo: "evil/r" })), /different repository/);
});

test("3. approval for patch A cannot authorize patch B; a changed base commit or file needs new approval", async () => {
  const fix = F(); await store.putFix(fix, true); const ok = await approve(fix);
  assert.throws(() => checkWrite(ok, op(ok, { files: [{ path: "src/auth.ts", after: "evil" }] })), /differs from the approved patch/);
  assert.throws(() => checkWrite({ ...ok, files: [{ ...files[0], after: "evil" }] }, op(ok)), /differs from the approved patch/, "stored record tampered after approval");
  assert.throws(() => checkWrite(ok, op(ok, { files: [...op(ok).files, { path: ".github/workflows/x.yml", after: "x" }] })), /differs/);
  assert.throws(() => checkWrite({ ...ok, base_sha: "def5678" }, op(ok)), /base commit changed/);
  await assert.rejects(recordApproval(F().id, { userId: "gh:1", userLogin: "u", reviewedVersion: PV, action: "pr", defaultBranch: "main", check: checkApprovable, event, detail: "" }), /not found/);
  const other = F(); await store.putFix(other, true);
  await assert.rejects(recordApproval(other.id, { userId: "gh:1", userLogin: "u", reviewedVersion: "stale", action: "pr", defaultBranch: "main", check: checkApprovable, event, detail: "" }), /patch changed/);
});

test("4. a PR approval never authorizes a merge; a branch approval never authorizes a PR or the default branch", async () => {
  const pr = F(); await store.putFix(pr, true); const g = await approve(pr, "pr");
  assert.throws(() => checkWrite(g, { kind: "merge", repo: "o/r", branch: fixBranch(pr.id) }), /does not include merging/);
  const br = F(); await store.putFix(br, true); const b = await approve(br, "branch");
  assert.throws(() => checkWrite(b, op(b, { kind: "create_pr" })), /branch push, not a pull request/);
  assert.throws(() => checkWrite(b, op(b, { branch: "main" })), /destination branch/);
  assert.throws(() => checkWrite(g, op(g, { kind: "create_pr", baseBranch: "release" })), /target is not the approved one/);
  assert.throws(() => issueGrant(F({ id: "mainxxxxxxx" }), { userId: "gh:1", userLogin: "u", action: "branch", defaultBranch: fixBranch("mainxxxxxxx") }), /default branch/);
  const m = F(); await store.putFix(m, true); const mg = await approve(m, "pr_then_merge");
  assert.doesNotThrow(() => checkWrite(mg, { kind: "merge", repo: "o/r", branch: fixBranch(m.id) }));
});

test("5. expired or revoked approvals cannot be used", async () => {
  const fix = F(); await store.putFix(fix, true); const ok = await approve(fix, "pr_then_merge");
  const issued = Date.parse(ok.grant!.issued_at);
  assert.throws(() => checkWrite(ok, op(ok), issued + GRANT_TTL_MS + 1), /expired/);
  assert.throws(() => checkWrite(ok, { kind: "merge", repo: "o/r", branch: fixBranch(fix.id) }, issued + MERGE_TTL_MS + 1), /merge approval expired/);
  assert.throws(() => checkWrite({ ...ok, grant: revoke(ok.grant) }, op(ok)), /revoked/);
});

test("6. direct API calls cannot bypass approval: a different user, an unapproved status or a missing grant are refused", async () => {
  const fix = F(); await store.putFix(fix, true);
  assert.throws(() => issueGrant(fix, { userId: "gh:2", userLogin: "mallory", action: "pr", defaultBranch: "main" }), /only the user who started/);
  const drafted = F({ status: "drafted" }); await store.putFix(drafted, true);
  await assert.rejects(approve(drafted), /nothing to approve/, "runner approvals require a validated patch");
  const ok = await approve(fix);
  assert.throws(() => checkWrite({ ...ok, grant: { ...ok.grant!, user_id: "gh:2" } }, op(ok)), /different user/);
});

test("7. replays and retries cannot reuse or expand an approval", async () => {
  const fix = F(); await store.putFix(fix, true); await approve(fix);
  await assertWrite(fix.id, op(fix));
  await assert.rejects(assertWrite(fix.id, op(fix)), /already used/, "the same operation cannot run twice under one approval");
  await assert.rejects(assertWrite(fix.id, op(fix, { kind: "merge" })), /does not include merging/, "a retry cannot widen to a merge");
  // concurrent double approval: exactly one wins
  const dbl = F(); await store.putFix(dbl, true);
  const res = await Promise.allSettled([approve(dbl), approve(dbl)]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  // concurrent writes under one approval: exactly one claims the branch creation
  const race = F(); await store.putFix(race, true); await approve(race);
  const w = await Promise.allSettled([assertWrite(race.id, op(race)), assertWrite(race.id, op(race)), assertWrite(race.id, op(race))]);
  assert.equal(w.filter((r) => r.status === "fulfilled").length, 1);
});

test("9. cancellation before the write boundary prevents the write, even if a concurrent approval overwrote the record", async () => {
  const fix = F(); await store.putFix(fix, true);
  const approved = await approve(fix);
  await cancelRun({ ...approved, status: "validated" }, "u"); // the user's cancel lands
  await store.putFix(approved); // a racing request rewrites the record as "approved" with its (older) grant
  await assert.rejects(stillAllowed(fix.id, op(fix)), /cancelled after this approval/);
  await assert.rejects(assertWrite(fix.id, op(fix)), /cancelled/);
});

test("10. the legitimate approved draft PR workflow passes every check, once", async () => {
  const fix = F(); await store.putFix(fix, true);
  const ok = await approve(fix, "pr");
  assert.equal(ok.status, "approved"); assert.equal(ok.grant?.branch, fixBranch(fix.id)); assert.equal(ok.grant?.patch_version, PV);
  assert.match(ok.events.at(-1)!.detail, /draft pull request from savebell\/fix-.* into main, valid until/);
  await stillAllowed(fix.id, op(fix));
  await assertWrite(fix.id, op(fix));
  await assertWrite(fix.id, op(fix, { kind: "create_pr" }));
});

// ---- static guards over the source: every repository write goes through the grant ----
const SRC = join(process.cwd());
const walk = (d: string): string[] => readdirSync(d).flatMap((x) => { const p = join(d, x); return statSync(p).isDirectory() ? (/node_modules|\.next|\.git|tests|feasibility|\.data/.test(x) ? [] : walk(p)) : /\.(ts|tsx|mjs)$/.test(x) ? [p] : []; });
const WRITE = /\b(createRef|updateRef|deleteRef|createCommit|createOrUpdateFileContents|pulls\.(create|update|merge)|repos\.merge)\(/;

test("8 + boundary audit: only fix-apply.ts and runner.ts call GitHub write APIs, and each call is preceded by assertWrite in its function; MCP has no write path", () => {
  const files = [...walk(join(SRC, "lib")), ...walk(join(SRC, "app")), ...walk(join(SRC, "scripts"))];
  const writers = files.filter((p) => WRITE.test(readFileSync(p, "utf8"))).map((p) => p.replace(SRC, "").replace(/\\/g, "/"));
  assert.deepEqual(writers.sort(), ["/lib/fix-apply.ts", "/lib/runner.ts"]);
  for (const w of writers) {
    const s = readFileSync(join(SRC, w), "utf8");
    for (const m of s.matchAll(new RegExp(WRITE.source, "g"))) {
      if (/createCommit/.test(m[0])) continue; // an unreferenced commit object changes nothing; the ref that points at it is the write
      const fnStart = s.lastIndexOf("export async function", m.index);
      assert.ok(s.slice(fnStart, m.index).includes("assertWrite("), `${w}: ${m[0]} at ${m.index} is not behind assertWrite`);
    }
  }
  const mcp = readFileSync(join(SRC, "lib/mcp.ts"), "utf8");
  assert.doesNotMatch(mcp, /fix-apply|approveValidated|tryMerge|installationOctokit|scopedRepoOctokit|startRun/);
  // the runner's clone credential is read-only and limited to the one repository
  assert.match(readFileSync(join(SRC, "lib/runner.ts"), "utf8"), /scopedRepoToken\(installationId, fix\.repo\.split\("\/"\)\[1\], \{ contents: "read", metadata: "read" \}\)/);
});
