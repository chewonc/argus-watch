// Unit tests for the pure, decision-bearing functions. Run: npm test (node --test via tsx; no network, no model).
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalUrl, extractIds, tierFor } from "../lib/dedup";
import { applyHunks, gitBlobSha, syntaxCheck, unifiedDiff } from "../lib/fix";
import { mask, unmask } from "../lib/i18n/mask";
import { prefilter } from "../lib/pipeline";
import { parseLockfiles, techTags, versionInRanges } from "../lib/repo";
import type { ConditionResult, WatchedRepo } from "../lib/schema";
import { cvssLevel, deriveSeverity } from "../lib/severity";
import { decide, relevance } from "../lib/verdict";

const cond = (id: string, state: ConditionResult["state"], role: "required" | "mitigation" = "required", mk: ConditionResult["mitigation_kind"] = "not_applicable"): ConditionResult =>
  ({ id, text: id, role, mitigation_kind: mk, source_quote: "", state, evidence: [], reasoning: "", computed: false });

test("verdict: contradiction wins", () => { assert.equal(decide([cond("a", "Observed"), cond("b", "Contradicted")], "official").verdict, "Not Affected"); });
test("verdict: required unknown -> Unclear", () => { assert.equal(decide([cond("a", "Observed"), cond("b", "Unknown")], "official").verdict, "Unclear"); });
test("verdict: unknown environment mitigation -> Unclear (strict)", () => { assert.equal(decide([cond("a", "Observed"), cond("m", "Unknown", "mitigation", "environment")], "official").verdict, "Unclear"); });
test("verdict: unknown workaround mitigation does not block Affected", () => { assert.equal(decide([cond("a", "Observed"), cond("m", "Unknown", "mitigation", "workaround")], "official").verdict, "Affected"); });
test("verdict: signal tier capped at Unclear", () => { assert.equal(decide([cond("a", "Observed")], "signal").verdict, "Unclear"); });
test("verdict: corroborated needs every required Observed", () => { assert.equal(decide([cond("a", "Inferred")], "corroborated").verdict, "Unclear"); assert.equal(decide([cond("a", "Observed")], "corroborated").verdict, "Affected"); });
test("relevance labels", () => {
  assert.equal(relevance("Affected", "official", []), "Confirmed affected"); assert.equal(relevance("Affected", "corroborated", []), "Likely affected");
  assert.equal(relevance("Unclear", "official", [cond("a", "Observed"), cond("b", "Unknown")]), "Potentially affected"); assert.equal(relevance("Unclear", "official", [cond("a", "Unknown")]), "Insufficient evidence"); assert.equal(relevance("Not Affected", "official", []), "Not affected");
});

