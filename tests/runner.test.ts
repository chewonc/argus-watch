// Safety gates of the Muse Code remediation runner (lib/runner.ts). Pure functions only: no network, no model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FORBIDDEN_PATH, checkRunnerAuth, event, mergeDecision, outsideAllowlist } from "../lib/runner-gates";
import type { Fix } from "../lib/schema";

test("allowlist: only authorized paths pass; forbidden paths never pass even if listed", () => {
  const allowed = ["src/auth.ts", "package.json", ".github/workflows/ci.yml"];
  assert.deepEqual(outsideAllowlist(["src/auth.ts"], allowed), []);
  assert.deepEqual(outsideAllowlist(["src/auth.ts", "src/other.ts"], allowed), ["src/other.ts"]);
  assert.deepEqual(outsideAllowlist([".github/workflows/ci.yml"], allowed), [".github/workflows/ci.yml"]);
  assert.deepEqual(outsideAllowlist(["../etc/passwd"], [...allowed, "../etc/passwd"]), ["../etc/passwd"]);
  for (const p of [".env", "app/.env.local", "key.pem", "package-lock.json", "yarn.lock", ".mcp.json", ".muse/hooks.json"]) assert.ok(FORBIDDEN_PATH.test(p), p);
  for (const p of ["src/auth.ts", "package.json", "requirements.txt"]) assert.ok(!FORBIDDEN_PATH.test(p), p);
});

test("push-mode merge decision never merges unvalidated or failing changes", () => {
  const ok = { status: "completed", conclusion: "success" };
  assert.equal(mergeDecision([ok], false, 1), "merge");
  assert.equal(mergeDecision([ok, { status: "completed", conclusion: "failure" }], true, 1), "refuse_failed");
  assert.equal(mergeDecision([{ status: "in_progress", conclusion: null }], true, 1), "wait");
  assert.equal(mergeDecision([{ status: "queued", conclusion: null }], true, 15), "timeout");
  assert.equal(mergeDecision([], true, 0), "merge"); // runner executed tests and they passed; repo has no CI
  assert.equal(mergeDecision([], false, 0), "wait"); // CI may not have registered yet
  assert.equal(mergeDecision([], false, 3), "refuse_unvalidated");
});

test("runner callbacks require the shared secret and the single-use nonce", () => {
  process.env.ARGUS_RUNNER_SECRET = "s3cret-value";
  const nonceHash = "4c5f4b2f6c1d8a1f7ad8b3a0f1d0e0c3f0a1c1e2d3b4a5968778695a4b3c2d1e"; // not the hash of "x"
  const fix = { nonce_hash: nonceHash } as unknown as Fix;
  const req = (secret: string) => new Request("https://x", { headers: { "x-argus-runner-secret": secret } });
  assert.throws(() => checkRunnerAuth(fix, req("wrong"), "x"), /secret/);
  // env is read at import time; with no secret configured every call must fail closed
  assert.throws(() => checkRunnerAuth(fix, req("s3cret-value"), "x"));
  assert.throws(() => checkRunnerAuth({ nonce_hash: null } as unknown as Fix, req("s3cret-value"), "x"));
});

test("audit events append with timestamps and never drop earlier events", () => {
  const f = { events: [{ at: "2026-11-04T00:00:00Z", actor: "u", action: "authorized", detail: "d", url: null }] } as unknown as Fix;
  const g = event(f, "argus", "validated", "tests ok");
  assert.equal(g.events.length, 2);
  assert.equal(g.events[0].action, "authorized");
  assert.match(g.events[1].at, /^\d{4}-\d{2}-\d{2}T/);
});
