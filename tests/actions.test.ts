// Context-aware finding actions (lib/actions.ts): availability comes from verdict, fix records and permissions, never severity.
import assert from "node:assert/strict";
import { test } from "node:test";
import { automationBlocker, findingAction } from "../lib/actions";
import type { Assessment, Fix } from "../lib/schema";

const A = (verdict: Assessment["verdict"], file = "src/auth.ts", extra: Partial<Assessment> = {}) => ({
  id: "a1", finding_id: "f", repo: "o/r", sha: "abc", tier: "official", dependency: null, verdict, verdict_reason: "", verdict_qualifier: "", missing_evidence: [], unverified: [], recommendations: [],
  locations: file ? [{ file, line: 10, quote: "x", why: "y" }] : [], conditions: [], timestamps: { published_at: null, discovered_at: "t", processed_at: "t", notified_at: null }, model: "m", replayed: false,
  severity: { level: "critical", cvss: 9.8, source: "ghsa" }, ...extra,
} as unknown as Assessment);
const ok = { fixEnabled: true, allowPr: true, isDemo: false, hasInstallation: true, writePermission: true };
const F = (status: Fix["status"], extra: Partial<Fix> = {}) => ({ id: "x", status, created_at: "2026-11-04T00:00:00Z", pr_url: null, commit_url: null, error: null, files: [], events: [], ...extra } as unknown as Fix);
const href = "/case/a1";

test("confirmed finding with every permission: Fix now opens the preview and approval flow", () => {
  const r = findingAction(A("Affected"), [], ok, href);
  assert.equal(r.primary?.kind, "fix_now"); assert.equal(r.primary?.href, "/case/a1?act=1#fix");
});

test("possible issue: Verify (read-only), never Fix now, even at critical severity with full permissions", () => {
  const r = findingAction(A("Unclear"), [], ok, href);
  assert.equal(r.primary?.kind, "verify"); assert.equal(r.primary?.href, "/case/a1?verify=1#agent");
});

test("not affected: no action", () => assert.equal(findingAction(A("Not Affected"), [], ok, href).primary, null));

test("confirmed but automation cannot act: Review fix with the real reason", () => {
  for (const [ctx, reason] of [
    [{ ...ok, fixEnabled: false }, /turned off/],
    [{ ...ok, isDemo: true }, /demo/],
    [{ ...ok, hasInstallation: false }, /Install the Argus Watch GitHub App/],
    [{ ...ok, writePermission: false }, /write access/],
    [{ ...ok, writePermission: null }, /could not be confirmed/],
    [{ ...ok, allowPr: false }, /enable them on Repositories/],
  ] as const) {
    const r = findingAction(A("Affected"), [], ctx, href);
    assert.equal(r.primary?.kind, "review_fix"); assert.match(r.note ?? "", reason);
  }
  assert.match(automationBlocker(A("Affected", ".github/workflows/ci.yml"), ok) ?? "", /can.t be changed automatically/);
  assert.match(automationBlocker(A("Affected", ""), ok) ?? "", /No exact line/);
});

test("existing remediation: progress, PR (not resolved), blocked merge, merged, failed + retry", () => {
  assert.equal(findingAction(A("Affected"), [F("running")], ok, href).primary?.kind, "view_progress");
  assert.equal(findingAction(A("Affected"), [F("merging")], ok, href).state?.key, "checks");
  const pr = findingAction(A("Affected"), [F("pr_created", { pr_url: "https://github.com/o/r/pull/7" })], ok, href);
  assert.equal(pr.primary?.kind, "view_pr"); assert.equal(pr.primary?.external, true); assert.equal(pr.state?.key, "pr"); assert.match(pr.note ?? "", /stays open/);
  assert.equal(findingAction(A("Affected"), [F("blocked_by_protection", { pr_url: "https://github.com/o/r/pull/7", error: "no passing CI" })], ok, href).state?.key, "blocked");
  const merged = findingAction(A("Affected"), [F("merged", { commit_url: "https://github.com/o/r/commit/abc" })], ok, href);
  assert.equal(merged.primary?.kind, "view_fix"); assert.equal(merged.primary?.href, "https://github.com/o/r/commit/abc");
  const failed = findingAction(A("Affected"), [F("validation_failed", { error: "tests failed" })], ok, href);
  assert.equal(failed.primary?.kind, "retry"); assert.equal(failed.state?.key, "failed"); assert.equal(failed.note, "tests failed");
  assert.equal(findingAction(A("Affected"), [F("failed")], { ...ok, allowPr: false }, href).primary?.kind, "review_fix", "no retry when automation is blocked");
});

test("the newest fix record decides, and a drafted fix awaits approval", () => {
  const older = F("failed", { created_at: "2026-11-01T00:00:00Z" }), newer = F("pr_created", { created_at: "2026-11-03T00:00:00Z", pr_url: "https://github.com/o/r/pull/8" });
  assert.equal(findingAction(A("Affected"), [older, newer], ok, href).primary?.kind, "view_pr");
  const drafted = findingAction(A("Affected"), [F("drafted")], ok, href);
  assert.equal(drafted.primary?.kind, "fix_now"); assert.equal(drafted.state?.key, "awaiting");
});

test("agent reported not affected: no Verify button, and the status keeps its specific label", async () => {
  const { statusOf, localized } = await import("../lib/labels");
  const a = A("Unclear", "src/auth.ts", { agent: { status: "not_affected", summary: "", evidence: [], pr_url: null, client: null, at: "t" } } as Partial<Assessment>);
  const r = findingAction(a, [], ok, href);
  assert.equal(r.primary, null); assert.match(r.note ?? "", /does not affect/);
  const st = localized(statusOf(a, { level: "low", cvss: null, source: "estimated" }, { resolved: false, prOpen: false }), { st_resolved: "Resolved", st_agent_not_affected: "Not affected (checked by your AI agent)" });
  assert.equal(st.label, "Not affected (checked by your AI agent)");
  assert.equal(localized(statusOf(A("Unclear"), { level: "low", cvss: null, source: "estimated" }, { resolved: false, prOpen: false }), { st_possible: "가능한 문제" }).label, "가능한 문제");
});

test("a run that never reported back: in progress for 20 minutes, then 'stalled' with Retry (never in progress forever)", async () => {
  const { isStaleRun } = await import("../lib/run-stale");
  const t0 = Date.parse("2026-11-04T06:21:45Z");
  const q = F("queued", { runner: { dispatched_at: "2026-11-04T06:21:45Z", run_url: "https://github.com/chewonc/argus-watch/actions/runs/1" } } as Partial<Fix>);
  assert.equal(findingAction(A("Affected"), [q], ok, href, t0 + 5 * 60e3).primary?.kind, "view_progress");
  assert.equal(isStaleRun(q, t0 + 19 * 60e3), false);
  const r = findingAction(A("Affected"), [q], ok, href, t0 + 21 * 60e3);
  assert.equal(r.state?.key, "stalled"); assert.equal(r.primary?.kind, "retry"); assert.match(r.note ?? "", /never reported back.*actions\/runs\/1.*nothing was written/);
  assert.equal(isStaleRun(F("running", { runner: { dispatched_at: "2026-11-04T06:21:45Z" } } as Partial<Fix>), t0 + 60 * 60e3), false, "a run that started is governed by the job's own timeout and failure report");
});
