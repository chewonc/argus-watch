// Plain-language presentation, Fix gating, MCP protocol + evidence validation, and hosted-call accounting.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentToken, resolveAgentToken, revokeAgentToken } from "../lib/agent-token";
import { assess } from "../lib/analyze";
import { canFix } from "../lib/fixgate";
import { discoveredAt, location, plainTitle, statusOf, whereLine } from "../lib/labels";
import { handleRpc, validateEvidence } from "../lib/mcp";
import { permalink } from "../lib/remediation";
import type { Assessment, Claim, Finding, Severity, WatchedRepo } from "../lib/schema";
import { kv, store } from "../lib/store";

const sev = (level: Severity["level"]): Severity => ({ level, cvss: null, source: "ghsa" });
const A = (over: Partial<Assessment> = {}): Assessment => ({ id: "f1:o/r:abc:1", finding_id: "f1", repo: "o/r", sha: "abcdef1234567890", tier: "official", dependency: null, locations: [], conditions: [], verdict: "Unclear", verdict_reason: "", verdict_qualifier: "", missing_evidence: [], unverified: [], recommendations: [], timestamps: { published_at: "2026-10-01T00:00:00Z", discovered_at: "2026-11-01T00:00:00Z", processed_at: "2026-11-01T00:01:00Z", notified_at: null }, model: "m", replayed: false, ...over });
const claim = (over: Partial<Claim> = {}): Claim => ({ actionable: true, claim_type: "framework_misconfiguration", summary: "s", packages: [], tech_tags: ["kubernetes"], conditions: [], not_actionable_reason: null, ...over });
const F = (c: Claim | null, title = "Securing the Kubernetes Supply Chain: Introducing WizOS Helm Charts"): Finding => ({ id: "f1", ids: ["GHSA-x"], title, tier: "official", items: [], sources: [], published_at: null, discovered_at: "2026-11-01T00:00:00Z", claim: c, claim_version: "1", status: "assessed", relevant_repos: [] });

test("one status: verification decides before severity; unverified never shows a severity word", () => {
  assert.equal(statusOf(A({ verdict: "Unclear" }), sev("critical"), { resolved: false, prOpen: false }).label, "Possible issue");
  assert.equal(statusOf(A({ verdict: "Affected" }), sev("critical"), { resolved: false, prOpen: false }).label, "Serious");
  assert.equal(statusOf(A({ verdict: "Affected" }), sev("high"), { resolved: false, prOpen: false }).label, "Important");
  assert.equal(statusOf(A({ verdict: "Affected" }), sev("low"), { resolved: false, prOpen: false }).label, "Minor");
  assert.equal(statusOf(A({ verdict: "Not Affected" }), sev("high"), { resolved: false, prOpen: false }).kind, "not_affected");
  assert.equal(statusOf(A({ verdict: "Affected" }), sev("high"), { resolved: false, prOpen: true }).label, "Fix ready to review");
  for (const l of ["critical", "high", "moderate", "low"] as const) assert.notEqual(statusOf(A({ verdict: "Affected" }), sev(l), { resolved: false, prOpen: false }).label, "Urgent");
});

test("titles: never the article title; unverified names only the technology", () => {
  const t = plainTitle(A(), F(claim()), null, ["kubernetes"]);
  assert.equal(t, "Possible security issue with Kubernetes");
  const loc = { file: ".github/workflows/ci.yml", from: 12, to: 12 };
  const v = plainTitle(A({ verdict: "Affected" }), F(claim()), loc);
  assert.ok(!/Reckoning|Securing|Introducing/.test(v));
  assert.equal(plainTitle(A({ verdict: "Affected" }), F(claim({ plain_title: "Attackers could run code on your server" })), loc), "Attackers could run code on your server");
});

test("where line: unverified findings never show a file", () => {
  const a = A({ locations: [{ file: "src/auth.ts", line: 4, quote: "x", why: "" }] });
  assert.equal(whereLine(a, location(a)).kind, "unverified");
  const v = A({ verdict: "Affected", locations: [{ file: "src/auth.ts", line: 4, quote: "x", why: "" }] });
  assert.deepEqual(whereLine(v, location(v)), { kind: "file", text: "src/auth.ts:4" });
  assert.equal(whereLine(A({ verdict: "Affected" }), null).text, "Affected file not found");
});

