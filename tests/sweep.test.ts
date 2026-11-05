// Outstanding-work sweep (Nov 4): Spark attribution, withdrawal, publisher tiering, prefilter word boundaries,
// in-app setting, requeue of stuck analyses, retry of failed poll items. No network, no model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { publisherOf, tierFor, upsertFinding, withdrawnAt } from "../lib/dedup";
import { analysedBySpark, isVerified, statusOf } from "../lib/labels";
import { prefilter } from "../lib/pipeline";
import type { Assessment, Item, WatchedRepo } from "../lib/schema";
import { store } from "../lib/store";

const sev = { level: "high" as const, source: "ghsa" as const, score: null, label: "High" };

test("Spark badge only when backend metadata shows a Muse Spark call on the Meta API", () => {
  const base = { model: "muse-spark-1.3", hosted: "model" as const, model_served: { model: "muse-spark-1.3", host: "api.meta.ai" } };
  assert.equal(analysedBySpark(base), true);
  assert.equal(analysedBySpark({ ...base, hosted: "deterministic" }), false, "version check in code, no model");
  assert.equal(analysedBySpark({ ...base, hosted: "capped" }), false, "budget reached, no model");
  assert.equal(analysedBySpark({ ...base, model: "none", model_served: null }), false, "no model ran");
  assert.equal(analysedBySpark({ ...base, model: "gpt-4o", model_served: { model: "gpt-4o", host: "api.meta.ai" } }), false, "another model");
  assert.equal(analysedBySpark({ ...base, model_served: { model: "muse-spark-1.3", host: "api.example.com" } }), false, "another host (META_BASE_URL overridden)");
  assert.equal(analysedBySpark({ ...base, model_served: { model: "muse-wonder-1.0", host: "api.meta.ai" } }), false, "API reported a different model");
  assert.equal(analysedBySpark({ model: "muse-spark-1.3", hosted: undefined, model_served: undefined }), true, "older record: model written at call time");
  assert.equal(analysedBySpark({ model: "", hosted: undefined, model_served: undefined }), false);
});

test("withdrawn advisories: detected from registry records and never shown as a live threat", () => {
  assert.equal(withdrawnAt({ raw: { withdrawn_at: "2026-11-03T00:00:00Z" } }), "2026-11-03T00:00:00Z");
  assert.equal(withdrawnAt({ raw: { withdrawn: "2026-11-02T00:00:00Z" } }), "2026-11-02T00:00:00Z", "OSV field");
  assert.equal(withdrawnAt({ raw: { withdrawn_at: null } }), null);
  assert.equal(withdrawnAt({ raw: undefined as unknown as Record<string, unknown> }), null);
  const a = { verdict: "Affected" as const, withdrawn_at: "2026-11-03T00:00:00Z" };
  assert.equal(isVerified(a), false);
  assert.equal(statusOf(a, sev, { resolved: false, prOpen: false }).kind, "withdrawn");
  assert.equal(statusOf({ verdict: "Affected" }, sev, { resolved: false, prOpen: false }).kind, "important");
});

test("corroborated needs two distinct publishers, not two items from one site", () => {
  assert.equal(publisherOf({ url: "https://www.Example.com/a", source: "rss" }), "example.com");
  assert.equal(publisherOf({ url: null, source: "kev" }), "kev");
  assert.equal(tierFor({ sources: ["rss"], ids: [], items: ["a", "b"], publishers: ["example.com"] }), "signal");
  assert.equal(tierFor({ sources: ["rss"], ids: [], items: ["a", "b"], publishers: ["example.com", "other.org"] }), "corroborated");
  assert.equal(tierFor({ sources: ["rss"], ids: [], items: ["a", "b"] }), "corroborated", "older record without publishers keeps the item count");
  assert.equal(tierFor({ sources: ["ghadv"], ids: [], items: ["a"], publishers: ["github.com"] }), "official");
});

const item = (id: string, over: Partial<Item> = {}): Item => ({ id, source: "rss", url: `https://blog.example/${id}`, title: `Post ${id}`, text: "", ids: ["CVE-2099-0001"], published_at: "2026-11-01T00:00:00Z", discovered_at: "2026-11-01T00:00:00Z", raw: {}, ...over } as Item);

test("a new item with substantive text, or a withdrawal, re-processes the finding", async () => {
  const first = await upsertFinding(item("s1"));
  assert.equal(first.created, true);
  const short = await upsertFinding(item("s2", { url: "https://blog.example/s2" }));
  assert.equal(short.changed, false, "a short duplicate mention does not trigger re-processing");
  const long = await upsertFinding(item("s3", { url: "https://other.example/s3", text: "x".repeat(250) }));
  assert.equal(long.changed, true, "new report text changes the claim input");
  assert.equal(long.finding.tier, "corroborated");
  const w = await upsertFinding(item("s4", { source: "ghadv", url: null, raw: { withdrawn_at: "2026-11-04T00:00:00Z" } }));
  assert.equal(w.changed, true);
  assert.equal(w.finding.withdrawn_at, "2026-11-04T00:00:00Z");
});

