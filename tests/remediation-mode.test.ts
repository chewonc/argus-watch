// Saved remediation preference → server write mode, and mode-aware blockers. Pure, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { automationBlocker } from "../lib/actions";
import { modeOf, needsWrite, writeModeFor } from "../lib/remediation-mode";
import type { Assessment } from "../lib/schema";

test("preference defaults to draft PR and ignores unknown values", () => {
  assert.equal(modeOf(undefined), "pr");
  assert.equal(modeOf({ remediation_mode: "merge" }), "pr");
  assert.equal(modeOf({ remediation_mode: "branch" }), "branch");
});

test("no repository writes: every write is refused", () => {
  for (const r of ["pr", "push", "branch", undefined]) assert.equal(writeModeFor("preview", r).ok, false);
});

test("never escalates: the requested destination must match the saved preference", () => {
  assert.deepEqual(writeModeFor("pr", "pr"), { ok: true, mode: "pr" });
  assert.deepEqual(writeModeFor("pr", "push"), { ok: true, mode: "push" }, "merge-after-CI stays a per-fix opt-in on PR mode");
  assert.equal(writeModeFor("pr", "branch").ok, false);
  assert.deepEqual(writeModeFor("branch", "branch"), { ok: true, mode: "branch" });
  assert.equal(writeModeFor("branch", "push").ok, false, "branch preference never becomes a merge");
  assert.equal(writeModeFor("branch", "pr").ok, false);
});

const A = { verdict: "Affected", locations: [{ file: "src/auth.ts", line: 3, quote: "x", why: "" }], conditions: [] } as unknown as Assessment;
const ctx = { fixEnabled: true, allowPr: false, isDemo: false, hasInstallation: true, writePermission: false };

test("blockers say whether it is deployment configuration or repository permission", () => {
  assert.match(automationBlocker(A, { ...ctx, fixEnabled: false })!, /^Deployment configuration/);
  assert.match(automationBlocker(A, ctx)!, /^Repository permission/);
  assert.match(automationBlocker(A, { ...ctx, hasInstallation: false, mode: "preview" })!, /^Repository permission: install/);
});

test("'No repository writes' is a preference, not a failure: write access is not required", () => {
  assert.equal(needsWrite("preview"), false);
  assert.equal(automationBlocker(A, { ...ctx, mode: "preview" }), null);
  assert.notEqual(automationBlocker(A, { ...ctx, mode: "branch" }), null);
});