test("newest first uses discovery time with fallbacks", () => {
  assert.equal(discoveredAt(A()), "2026-11-01T00:00:00Z");
  assert.equal(discoveredAt(A({ timestamps: { published_at: "p", discovered_at: "", processed_at: "q", notified_at: null } })), "q");
});

test("Fix is hidden unless every condition holds", () => {
  const ok = { enabled: true, allowPr: true, isDemo: false, hasInstallation: true, writePermission: true, loc: { file: "src/a.ts" }, priorFailed: false };
  const v = A({ verdict: "Affected" });
  assert.equal(canFix(v, ok), true);
  assert.equal(canFix(v, { ...ok, enabled: false }), false);
  assert.equal(canFix(A(), ok), false); // unverified
  assert.equal(canFix(v, { ...ok, loc: null }), false);
  assert.equal(canFix(v, { ...ok, loc: { file: ".github/workflows/ci.yml" } }), false);
  assert.equal(canFix(v, { ...ok, allowPr: false }), false);
  assert.equal(canFix(v, { ...ok, isDemo: true }), false);
  assert.equal(canFix(v, { ...ok, writePermission: null }), false);
  assert.equal(canFix(v, { ...ok, priorFailed: true }), false);
  assert.equal(canFix(v, { ...ok, enabled: undefined }), false); // FIX_ENABLED defaults off
});

test("GitHub link targets the exact file and line range at the commit", () => {
  assert.equal(permalink("o/r", "abc", "src/a.ts", 3, 7), "https://github.com/o/r/blob/abc/src/a.ts#L3-L7");
});

test("report_result evidence is re-read and must match", async () => {
  const read = async (_r: string, _s: string, f: string) => (f === "src/a.ts" ? "const a = 1;\nexec(userInput);\n" : null);
  assert.deepEqual(await validateEvidence(A(), [{ file: "src/a.ts", line: 2, quote: "exec(userInput)" }], read), []);
  assert.equal((await validateEvidence(A(), [{ file: "src/a.ts", line: 1, quote: "exec(userInput)" }], read)).length, 1);
  assert.equal((await validateEvidence(A(), [{ file: "src/nope.ts", line: 1, quote: "abc" }], read)).length, 1);
  assert.equal((await validateEvidence(A(), [{ file: "../etc/passwd", line: 1, quote: "abc" }], read)).length, 1);
  assert.equal((await validateEvidence(A(), [{ file: "src/a.ts", line: 99, quote: "abc" }], read)).length, 1);
});

test("MCP: initialize, tools/list, notifications, unknown methods", async () => {
  const ctx = { uid: "gh:mcp", client: null };
  const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx)) as { result: { protocolVersion: string; capabilities: { tools: unknown } } };
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx), null);
  const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx)) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), ["list_findings", "get_finding", "get_file_context", "report_result"]);
  assert.ok(list.result.tools.filter((t) => t.name !== "report_result").every((t) => t.annotations.readOnlyHint));
  const bad = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, ctx)) as { error: { code: number } };
  assert.equal(bad.error.code, -32601);
});

