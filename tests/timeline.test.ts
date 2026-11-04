// Threat Timeline (lib/timeline.ts): deterministic events, quote grounding of model proposals, merge/order,
// conflict handling, Muse Wonder review grounding, summary lint, and the full build with mocked registries and Meta API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReview, findConflicts, groundReview, itemEvents, mergeEvents, registryEvents, repoEvents, summaryGrounded, templateSummary, validateProposal, type TLEvent } from "../lib/timeline";
import type { Assessment, Fix, Item } from "../lib/schema";

const item = (p: Partial<Item>): Item => ({ id: "i" + Math.random().toString(36).slice(2, 8), source: "rss", sourceClass: "polled", url: "https://blog.example/post", title: "t", author: null, text: "", ids: [], packages: [], published_at: null, discovered_at: "2026-11-01T00:00:00Z", ...p } as Item);
const F = { id: "f1", discovered_at: "2026-11-01T08:00:00Z" };

test("deterministic events: advisory, update, patch (inferred date), KEV exploitation, undated feed item", () => {
  const ev = itemEvents([
    item({ source: "ghadv", url: "https://github.com/advisories/GHSA-x", published_at: "2025-03-21T15:20:12Z", raw: { updated_at: "2025-04-10T00:00:00Z", vulnerabilities: [{ package: { name: "next" }, first_patched_version: "14.2.25" }] } }),
    item({ source: "kev", url: "https://www.cisa.gov/kev", published_at: "2025-03-25T00:00:00Z", raw: { dueDate: "2025-04-15" } }),
    item({ source: "rss", url: "https://blog.example/a", title: "Writeup", published_at: null }),
  ], F);
  const k = (kind: string) => ev.filter((e) => e.kind === kind);
  assert.equal(k("advisory_published")[0].confidence, "confirmed");
  assert.equal(k("advisory_updated").length, 1);
  assert.equal(k("patch")[0].confidence, "inferred", "patch release date is not stated by the advisory");
  assert.match(k("patch")[0].title, /next 14\.2\.25/);
  assert.equal(k("exploitation")[0].confidence, "confirmed");
  assert.equal(k("exploitation")[0].sources[0].publisher, "CISA");
  const rep = k("report")[0];
  assert.equal(rep.confidence, "inferred"); assert.equal(rep.basis, "argus_record"); assert.match(rep.detail!, /first saw/);
  assert.ok(ev.every((e) => e.at && e.sources.length), "every event has a timestamp and a source");
});

test("model proposals are kept only when date and claim are quoted verbatim and the date matches the quote", () => {
  const src = [{ text: "On March 21, 2025 Vercel published a fix in Next.js 14.2.25. Attackers were seen exploiting it in the wild the following week." }];
  const ok = validateProposal({ source_index: 0, kind: "patch", date: "2025-03-21", date_quote: "March 21, 2025", claim_quote: "Vercel published a fix in Next.js 14.2.25", title: "Fix released" }, src, Date.parse("2026-11-04"));
  assert.ok(ok.ok); assert.equal(ok.ok && ok.at.slice(0, 10), "2025-03-21");
  const bad = (p: object, reason: RegExp) => { const v = validateProposal({ source_index: 0, kind: "patch", date: "2025-03-21", date_quote: "March 21, 2025", claim_quote: "Vercel published a fix in Next.js 14.2.25", title: "x", ...p }, src, Date.parse("2026-11-04")); assert.equal(v.ok, false); assert.match((v as { reason: string }).reason, reason); };
  bad({ claim_quote: "Vercel quietly patched every version" }, /claim not found/);
  bad({ date_quote: "March 22, 2025" }, /date not found/);
  bad({ date: "2025-04-21" }, /does not state this date/);
  bad({ date: "2025-3-21" }, /YYYY-MM/);
  bad({ source_index: 3 }, /unknown source/);
  const future = validateProposal({ source_index: 0, kind: "report", date: "2027-01", date_quote: "January 2027", claim_quote: "a planned disclosure in January", title: "x" }, [{ text: "a planned disclosure in January 2027" }], Date.parse("2026-11-04"));
  assert.equal(future.ok, false);
});