const repo = (pkgs: string[]): WatchedRepo => ({ repo: "o/r", subdir: null, sha: "a".repeat(40), packages: pkgs.map((name) => ({ ecosystem: "npm", name, version: "1.0.0", source_file: "package-lock.json" })), tech_tags: [], refreshed_at: null } as unknown as WatchedRepo);

test("prefilter: short package names match whole words only", () => {
  assert.equal(prefilter("Security news roundup for the week", [repo(["news"])]).relevant, true, "exact word still matches");
  assert.equal(prefilter("Read the latest newsletter", [repo(["news"])]).relevant, false, "no substring match for a 4-letter name");
  assert.equal(prefilter("jose 4.x accepts unsigned tokens", [repo(["jose"])]).relevant, true);
  assert.equal(prefilter("purpose-built tooling", [repo(["pose"])]).relevant, false);
  assert.equal(prefilter("A flaw in jsonwebtoken lets attackers forge tokens", [repo(["jsonwebtoken"])]).relevant, true, "long names keep substring matching");
  assert.equal(prefilter("Next.js middleware bypass", [repo(["next"])]).relevant, true);
});

test("failed poll items are un-marked so the next run retries them", async () => {
  assert.equal(await store.markSeen("kev", "sweep-1"), true);
  assert.equal(await store.markSeen("kev", "sweep-1"), false);
  await store.unmarkSeen("kev", "sweep-1");
  assert.equal(await store.markSeen("kev", "sweep-1"), true);
});

test("assessments record the model the API reported serving", async () => {
  const fields = Object.keys((await import("../lib/schema")).Assessment.shape);
  assert.ok(fields.includes("model_served"));
  assert.ok(fields.includes("withdrawn_at"));
  const a: Pick<Assessment, "model" | "hosted" | "model_served"> = { model: "muse-spark-1.3", hosted: "model", model_served: { model: null, host: "api.meta.ai" } };
  assert.equal(analysedBySpark(a), true, "API omitted the model field: host and requested model still decide");
});

test("public demo scope: only system repositories under the public fixture path", async () => {
  const { isPublicDemoRepo } = await import("../lib/demo");
  assert.equal(await isPublicDemoRepo("someone/private-app"), false);
  assert.equal(await isPublicDemoRepo("chewonc/argus-watch"), false, "the product repo itself is not a demo");
  assert.equal(await isPublicDemoRepo("chewonc/argus-watch/feasibility/cases/../../x"), false);
  assert.equal(await isPublicDemoRepo("chewonc/argus-watch/feasibility/cases/never_registered"), false, "a fixture path that is not a registered shared demo");
});

test("push: plain wording, threshold and fix notices", async () => {
  const { meetsThreshold, pushPayload } = await import("../lib/push");
  const n = { id: "n1", kind: "alert" as const, verdict: "Unclear" as const, repo: "acme/app", title: "t", assessment_id: "f:acme/app:abc", withdrawn: false };
  const p = pushPayload(n, "https://x.test");
  assert.equal(p.title, "SaveBell: new security alert");
  assert.match(p.body, /^Possible vulnerability detected in acme\/app\./);
  assert.match(pushPayload({ ...n, verdict: "Affected" }, "https://x.test").body, /^Vulnerability confirmed in acme\/app\./);
  assert.equal(p.url, "https://x.test/case/f%3Aacme/app%3Aabc");
  assert.equal(p.icon, "/icon-192.png");
  assert.ok(!/\u2014/.test(JSON.stringify(p)), "no em dash in user-facing copy");
  const high = { kind: "alert" as const, severity: { level: "high" as const, source: "ghsa" as const, score: null, label: "High" } };
  const low = { ...high, severity: { ...high.severity, level: "low" as const } };
  assert.equal(meetsThreshold(low, "low"), true);
  assert.equal(meetsThreshold(low, "high"), false);
  assert.equal(meetsThreshold(high, "high"), true);
  assert.equal(meetsThreshold(high, "critical"), false);
  assert.equal(meetsThreshold({ ...low, kind: "fix_pr_created" }, "critical"), true, "fix notices always pass");
});

