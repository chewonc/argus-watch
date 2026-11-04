// Saved remediation preference → server write mode, and mode-aware blockers. Pure, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { automationBlocker } from "../lib/actions";
import { destinationOf, modeOf, needsWrite, writeModeFor } from "../lib/remediation-mode";
import type { Assessment } from "../lib/schema";

test("preference defaults to draft PR and ignores unknown values", () => {
  assert.equal(modeOf(undefined), "pr");
  assert.equal(modeOf({ remediation_mode: "merge" }), "pr");
  assert.equal(modeOf({ remediation_mode: "branch" }), "branch");
});

test("per-attempt destination: the saved preference is only the default; unknown values fall back to it", () => {
  assert.equal(destinationOf("branch", "pr"), "branch");
  assert.equal(destinationOf("preview", "pr"), "preview");
  assert.equal(destinationOf("merge", "pr"), "pr");
  assert.equal(destinationOf(undefined, "branch"), "branch");
});

test("approval writes only for an explicit PR or branch destination; never for 'no repository changes'; never a merge", () => {
  assert.deepEqual(writeModeFor("pr"), { ok: true, mode: "pr" });
  assert.deepEqual(writeModeFor("branch"), { ok: true, mode: "branch" });
  for (const r of ["preview", undefined, "", "main"]) assert.equal(writeModeFor(r).ok, false);
  const m = writeModeFor("push");
  assert.equal(m.ok, false, "a PR approval is never combined with automatic merging");
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
