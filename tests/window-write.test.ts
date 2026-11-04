// Remediation windows, draft pull requests: consent (lib/window-consent.ts) and the write gate (lib/window-write.ts).
// No network: GitHub and the approval path are fakes. Every failed or uncertain check must HOLD the patch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Fix, Installation, UserRepo, WatchedRepo } from "../lib/schema";
import { consentFor, consentProblem, issueConsent, revokeConsents, type Consent } from "../lib/window-consent";
import type { WindowRun } from "../lib/window-run";
import { openDraftPr, type WriteDeps } from "../lib/window-write";

const NOW = Date.parse("2026-11-05T16:00:00Z");
const END = NOW + 4 * 36e5;
let n = 0;
const occ = () => `wtest${Date.now().toString(36)}${n++}:2026-11-05`;

const run = (o: string, x: Partial<WindowRun> = {}): WindowRun => ({
  id: `run-${o}`, schedule_id: "s1", user_id: "gh:42", occurrence_key: o, label: "t", tz: "Asia/Seoul", level: "draft_pr", deadline: "finish",
  start_ms: NOW - 36e5, end_ms: END, repos: ["o/r"], min_severity: "low", limits: { max_issues: 5, max_jobs: 1, budget_usd: 5 },
  status: "running", stop_reason: null, spent_usd: 0, failures_in_row: 0, items: [], events: [], created_at: "", finished_at: null, report: null, ...x,
});
const fix = (o: string, x: Partial<Fix> = {}): Fix => ({
  id: "fx1", assessment_id: "a1", user_id: "gh:42", repo: "o/r", repo_key: "o/r", base_sha: "head1", status: "validated", patch_version: "pv1", window_run_id: `run-${o}`,
  files: [], runner: { tests: { executed: true, exit_code: 0, command: "npm test" } }, pr_url: null, ...x,
} as unknown as Fix);

async function setup(x: { consent?: boolean; fix?: Partial<Fix>; ur?: Partial<UserRepo> | null; inst?: Partial<Installation> | null; perms?: Record<string, string>; live?: { permission: string; user_id: number | null } | Error; head?: string; system?: boolean; fixEnabled?: boolean } = {}) {
  const o = occ();
  if (x.consent !== false) await issueConsent({ userId: "gh:42", login: "dev42", scheduleId: "s1", occurrenceKey: o, repos: ["o/r"], endMs: END, now: NOW - 60e3 });
  const approved: string[] = [];
  const d: WriteDeps = {
    now: () => NOW,
    fixEnabled: () => x.fixEnabled ?? true,
    consent: consentFor,
    isSystemRepo: async () => !!x.system,
    userRepo: async () => (x.ur === null ? null : ({ user_id: "gh:42", repo_key: "o/r", installation_id: 7, allow_pr: true, paused: false, added_at: "", ...x.ur } as UserRepo)),
    repo: async () => ({ repo: "o/r", default_branch: "main", installation_id: 7 } as WatchedRepo),
    installation: async () => (x.inst === null ? null : ({ id: 7, suspended: false, ...x.inst } as Installation)),
    installationPermissions: async () => x.perms ?? { contents: "write", pull_requests: "write" },
    livePermission: async () => { if (x.live instanceof Error) throw x.live; return x.live ?? { permission: "write", user_id: 42 }; },
    branchHead: async () => x.head ?? "head1",
    getFix: async () => fix(o, x.fix),
    context: async () => ({ a: { id: "a1" } as never, f: null }),
    approveDraftPr: async (f, _a, _f, _i, approver) => { approved.push(approver); return { ...f, status: "pr_created", pr_url: "https://github.com/o/r/pull/9" } as Fix; },
  };
  return { o, d, approved };
}