test("a pull request merged on GitHub marks the fix merged; closing it does not", async () => {
  const { pullOutcome } = await import("../lib/pull-state");
  const pr = { merged: false, merge_commit_sha: null, state: "open", html_url: "https://github.com/o/r/pull/1" };
  assert.equal(pullOutcome({ status: "pr_created" }, pr), null, "still open");
  assert.deepEqual(pullOutcome({ status: "pr_created" }, { ...pr, merged: true, merge_commit_sha: "abc", state: "closed" }), { status: "merged", merge_sha: "abc" });
  assert.deepEqual(pullOutcome({ status: "pr_created" }, { ...pr, state: "closed" }), { closed: true }, "closed without merge is not a fix");
  assert.equal(pullOutcome({ status: "merged" }, { ...pr, merged: true }), null, "already recorded");
  assert.equal(statusOf({ verdict: "Affected" }, sev, { resolved: false, prOpen: false, merged: true }).kind, "fix_merged");
  assert.equal(statusOf({ verdict: "Affected" }, sev, { resolved: false, prOpen: true }).kind, "fix_ready");
});

test("write needs the installation's permissions for the chosen destination", async () => {
  const { installationCanWrite } = await import("../lib/pull-state");
  assert.equal(installationCanWrite({ contents: "write", pull_requests: "write" }, "pr"), true);
  assert.equal(installationCanWrite({ contents: "write" }, "pr"), false, "a PR needs pull_requests write");
  assert.equal(installationCanWrite({ contents: "write" }, "branch"), true, "a branch push needs only contents");
  assert.equal(installationCanWrite({ contents: "read", pull_requests: "write" }, "branch"), false);
  assert.equal(installationCanWrite({}, "pr"), false, "unreadable permissions count as missing");
});

test("fix completion dialog: success only for statuses the server reports, honest next steps", async () => {
  const { fixSummary } = await import("../lib/fix-summary");
  const base = { id: "f1", files: [{ path: "a.ts", patch: "", after: "", before_sha: "" }], runner: null, agent: "muse-code", syntax_check: [], pr_url: "https://github.com/o/r/pull/3", pr_number: 3, pr_draft: true, commit_url: null, branch: "savebell/fix-f1", error: null } as never;
  const s = (status: string, over: object = {}) => fixSummary({ ...(base as object), status, ...over } as never, "o/r");
  assert.equal(s("validated"), null, "a checked patch is not a completed fix");
  assert.equal(s("approved"), null, "a write in progress is not completed");
  assert.equal(s("pr_created")?.tone, "ok");
  assert.match(s("pr_created")!.title, /draft pull request created/);
  assert.match(s("pr_created", { pr_draft: false })!.title, /^Fix complete: pull request created$/);
  assert.ok(s("pr_created")!.points!.includes("Security fix not yet verified"), "never claims the vulnerability is fixed");
  assert.equal(s("pr_created")!.link?.href, "https://github.com/o/r/pull/3");
  assert.equal(s("failed", { error: "403 write access" })?.tone, "bad");
  assert.equal(s("blocked_by_protection")?.tone, "warn");
  assert.equal(s("merged")?.title, "Fix merged");
});

