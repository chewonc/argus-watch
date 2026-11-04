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
  assert.equal(p.title, "Argus Watch: new security alert");
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
