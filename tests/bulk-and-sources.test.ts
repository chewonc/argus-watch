// Bulk fixing rules, "What we monitor" status, "Report a threat" validation, Threats filter and nav changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { approveLabel, classify, groupFixes, type PreparedFix } from "../lib/bulk";
import { statusFrom } from "../lib/monitor-sources";
import type { Assessment, Fix } from "../lib/schema";
import { reportKey, validateReport } from "../lib/threat-report";

const A = (verdict: string, extra: Partial<Assessment> = {}) => ({ id: "a1", verdict, locations: [{ file: "src/auth.ts", line: 3, quote: "x", why: "" }], conditions: [], ...extra } as unknown as Assessment);
const ok = { fixEnabled: true, allowPr: true, isDemo: false, hasInstallation: true, writePermission: true, mode: "pr" as const };
const fx = (status: string) => ({ id: "f", status, created_at: "2026-11-04T00:00:00Z", events: [], runner: null } as unknown as Fix);

test("classification is from real state: ready to attempt, needs verification, or ineligible with a plain reason", () => {
  assert.equal(classify(A("Affected"), [], ok, false).cls, "ready");
  assert.equal(classify(A("Unclear"), [], ok, false).cls, "needs_verification");
  assert.deepEqual(classify(A("Not Affected"), [], ok, false), { cls: "ineligible", reason: "Your code isn't affected." });
  assert.equal(classify(A("Affected"), [], ok, true).reason, "Already resolved.");
  assert.equal(classify(A("Affected"), [fx("running")], ok, false).reason, "A fix is already in progress.");
  assert.equal(classify(A("Affected"), [fx("pr_created")], ok, false).reason, "A fix was already created.");
  const blocked = classify(A("Affected"), [], { ...ok, isDemo: true }, false);
  assert.equal(blocked.cls, "ineligible"); assert.match(blocked.reason!, /demo/);
  assert.doesNotMatch(classify(A("Affected"), [], { ...ok, fixEnabled: false }, false).reason!, /^Deployment configuration/, "plain wording");
  assert.equal(classify(A("Unclear"), [], { ...ok, hasInstallation: false }, false).cls, "ineligible", "verification is pointless when a fix could never run");
});

const P = (id: string, aid: string, repo: string, base: string, files: string[]): PreparedFix => ({ id, assessment_id: aid, repo, base_sha: base, files: files.map((path) => ({ path, before_sha: "", patch: "", after: path, hunks: [] })), patch_version: id, status: "validated" });

test("compatible fixes combine per repository; overlaps, other commits and duplicates stay separate; never across repositories", () => {
  const g = groupFixes([P("1", "a", "o/r", "s1", ["a.ts"]), P("2", "b", "o/r", "s1", ["b.ts"]), P("3", "c", "o/r", "s1", ["a.ts"]), P("4", "d", "o/r", "s2", ["d.ts"]), P("5", "a", "o/r", "s1", ["z.ts"]), P("6", "e", "o/x", "s9", ["a.ts"])]);
  const main = g.find((x) => x.combined)!;
  assert.deepEqual(main.fixes.map((f) => f.id), ["1", "2"]);
  assert.match(g.find((x) => x.fixes[0].id === "3")!.reason!, /same file/);
  assert.match(g.find((x) => x.fixes[0].id === "4")!.reason!, /different commit/);
  assert.match(g.find((x) => x.fixes[0].id === "5")!.reason!, /Duplicate/);
  assert.ok(g.every((x) => new Set(x.fixes.map((f) => f.repo)).size === 1), "no group spans repositories");
  assert.equal(approveLabel("pr", 2), "Approve & create 2 PRs"); assert.equal(approveLabel("branch", 1), "Approve & push 1 branch");
});

test("bulk approval re-checks everything server-side and never merges", () => {
  const s = readFileSync("app/api/bulk/approve/route.ts", "utf8");
  for (const must of [/ownFix\(user\.id, id\)/, /groupFixes\(fixes\)/, /recordApproval\(/, /assertUserCanWrite\(token, repoKey\)/, /isSystemRepo\(repoKey\)/, /writeModeFor\(body\.mode\)/, /patchVersion\(f\.files\) !== f\.patch_version/]) assert.match(s, must);
  assert.doesNotMatch(s, /pulls\.merge|tryMerge|scheduleMerge/);
  const p = readFileSync("app/api/bulk/preview/route.ts", "utf8");
  assert.match(p, /canSee\(user\.id, raw\.repo\)/); assert.doesNotMatch(p, /\/api\/verify|assess\(|draftFix|startRun/, "preview starts no work");
});

test("source status comes from the last successful collection, never from configuration alone", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(statusFrom(null, 5, now), "unknown");
  assert.equal(statusFrom({ last_ok: "2026-11-04T11:55:00Z", last_error: null, runs: 9 }, 5, now), "active");
  assert.equal(statusFrom({ last_ok: "2026-11-04T10:00:00Z", last_error: null, runs: 9 }, 5, now), "delayed");
  assert.equal(statusFrom({ last_ok: "2026-11-04T11:58:00Z", last_error: "503", runs: 9 }, 5, now), "delayed");
  assert.equal(statusFrom({ last_ok: "2026-11-01T00:00:00Z", last_error: "503", runs: 9 }, 5, now), "unavailable");
  assert.equal(statusFrom({ last_ok: null, last_error: "dns", runs: 3 }, 5, now), "unavailable");
});

test("threat reports: public http(s) links only, length limits, honeypot, duplicate key ignores tracking", () => {
  assert.equal(validateReport({ url: "https://arxiv.org/abs/2501.00001", description: "x".repeat(5000) }).ok, true);
  const v = validateReport({ url: "https://arxiv.org/abs/2501.00001#frag", description: "x".repeat(5000) });
  assert.ok(v.ok && v.value.description.length === 1000 && !v.value.url.includes("#"));
  for (const bad of ["javascript:alert(1)", "ftp://a.b/c", "http://localhost/x", "http://10.0.0.1/x", "http://192.168.1.1", "https://u:p@example.com/x", "http://169.254.169.254/latest", "https://intranet/x", "x".repeat(2100)]) assert.equal(validateReport({ url: bad }).ok, false, bad);
  assert.equal(validateReport({ url: "https://example.com/a", website: "spam" }).ok, false);
  assert.equal(reportKey("https://www.example.com/a/?utm_source=x&id=2"), reportKey("https://example.com/a?id=2"));
  const r = readFileSync("app/api/threat-report/route.ts", "utf8");
  assert.doesNotMatch(r, /fetch\(/, "the server never fetches submitted URLs");
  assert.match(r, /pending_review/); assert.match(r, /ADMIN_TOKEN/);
});

test("navigation and filters: Repositories lives in Settings; empty filter selection is explicit", () => {
  const nav = readFileSync("components/header-nav.tsx", "utf8");
  assert.doesNotMatch(nav, /href="\/repos"/);
  assert.ok(nav.indexOf('href="/settings"') < nav.indexOf('href="/monitoring"'), "Settings first after the account label");
  assert.match(readFileSync("app/settings/page.tsx", "utf8"), /id="repositories"/);
  const page = readFileSync("app/alerts/page.tsx", "utf8");
  assert.match(page, /sp\.repo === "none"/); assert.match(page, /No repositories selected/);
  assert.match(readFileSync("components/repo-filter.tsx", "utf8"), /p\.set\("repo", "none"\)/);
});
