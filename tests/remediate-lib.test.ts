// Runner helpers: lockfile regeneration rules, test-output parsing, and the honest validation summary.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lockfileAllowed, validationSummary } from "../lib/runner-gates";
// @ts-expect-error plain ESM helper without types
import { dependenciesChanged, lockfilesToRegenerate, parseTestSummary } from "../scripts/remediate/lib.mjs";

test("lockfiles are regenerated only next to a changed package.json, and only when dependencies changed", () => {
  assert.deepEqual(lockfilesToRegenerate(["package.json", "src/a.ts"], ["package.json", "package-lock.json"]), [{ manifest: "package.json", lockfile: "package-lock.json", dir: "" }]);
  assert.deepEqual(lockfilesToRegenerate(["api/package.json"], ["api/package.json", "api/package-lock.json"]).map((x: { lockfile: string }) => x.lockfile), ["api/package-lock.json"]);
  assert.deepEqual(lockfilesToRegenerate(["src/a.ts"], ["package-lock.json"]), []);
  assert.equal(dependenciesChanged('{"dependencies":{"jsonwebtoken":"8.5.1"}}', '{"dependencies":{"jsonwebtoken":"9.0.0"}}'), true);
  assert.equal(dependenciesChanged('{"scripts":{"test":"a"},"dependencies":{"x":"1"}}', '{"scripts":{"test":"b"},"dependencies":{"x":"1"}}'), false);
});

test("a lockfile enters a fix only when the runner regenerated it for a changed manifest in the same folder", () => {
  assert.equal(lockfileAllowed("package-lock.json", ["package.json"], "runner"), true);
  assert.equal(lockfileAllowed("api/package-lock.json", ["api/package.json"], "runner"), true);
  assert.equal(lockfileAllowed("package-lock.json", ["package.json"], undefined), false); // e.g. edited by the agent
  assert.equal(lockfileAllowed("package-lock.json", ["src/a.ts"], "runner"), false);
  assert.equal(lockfileAllowed("api/package-lock.json", ["package.json"], "runner"), false);
  assert.equal(lockfileAllowed("yarn.lock", ["package.json"], "runner"), false);
  assert.equal(lockfileAllowed("../package-lock.json", ["../package.json"], "runner"), false);
});

test("test output is parsed into what actually ran", () => {
  const nodeOut = "✔ auth module exists and exports requireUser (1.2ms)\nℹ tests 1\nℹ suites 0\nℹ pass 1\nℹ fail 0\n";
  const s = parseTestSummary(nodeOut);
  assert.deepEqual({ ...s, names: s.names }, { framework: "node:test", total: 1, passed: 1, failed: 0, names: ["auth module exists and exports requireUser"] });
  assert.equal(parseTestSummary("Tests:       1 failed, 4 passed, 5 total").failed, 1);
  assert.equal(parseTestSummary("==== 3 passed, 1 failed in 0.12s ====").total, 4);
  assert.equal(parseTestSummary("random output"), null);
});

test("the validation summary never calls a security fix verified, and flags weak evidence", () => {
  const ok = validationSummary({ install: { command: "npm ci", executed: true, exit_code: 0, log: "" }, tests: { executed: true, exit_code: 0, command: "npm test", summary: { framework: "node:test", total: 1, passed: 1, failed: 0, names: ["smoke"] } } });
  assert.equal(ok.security_remediation, "not verified");
  assert.match(ok.label, /Tests passed \(1\/1\); security fix not verified/);
  assert.match(validationSummary({ install: { command: "npm ci", executed: true, exit_code: 1, log: "" }, tests: null }).label, /failed to install/);
  assert.match(validationSummary({ tests: { executed: false, exit_code: null, command: null } }).label, /Not tested/);
  assert.match(validationSummary({ tests: { executed: true, exit_code: 0, command: "npm test", summary: { framework: "node:test", total: 0, passed: 0, failed: 0, names: [] } } }).label, /ran no tests/);
  assert.match(validationSummary({ tests: { executed: true, exit_code: 1, command: "npm test", summary: null } }).label, /Tests failed/);
});