const E = (p: Partial<TLEvent>): TLEvent => ({ id: Math.random().toString(36).slice(2), at: "2025-03-21T00:00:00.000Z", precision: "day", kind: "advisory_published", title: "x", detail: null, sources: [{ url: "https://a", publisher: "A" }], confidence: "confirmed", basis: "registry", quote: null, date_quote: null, conflicts_with: [], lane: "threat", ...p });

test("merge: the same development from several sources becomes one event with all sources; order is chronological", () => {
  const m = mergeEvents([
    E({ kind: "disclosure", at: "2025-03-22T00:00:00.000Z", sources: [{ url: "https://nvd", publisher: "NVD" }] }),
    E({ kind: "advisory_published", at: "2025-03-21T15:00:00.000Z", sources: [{ url: "https://gh", publisher: "GitHub" }] }),
    E({ kind: "exploitation", at: "2025-03-01T00:00:00.000Z", confidence: "reported", basis: "model_extracted", sources: [{ url: "https://blog", publisher: "blog" }] }),
  ]);
  assert.equal(m.length, 2);
  assert.equal(m[0].kind, "exploitation");
  assert.equal(m[1].sources.length, 2);
});

test("conflicts: a source's earlier disclosure date is kept beside the registry date, never dropped", () => {
  const reg = E({ kind: "advisory_published", at: "2025-03-21T00:00:00.000Z" });
  const claim = E({ kind: "disclosure", at: "2025-02-27T00:00:00.000Z", confidence: "reported", basis: "model_extracted", sources: [{ url: "https://blog", publisher: "blog" }], quote: "first reported on February 27, 2025" });
  const later = E({ kind: "patch", at: "2025-04-02T00:00:00.000Z", confidence: "reported", basis: "model_extracted", sources: [{ url: "https://blog", publisher: "blog" }] });
  const evs = mergeEvents([reg, claim, later, E({ kind: "patch", at: "2025-03-21T00:00:00.000Z", confidence: "inferred" })]);
  const pairs = findConflicts(evs);
  assert.equal(pairs.length, 1, "a later patch release than the advisory listing is consistent, not a conflict");
  assert.equal(evs.length, 4);
  applyReview(evs, { a: pairs[0][0].id, b: pairs[0][1].id, resolution: "unresolved", reason: "", evidence_quote: null, grounded: false, error: null });
  assert.ok(evs.filter((e) => /different dates/.test(e.detail ?? "")).length === 2);
});

test("Muse Wonder review counts only with a verbatim quote from the supplied material, and never removes events", () => {
  const material = "A: registry record\nSOURCE TEXT: The vendor disclosed the bug on February 27, 2025 to maintainers.";
  const good = groundReview({ resolution: "prefer_b", evidence_quote: "disclosed the bug on February 27, 2025", reason: "vendor text states it" }, material);
  assert.equal(good.resolution, "prefer_b"); assert.ok(good.grounded);
  const invented = groundReview({ resolution: "prefer_a", evidence_quote: "NVD confirms March 21 is the first disclosure", reason: "registry is authoritative" }, material);
  assert.equal(invented.resolution, "unresolved"); assert.equal(invented.grounded, false); assert.match(invented.reason, /does not appear/);
  const a = E({}), b = E({ kind: "disclosure", basis: "model_extracted", confidence: "reported" });
  const evs = [a, b];
  applyReview(evs, { a: a.id, b: b.id, ...good, error: null });
  assert.equal(evs.length, 2);
  assert.match(b.detail!, /Muse Wonder judged this date better supported/);
  assert.match(a.detail!, /kept for review/);
});

test("summary: model text must not introduce dates, versions or confirmed exploitation absent from the events", () => {
  const evs = [E({ title: "Patched version listed: next 14.2.25", kind: "patch" }), E({ kind: "exploitation", confidence: "reported", basis: "model_extracted" })];
  assert.ok(summaryGrounded("Disclosed in 2025; next 14.2.25 lists the fix.", evs));
  assert.equal(summaryGrounded("Disclosed in 2024.", evs), false);
  assert.equal(summaryGrounded("Fixed in 14.2.26.", evs), false);
  assert.equal(summaryGrounded("Exploitation is confirmed.", evs), false);
  assert.match(templateSummary(evs), /not confirmed by CISA/);
  assert.match(templateSummary([E({})]), /No confirmed exploitation/);
});