test("MCP: a user cannot read another user's findings", async () => {
  await store.putAssessment(A({ id: "f9:other/repo:abc:1", repo: "other/repo" }));
  const r = (await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_finding", arguments: { id: "f9:other/repo:abc:1" } } }, { uid: "gh:stranger", client: null })) as { result: { isError: boolean } };
  assert.equal(r.result.isError, true);
});

test("agent tokens: hashed, resolvable, revocable", async () => {
  const t = await createAgentToken("gh:tok", "Claude Code");
  const rec = await resolveAgentToken(t);
  assert.equal(rec?.user_id, "gh:tok");
  assert.equal(await kv.get(`agenttok:${t}`), null); // raw token never stored
  assert.equal(await resolveAgentToken("aw_wrongwrongwrongwrongwrong"), null);
  await revokeAgentToken("gh:tok", rec!.hash);
  assert.equal(await resolveAgentToken(t), null);
});

test("hosted model calls: measured per path (model vs deterministic vs capped)", async () => {
  let calls = 0;
  const orig = globalThis.fetch;
  process.env.META_API_KEY ||= "test";
  const { env } = await import("../lib/env"); env.META_API_KEY ||= "test";
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes("/chat/completions")) {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ locations: [], conditions: [{ id: "c1", state: "Unknown", evidence_file: null, evidence_line: null, reasoning: "" }], unverified: [], recommendations: [] }) } }], usage: { total_tokens: 1000 } }));
    }
    if (String(url).includes("/git/trees/")) return new Response(JSON.stringify({ tree: [], truncated: false }));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    const repo: WatchedRepo = { repo: "o/r", default_branch: "main", subdir: "", installation_id: null, private: false, sha: "abcdef1234567890", packages: [{ ecosystem: "npm", name: "lodash", version: "4.17.20", source_file: "package-lock.json" }], tech_tags: ["express"], refreshed_at: null };
    const codeClaim = claim({ tech_tags: ["express"], conditions: [{ id: "c1", text: "uses merge on user input", role: "required", mitigation_kind: "not_applicable", source_quote: "" }] });
    const depClaim = claim({ claim_type: "dependency_vulnerability", packages: [{ ecosystem: "npm", name: "lodash", affected_ranges: ["<4.17.21"] }], conditions: [] });
    const a1 = await assess(F(codeClaim), codeClaim, repo, { budget: true });
    assert.equal(a1.hosted, "model");
    const afterModel = calls;
    const a2 = await assess(F(depClaim), depClaim, repo, { budget: true });
    assert.equal(a2.hosted, "deterministic"); assert.equal(a2.verdict, "Affected"); // version computed in code
    assert.ok(a2.recommendations[0].text.includes("lodash"));
    const a3 = await assess(F(codeClaim), codeClaim, repo, { budget: false });
    assert.equal(a3.hosted, "capped"); assert.equal(a3.verdict, "Unclear"); // still alerts, as "Possible issue"
    assert.equal(statusOf(a3, sev("critical"), { resolved: false, prOpen: false }).label, "Possible issue");
    assert.equal(afterModel, 1);
    assert.equal(calls, 1, "deterministic and capped paths make no hosted model call");
    const used = await kv.get<number>(`usage:${new Date().toISOString().slice(0, 7)}:assessment:calls`);
    assert.ok((used ?? 0) >= 1);
  } finally { globalThis.fetch = orig; }
});

test("MCP route: 401 without or with a bad token, 403 for a foreign browser origin, works with a valid token", async () => {
  const { POST, GET } = await import("../app/api/mcp/route");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal((await POST(new Request("http://x/api/mcp", { method: "POST", body }))).status, 401);
  assert.equal((await POST(new Request("http://x/api/mcp", { method: "POST", body, headers: { authorization: "Bearer aw_notarealtokennotarealtoken" } }))).status, 401);
  const t = await createAgentToken("gh:route", "test");
  assert.equal((await POST(new Request("http://x/api/mcp", { method: "POST", body, headers: { authorization: `Bearer ${t}`, origin: "https://evil.example" } }))).status, 403);
  const ok = await POST(new Request("http://x/api/mcp", { method: "POST", body, headers: { authorization: `Bearer ${t}` } }));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { result: { tools: unknown[] } }).result.tools.length, 4);
  assert.equal((await GET()).status, 405);
});

test("hosted budget: per-user monthly cap; repositories with any user under the cap keep hosted analysis", async () => {
  const { hostedBudgetLeft, chargeHosted, hostedUsedBy } = await import("../lib/usage");
  const { env } = await import("../lib/env");
  const cap = env.HOSTED_ANALYSIS_CAP; env.HOSTED_ANALYSIS_CAP = 2;
  try {
    await store.addUserRepo({ user_id: "gh:cap", repo_key: "cap/repo", installation_id: null, allow_pr: false, local_root: null, added_at: "now" });
    assert.equal(await hostedBudgetLeft("cap/repo"), true);
    await chargeHosted("cap/repo"); await chargeHosted("cap/repo");
    assert.equal((await hostedUsedBy("gh:cap")).used, 2);
    assert.equal(await hostedBudgetLeft("cap/repo"), false);
    await store.addUserRepo({ user_id: "gh:cap2", repo_key: "cap/repo", installation_id: null, allow_pr: false, local_root: null, added_at: "now" });
    assert.equal(await hostedBudgetLeft("cap/repo"), true);
  } finally { env.HOSTED_ANALYSIS_CAP = cap; }
});