test("UI requests: scale factor, solid bell, bold titles, centered checkbox, Verify tab, Approve & Fix", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /--ui: 1;/); assert.match(css, /@media \(min-width: 1024px\) and \(pointer: fine\)[\s\S]*--ui: 1\.125/);
  assert.match(css, /--spacing: calc\(0\.25rem \* var\(--ui\)\)/);
  assert.doesNotMatch(css, /\bzoom\s*:/); assert.doesNotMatch(css, /transform:\s*scale/);
  const bell = readFileSync("components/notification-bell.tsx", "utf8");
  assert.match(bell, /fill="none"/); // outlined bell (Nov 5 request supersedes the solid one)
  assert.match(bell, /font-semibold \$\{n\.read_at/);
  assert.match(readFileSync("app/notifications/page.tsx", "utf8"), /leading-snug font-semibold`\}>\{n\.display_title\}/);
  assert.match(readFileSync("components/bulk-fix.tsx", "utf8"), /w-4 h-4 self-center/);
  const modal = readFileSync("components/fix-modal.tsx", "utf8");
  assert.doesNotMatch(modal, /onClick=\{goFix\}>Fix<\/button>/, "no Fix button on the Verify tab");
  assert.match(modal, /Check again/);
  assert.match(modal, /hidden=\{tab !== "verify"\}/, "tabs stay mounted so Verify results persist");
  assert.match(modal, /Grant Permission/);
  const rem = readFileSync("components/remediation.tsx", "utf8");
  assert.doesNotMatch(rem, /Check this fix/); assert.match(rem, /Approve &amp; Fix/);
  assert.match(rem, /fix\.patch_version === v/, "auto-approve only the exact reviewed patch");
});

test("suggest a source: relevance and decision rules (only all-green sources are added automatically)", async () => {
  const { relevanceScore, decide } = await import("../lib/source-suggest");
  const sec = [{ title: "CVE-2026-1234: RCE in parser", summary: "" }, { title: "Prompt injection in agent SDK", summary: "" }, { title: "Weekly links", summary: "cooking recipes" }];
  assert.equal(relevanceScore(sec), 0.67);
  assert.equal(relevanceScore([{ title: "Our new office", summary: "team news" }]), 0);
  const ok = { blocked: false, duplicate: false, reachable: true, robotsOk: true, headersOk: true, isFeed: true, entries: 10, relevance: 0.6, capacity: true };
  assert.equal(decide(ok).status, "registered");
  assert.equal(decide({ ...ok, duplicate: true }).status, "duplicate");
  assert.equal(decide({ ...ok, blocked: true }).status, "rejected");
  for (const k of ["reachable", "robotsOk", "headersOk", "isFeed", "capacity"] as const) assert.equal(decide({ ...ok, [k]: false }).status, "needs_review", `${k} false must go to review, not auto-add`);
  assert.equal(decide({ ...ok, relevance: 0.2 }).status, "needs_review");
  assert.equal(decide({ ...ok, entries: 2 }).status, "needs_review");
});

test("suggest a source refuses internal and blocked links before fetching", async () => {
  const { evaluateSuggestion } = await import("../lib/source-suggest");
  assert.deepEqual(await evaluateSuggestion({ name: "x", url: "http://127.0.0.1/feed" }, "u"), { error: "Use a public link (no internal or IP addresses)." });
  assert.ok("error" in (await evaluateSuggestion({ name: "", url: "https://example.com/feed" }, "u")), "name required");
  const r = await evaluateSuggestion({ name: "X", url: `https://x.com/someone-${Date.now()}` }, "u");
  assert.ok(!("error" in r) && r.status === "rejected", "platforms whose terms forbid collection are refused");
});

test("Settings, Sources, Threats and header: requested UI changes are in place", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  assert.doesNotMatch(settings, /title=\{d\.account\}/, "Account section removed");
  const panel = readFileSync("app/repos/panel.tsx", "utf8");
  assert.match(panel, /Nothing in your repository changes without your approval\./);
  assert.doesNotMatch(panel, /A change is written only after/);
  const picker = readFileSync("components/repo-picker.tsx", "utf8");
  assert.match(picker, />Manage GitHub access</); assert.doesNotMatch(picker, /Repository missing\? Grant access on GitHub/);
  assert.doesNotMatch(picker, /disabled=\{r\.watched\}/, "monitored repositories can be unticked");
  assert.match(picker, /window\.confirm\(`Stop monitoring/, "stopping needs explicit confirmation");
  assert.match(readFileSync("app/repos/actions.ts", "utf8"), /getAll\("stop"\)[\s\S]*paused: true/, "unticking pauses monitoring, it does not remove GitHub access");
  assert.match(readFileSync("app/sources/page.tsx", "utf8"), /<SuggestSource/);
  const nav = readFileSync("components/header-nav.tsx", "utf8");
  assert.match(nav, />\{labels\.report\}<\/button>/);
  assert.ok(nav.indexOf(">{labels.report}</button>") < nav.indexOf("type=\"button\" data-lang-item"), "Report comes before Language");
  assert.doesNotMatch(nav, /href="\/windows"/, "no separate Remediation tab");
  for (const f of ["app/favicon.ico", "app/icon.svg", "app/apple-icon.png", "public/icon-512.png", "app/manifest.ts"]) assert.ok(existsSync(f), f);
});

test("What we monitor: category summary is derived from real status", async () => {
  const { groupSummary } = await import("../lib/monitor-sources");
  assert.deepEqual(groupSummary([{ status: "active" }, { status: "active" }]), { text: "2 sources \u00b7 all active", worst: "active" });
  assert.deepEqual(groupSummary([{ status: "active" }, { status: "delayed" }, { status: "unknown" }]), { text: "3 sources \u00b7 1 active, 1 delayed, 1 not recorded yet", worst: "delayed" });
  assert.equal(groupSummary([]).worst, "unknown", "an empty group never claims to be active");
  const { readFileSync } = await import("node:fs");
  const land = readFileSync("components/landing.tsx", "utf8");
  assert.doesNotMatch(land, /md:grid-cols-3 gap-8/); assert.match(land, /<details key=\{g\.id\}/);
  assert.doesNotMatch(land.slice(land.indexOf("function WhatWeMonitor")), /\btruncate\b/, "source names are not truncated");
});