test("registry: GHSA + NVD dates (incl. CISA KEV date) become confirmed events; failures are recorded, not fatal", async () => {
  const fetcher = (async (url: string) => {
    if (url.includes("api.github.com/advisories/GHSA-f82v")) return new Response(JSON.stringify({ html_url: "https://github.com/advisories/GHSA-f82v-jwr5-mffw", published_at: "2025-03-21T15:20:12Z", updated_at: "2025-03-21T15:20:12Z", withdrawn_at: null, vulnerabilities: [{ package: { name: "next" }, first_patched_version: "14.2.25" }] }));
    if (url.includes("nvd.nist.gov") && url.includes("CVE-2025-29927")) return new Response(JSON.stringify({ totalResults: 1, vulnerabilities: [{ cve: { published: "2025-03-21T15:15:42.660", vulnStatus: "Analyzed", cisaExploitAdd: "2025-04-01" } }] }));
    if (url.includes("CVE-2099-0001")) throw new Error("network down");
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const r = await registryEvents(["GHSA-F82V-JWR5-MFFW", "CVE-2025-29927", "CVE-2099-0001"], fetcher);
  assert.deepEqual(r.registry.map((x) => `${x.id}:${x.status}`), ["GHSA-f82v-jwr5-mffw:ok", "CVE-2025-29927:ok", "CVE-2099-0001:error"]);
  const x = r.events.find((e) => e.kind === "exploitation")!;
  assert.equal(x.confidence, "confirmed"); assert.equal(x.at.slice(0, 10), "2025-04-01");
  assert.ok(r.events.some((e) => e.kind === "disclosure" && e.at.startsWith("2025-03-21T15:15")));
});

test("repository lane: a pull request is shown as opened, never as resolved or verified", () => {
  const a = { repo: "o/r", sha: "abcdef123456", verdict: "Affected", timestamps: { published_at: null, discovered_at: "2026-11-01T00:00:00Z", processed_at: "2026-11-01T00:01:00Z", notified_at: "2026-11-01T00:01:05Z" } } as Assessment;
  const fix = { id: "x", agent: "muse-spark", files: [{}], created_at: "2026-11-02T00:00:00Z", approved_at: "2026-11-02T00:05:00Z", pr_url: "https://github.com/o/r/pull/7", pr_number: 7, status: "pr_created", events: [], commit_url: null } as unknown as Fix;
  const evs = repoEvents(a, [fix]);
  assert.deepEqual(evs.map((e) => e.kind), ["argus_assessed", "argus_notified", "fix_drafted", "fix_pr"]);
  const pr = evs.find((e) => e.kind === "fix_pr")!;
  assert.match(pr.title, /not merged; the fix is not verified/);
  assert.ok(evs.every((e) => e.lane === "repo"));
});

test("full build with mocked Meta API: rejected proposals are counted, accepted ones carry quotes, cache by item set", async () => {
  process.env.META_API_KEY ||= "test";
  const { env } = await import("../lib/env"); env.META_API_KEY ||= "test";
  const { buildTimeline, getTimeline } = await import("../lib/timeline");
  const orig = globalThis.fetch; let modelCalls = 0;
  const text = "Researchers disclosed the bypass on March 18, 2025. The flaw is being exploited in the wild according to our telemetry since March 24, 2025.";
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/chat/completions")) {
      modelCalls++;
      const body = JSON.parse(String(init?.body ?? "{}"));
      const name = body.response_format?.json_schema?.name;
      if (name === "timeline") return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ events: [
        { source_index: 0, kind: "disclosure", date: "2025-03-18", date_quote: "March 18, 2025", claim_quote: "Researchers disclosed the bypass", title: "Bypass disclosed by researchers" },
        { source_index: 0, kind: "exploitation", date: "2025-03-24", date_quote: "March 24, 2025", claim_quote: "The flaw is being exploited in the wild", title: "Exploitation reported" },
        { source_index: 0, kind: "patch", date: "2025-03-20", date_quote: "March 20, 2025", claim_quote: "a patch shipped", title: "Invented patch" },
      ] }) } }], usage: { total_tokens: 500 } }));
      if (name === "timeline_summary") return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Exploitation is confirmed since 2024." }) } }], usage: { total_tokens: 100 } }));
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const items = [item({ id: "it1", source: "rss", url: "https://research.example/post", title: "Bypass write-up", text, published_at: "2025-03-25T10:00:00Z" })];
    const f = { id: "fT", ids: [], items: ["it1"], discovered_at: "2026-11-01T00:00:00Z" } as never;
    const t = await buildTimeline(f, items, { fetchPages: false, fetcher: (async () => new Response("{}", { status: 404 })) as never });
    assert.equal(t.model.proposed, 3); assert.equal(t.model.accepted, 2);
    assert.equal(t.model.rejected[0].reason, "date not found in the source text");
    const x = t.events.find((e) => e.kind === "exploitation")!;
    assert.equal(x.confidence, "reported"); assert.match(x.detail!, /not confirmed by CISA/);
    assert.equal(x.quote, "The flaw is being exploited in the wild");
    assert.equal(t.summary_basis, "template", "a summary claiming confirmed exploitation and an unseen year is rejected");
    const calls = modelCalls;
    assert.ok(await getTimeline(f));
    await buildTimeline(f, items, { fetchPages: false });
    assert.equal(modelCalls, calls, "cached: no new model calls for the same item set");
    const f2 = { ...(f as object), items: ["it1", "it2"] } as never;
    assert.equal(await getTimeline(f2), null, "a new report about the threat invalidates the cached timeline");
  } finally { globalThis.fetch = orig; }
});