test("versionInRanges: GHSA comma ranges and prerelease", () => {
  assert.equal(versionInRanges("14.2.10", [">= 14.0.0, < 14.2.25"]), true);
  assert.equal(versionInRanges("14.2.25", [">= 14.0.0, < 14.2.25", ">= 15.0.0, < 15.2.3"]), false);
  assert.equal(versionInRanges("15.2.3-canary.1", [">= 15.0.0, < 15.2.3"]), true);
  assert.equal(versionInRanges("1.2.3", ["not a range"]), null);
  assert.equal(versionInRanges("garbage", [">= 1.0.0"]), null);
});
test("parseLockfiles: package-lock v3 beats package.json declaration", () => {
  const pk = parseLockfiles([
    { path: "package.json", text: JSON.stringify({ dependencies: { next: "^14.2.0" } }) },
    { path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/next": { version: "14.2.10" } } }) },
  ]);
  assert.deepEqual(pk.map((p) => [p.name, p.version, p.source_file]), [["next", "14.2.10", "package-lock.json"]]);
  assert.deepEqual(parseLockfiles([{ path: "requirements.txt", text: "Django==4.2.1\nrequests>=2\n" }]).map((p) => p.name + "@" + p.version), ["django@4.2.1"]);
});
test("techTags", () => { assert.deepEqual(techTags([{ ecosystem: "npm", name: "next", version: "14", source_file: "x" }], ["middleware.ts", "Dockerfile"]).sort(), ["docker", "next-middleware", "next.js"]); });

test("dedup helpers", () => {
  assert.deepEqual(extractIds("see CVE-2025-29927 and ghsa-f82v-jwr5-mffw twice CVE-2025-29927"), ["CVE-2025-29927", "GHSA-F82V-JWR5-MFFW"]);
  assert.equal(canonicalUrl("https://www.Example.com/a/?utm_source=x&id=1#frag"), "https://example.com/a/?id=1");
  assert.equal(tierFor({ sources: ["ghsa"], ids: [], items: ["a"] }), "official"); assert.equal(tierFor({ sources: ["rss"], ids: [], items: ["a", "b"] }), "corroborated"); assert.equal(tierFor({ sources: ["rss"], ids: [], items: ["a"] }), "signal");
});
test("prefilter: generic names need word boundaries; AI terms need an LLM/MCP tag", () => {
  const repo = (names: string[], tags: string[]): WatchedRepo => ({ repo: "o/r", default_branch: "main", subdir: "", sha: null, packages: names.map((n) => ({ ecosystem: "npm", name: n, version: "1", source_file: "p" })), tech_tags: tags, refreshed_at: null, installation_id: null, private: false });
  assert.equal(prefilter("the nextgen thing", [repo(["next"], [])]).relevant, false);
  assert.equal(prefilter("Next.js middleware bug", [repo(["next"], [])]).relevant, true);
  assert.equal(prefilter("prompt injection in agents", [repo([], ["mcp"])]).hits.includes("ai-agent"), true);
  assert.equal(prefilter("prompt injection in agents", [repo([], ["docker"])]).relevant, false);
});

test("severity: CVSS bands, stated level, estimate with KEV bump", () => {
  assert.equal(cvssLevel(9.8), "critical"); assert.equal(cvssLevel(4), "moderate");
  assert.deepEqual(deriveSeverity({ verdict: "Affected", tier: "official" }, [{ source: "ghsa", text: "x", raw: { severity: "high", cvss_score: null } }]), { level: "high", cvss: null, source: "ghsa" });
  assert.deepEqual(deriveSeverity({ verdict: "Affected", tier: "official" }, [{ source: "ghsa", text: "Severity: critical", raw: {} }]), { level: "critical", cvss: null, source: "ghsa" });
  assert.deepEqual(deriveSeverity({ verdict: "Affected", tier: "official" }, [{ source: "kev", text: "", raw: {} }]), { level: "critical", cvss: null, source: "estimated" });
  assert.deepEqual(deriveSeverity({ verdict: "Unclear", tier: "signal" }, []), { level: "low", cvss: null, source: "estimated" });
  assert.equal(deriveSeverity({ verdict: "Not Affected", tier: "official" }, []).level, "none");
});

test("mask/unmask round-trips identifiers, paths, versions and ids", () => {
  const text = "Upgrade next from 14.2.10 to >=14.2.25; see CVE-2025-29927 in src/app/middleware.ts:12 and `x_middleware_subrequest`.";
  const { html, tokens } = mask(text, ["next"]);
  assert.ok(html.includes('<span class="notranslate">CVE-2025-29927</span>'));
  assert.ok(html.includes('<span class="notranslate">src/app/middleware.ts:12</span>'));
  assert.equal(unmask(html, tokens), text);
  assert.ok(tokens.includes("14.2.10") && tokens.includes("next"));
});

test("applyHunks: exactly-once rule", () => {
  const src = "a\nb\nc\nb\n";
  const r1 = applyHunks(src, [{ path: "f", search: "a\n", replace: "A\n", rationale: "", addresses: "root_cause", condition_ids: [] }]);
  assert.equal(r1.after, "A\nb\nc\nb\n"); assert.equal(r1.applied.length, 1);
  const r2 = applyHunks(src, [{ path: "f", search: "b\n", replace: "B\n", rationale: "", addresses: "symptom", condition_ids: [] }]);
  assert.equal(r2.applied.length, 0); assert.match(r2.rejected[0].reason, /ambiguous/);
  const r3 = applyHunks(src, [{ path: "f", search: "zzz", replace: "", rationale: "", addresses: "unrelated", condition_ids: [] }]);
  assert.match(r3.rejected[0].reason, /not found/);
});
test("unifiedDiff and syntaxCheck", () => {
  const d = unifiedDiff("m.ts", "const a = 1;\n", "const a = 2;\n", "abcdef0");
  assert.ok(d.includes("-const a = 1;") && d.includes("+const a = 2;"));
  assert.equal(syntaxCheck("m.ts", "export const x: number = 1;").ok, true);
  const bad = syntaxCheck("m.tsx", "export function f( { return <div>; }");
  assert.equal(bad.ok, false); assert.ok(bad.errors.length > 0);
  assert.equal(syntaxCheck("p.json", "{\"a\":1}").ok, true); assert.equal(syntaxCheck("p.json", "{a:1}").ok, false);
  assert.equal(syntaxCheck("Dockerfile", "FROM x").label, "not checked (no parser for this file type)");
});
test("gitBlobSha matches git's blob hashing", () => { assert.equal(gitBlobSha("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a"); });