test("all checks pass: one draft pull request through the existing approval path", async () => {
  const s = await setup();
  const out = await openDraftPr(run(s.o), "fx1", s.d);
  assert.deepEqual(out, { ok: true, pr_url: "https://github.com/o/r/pull/9" });
  assert.equal(s.approved.length, 1); assert.match(s.approved[0], /dev42 \(autonomous window/);
});

const held = async (label: string, x: Parameters<typeof setup>[0], why: RegExp, r?: (o: string) => WindowRun) => {
  const s = await setup(x);
  const out = await openDraftPr(r ? r(s.o) : run(s.o), "fx1", s.d);
  assert.equal(out.ok, false, label); if (!out.ok) assert.match(out.held, why, label);
  assert.equal(s.approved.length, 0, `${label}: nothing written`);
};

test("no consent, or consent for another window, holds the patch", async () => {
  await held("no consent", { consent: false }, /did not authorize/);
  const s = await setup();
  const out = await openDraftPr(run(s.o, { occurrence_key: "other:2026-11-06" }), "fx1", s.d);
  assert.equal(out.ok, false);
});

test("revoked consent holds the patch (GitHub authorization revoked, window cancelled or changed)", async () => {
  const s = await setup();
  assert.equal(await revokeConsents((c) => c.occurrence_key === s.o, "you revoked the GitHub App's authorization", NOW - 1), 1);
  const out = await openDraftPr(run(s.o), "fx1", s.d);
  assert.ok(!out.ok && /revoked/.test(out.held)); assert.equal(s.approved.length, 0);
});

test("expired consent holds the patch", async () => {
  const c: Consent = { id: "c", user_id: "gh:42", login: "x", schedule_id: "s", occurrence_key: "k", repos: ["o/r"], issued_at: "", expires_at: new Date(NOW).toISOString(), revoked_at: null, revoked_reason: null };
  assert.match(consentProblem(c, { userId: "gh:42", occurrenceKey: "k", repoKey: "o/r", now: NOW })!, /expired/);
  assert.match(consentProblem(c, { userId: "gh:42", occurrenceKey: "k", repoKey: "o/other", now: NOW - 1 })!, /not included/);
  assert.match(consentProblem(c, { userId: "gh:9", occurrenceKey: "k", repoKey: "o/r", now: NOW - 1 })!, /another user/);
  assert.equal(consentProblem(c, { userId: "gh:42", occurrenceKey: "k", repoKey: "o/r", now: NOW - 1 }), null);
});

test("revoked or downgraded GitHub access holds the patch, checked live with the installation token", async () => {
  await held("read only now", { live: { permission: "read", user_id: 42 } }, /now "read"/);
  await held("left the org", { live: { permission: "none", user_id: 42 } }, /now "none"/);
  await held("someone else's account", { live: { permission: "write", user_id: 7 } }, /identity/);
  await held("API error", { live: Object.assign(new Error("Bad credentials"), { status: 401 }) }, /could not be completed/);
});

test("removed repository, lost access, changes off, suspended or under-privileged installation all hold", async () => {
  await held("repo removed", { ur: null }, /no longer monitor/);
  await held("access lost", { ur: { access_lost: true } }, /lost access/);
  await held("paused", { ur: { paused: true } }, /no longer monitor/);
  await held("changes off", { ur: { allow_pr: false } }, /changes are turned off/);
  await held("installation suspended", { inst: { suspended: true } }, /suspended or removed/);
  await held("installation removed", { inst: null }, /suspended or removed/);
  await held("no PR permission", { perms: { contents: "write", pull_requests: "read" } }, /lacks/);
  await held("demo repository", { system: true }, /demo/);
  await held("fixes off", { fixEnabled: false }, /turned off on this deployment/);
});

test("the patch itself must be validated with passing tests, prepared by this window, and still based on the branch head", async () => {
  await held("no tests", { fix: { runner: { tests: { executed: false, exit_code: null } } } as never }, /tests did not run/);
  await held("tests failed", { fix: { runner: { tests: { executed: true, exit_code: 1 } } } as never }, /tests did not run and pass/);
  await held("not validated", { fix: { status: "running" } }, /not a validated patch/);
  await held("another window's patch", { fix: { window_run_id: "run-x" } }, /not prepared by this window/);
  await held("repository moved on", { head: "head2" }, /repository changed/);
});

test("outside an active window nothing is written", async () => {
  await held("paused", {}, /not active/, (o) => run(o, { status: "paused" }));
  await held("after the end", {}, /not active/, (o) => run(o, { end_ms: NOW }));
  await held("lower level", {}, /may not open/, (o) => run(o, { level: "prepare" }));
});

test("a new authorization replaces the previous one for the same window", async () => {
  const o = occ();
  const a = await issueConsent({ userId: "gh:42", login: "dev42", scheduleId: "s1", occurrenceKey: o, repos: ["o/r"], endMs: END, now: NOW });
  const b = await issueConsent({ userId: "gh:42", login: "dev42", scheduleId: "s1", occurrenceKey: o, repos: ["o/r", "o/s"], endMs: END, now: NOW });
  assert.equal((await consentFor(o))?.id, b.id); assert.notEqual(a.id, b.id);
});

test("structure: only lib/window-write.ts reaches the approval path, only as a draft pull request, after its checks", () => {
  const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\/.*$/gm, "");
  const w = strip("lib/window-write.ts");
  const call = w.indexOf("await d.approveDraftPr(");
  assert.ok(call > 0, "the write call exists");
  for (const check of ["consentProblem(", "d.livePermission(", "d.branchHead(", "d.installationPermissions(", "d.userRepo("]) assert.ok(w.indexOf(check) > 0 && w.indexOf(check) < call, `${check} runs before the write`);
  assert.doesNotMatch(w, /pr_then_merge|"push"|"branch"|merge\(/, "never a merge or branch push");
  const deps = strip("lib/window-deps.ts");
  assert.match(deps, /approveValidated\(fix, a, f, inst, \{ userLogin: approver, patchVersion: fix\.patch_version!, mode: "pr" \}\)/, "draft PR mode only");
  for (const p of ["lib/window-run.ts", "lib/window-tick.ts"]) for (const banned of ["applyFix", "approveValidated", "recordApproval", "issueGrant", "assertWrite", "tryMerge"]) assert.doesNotMatch(strip(p), new RegExp(`\\b${banned}\\b`), `${p} must not reference ${banned}`);
  const hook = readFileSync("app/api/webhooks/github/route.ts", "utf8");
  for (const e of ["github_app_authorization", "installation_repositories", "suspend"]) assert.match(hook, new RegExp(e));
  assert.ok((hook.match(/revokeConsents\(/g) ?? []).length >= 3, "revocation on authorization revoked, installation removed/suspended, repository removed");
});