test("conflicts: a merged registry record that also cites the blog still conflicts with the blog's earlier date", () => {
  const reg = E({ kind: "advisory_published", at: "2025-03-21T00:00:00.000Z", sources: [{ url: "https://github.com/advisories/G", publisher: "GitHub" }, { url: "https://blog", publisher: "blog" }] });
  const claim = E({ kind: "disclosure", at: "2025-02-27T00:00:00.000Z", confidence: "reported", basis: "model_extracted", sources: [{ url: "https://blog", publisher: "blog" }] });
  assert.equal(findConflicts([reg, claim]).length, 1);
});

test("Muse Wonder review: API failure leaves both events unresolved; the call goes to the Wonder model", async () => {
  process.env.META_API_KEY ||= "test";
  const { env } = await import("../lib/env"); env.META_API_KEY ||= "test";
  const { reviewConflict } = await import("../lib/timeline");
  const orig = globalThis.fetch; const models: string[] = [];
  const a = E({}), b = E({ kind: "disclosure", basis: "model_extracted", confidence: "reported", sources: [{ url: "https://blog", publisher: "blog" }], quote: "disclosed on February 27, 2025" });
  try {
    globalThis.fetch = (async (_u: string, init?: RequestInit) => { models.push(JSON.parse(String(init?.body)).model); return new Response("bad request", { status: 400 }); }) as typeof fetch;
    const r = await reviewConflict(a, b, new Map([["https://blog", "It was disclosed on February 27, 2025 privately."]]));
    assert.equal(r.resolution, "unresolved"); assert.ok(r.error); assert.equal(models[0], "muse-wonder-1.0");
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ resolution: "prefer_a", evidence_quote: "the registry is always right", reason: "authority" }) } }] }))) as unknown as typeof fetch;
    const r2 = await reviewConflict(a, b, new Map([["https://blog", "It was disclosed on February 27, 2025 privately."]]));
    assert.equal(r2.resolution, "unresolved", "a preference without a verbatim quote is not accepted"); assert.equal(r2.grounded, false);
  } finally { globalThis.fetch = orig; }
});

test("repository lane tolerates fixes stored before the audit trail existed (no events, no files)", () => {
  const a = { repo: "o/r", sha: "abcdef123456", verdict: "Unclear", timestamps: { published_at: null, discovered_at: "2026-11-01T00:00:00Z", processed_at: "2026-11-01T00:01:00Z", notified_at: null } } as Assessment;
  const legacy = { id: "old", agent: "muse-spark", created_at: "2026-11-02T00:00:00Z", pr_url: null, status: "failed" } as unknown as Fix;
  assert.deepEqual(repoEvents(a, [legacy]).map((e) => e.kind), ["argus_assessed"]);
});

test("concurrent builds of one finding share a single run", async () => {
  const { buildTimeline } = await import("../lib/timeline");
  const f = { id: "fC", ids: [], items: [], discovered_at: "2026-11-01T00:00:00Z" } as never;
  const [x, y] = await Promise.all([buildTimeline(f, [], { force: true, fetchPages: false }), buildTimeline(f, [], { force: true, fetchPages: false })]);
  assert.equal(x, y);
});
