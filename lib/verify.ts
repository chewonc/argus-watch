// Credibility of a threat REPORT (not of repository impact). Three layers, cheapest first:
//  1. Artefact checks (code): every CVE / GHSA / arXiv id the report cites is looked up at its primary registry
//     (NVD, OSV, GitHub Advisory Database, arXiv). Rejected or withdrawn records and ids that exist nowhere are facts.
//  2. Search-grounded adjudication (Meta Muse Spark + Meta web_search, Responses API): extracts the factual claims,
//     looks for primary sources and independent reporting, flags copies of one origin and contradictions. Every URL
//     the model returns must be one the search tool actually returned or opened, otherwise it is discarded.
//  3. A fixed rule (credibilityLabel) decides the label. The model can lower a label, never raise it above what the
//     artefacts and distinct publishers support. Search results are leads, not proof.
// Labels: verified · corroborated · unverified · disputed · likely_false.
import type { Finding, Item } from "./schema";
import { normUrl, sparkSearchJSON, UNTRUSTED } from "./spark";
import { USER_AGENT } from "./ua";

export type Credibility = "verified" | "corroborated" | "unverified" | "disputed" | "likely_false";
export type Artefact = { id: string; kind: "cve" | "ghsa" | "arxiv"; status: "exists" | "rejected" | "withdrawn" | "not_found" | "error"; registry: string; url: string; title: string | null };
export type Evidence = { kind: "artefact" | "primary_source" | "independent_report" | "copy" | "contradiction" | "publisher" | "note"; text: string; url: string | null };
export type Verification = {
  label: Credibility; reason: string; evidence: Evidence[]; artefacts: Artefact[]; publishers: string[];
  model: { used: boolean; suggested: Credibility | null; searches: number; queries: string[]; discarded_urls: number; tokens: number; ms: number; error: string | null; name: string | null };
  checked_at: string; version: string;
};

const OFFICIAL_SOURCES = ["ghsa", "ghadv", "kev", "nvd", "osv"];
const ARXIV_RE = /(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:\s?)(\d{4}\.\d{4,5})(?:v\d+)?/gi;
const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;
const GHSA_RE = /\bGHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\b/gi;
const RANK: Record<Credibility, number> = { likely_false: 0, disputed: 1, unverified: 2, corroborated: 3, verified: 4 };

export function citedIds(text: string): { cve: string[]; ghsa: string[]; arxiv: string[] } {
  const u = (xs: string[]) => [...new Set(xs)];
  return {
    cve: u((text.match(CVE_RE) ?? []).map((x) => x.toUpperCase())).slice(0, 6),
    ghsa: u((text.match(GHSA_RE) ?? []).map((x) => "GHSA" + x.slice(4).toLowerCase())).slice(0, 6),
    arxiv: u([...text.matchAll(ARXIV_RE)].map((m) => m[1])).slice(0, 4),
  };
}

export const hostOf = (u: string | null) => { try { return u ? new URL(u).hostname.toLowerCase().replace(/^www\./, "") : null; } catch { return null; } };

const get = async (url: string, headers: Record<string, string> = {}) => fetch(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(15_000) });

async function checkCve(id: string): Promise<Artefact> {
  const base: Artefact = { id, kind: "cve", status: "error", registry: "NVD", url: `https://nvd.nist.gov/vuln/detail/${id}`, title: null };
  try {
    const r = await get(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`, process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {});
    if (r.ok) {
      const j = await r.json() as { totalResults?: number; vulnerabilities?: { cve: { vulnStatus?: string; descriptions?: { lang: string; value: string }[] } }[] };
      const v = j.vulnerabilities?.[0]?.cve;
      if (v) return { ...base, status: /reject/i.test(v.vulnStatus ?? "") ? "rejected" : "exists", title: (v.descriptions?.find((d) => d.lang === "en")?.value ?? "").slice(0, 200) || null };
      if (j.totalResults === 0) { const o = await checkOsv(id); return o.status === "exists" ? o : { ...base, status: "not_found" }; }
    }
    const o = await checkOsv(id); // NVD rate-limited or down: fall back to OSV
    return o.status === "error" ? base : o.status === "not_found" ? { ...base, status: "not_found", registry: "NVD+OSV" } : o;
  } catch { return base; }
}
async function checkOsv(id: string): Promise<Artefact> {
  const base: Artefact = { id, kind: id.startsWith("GHSA") ? "ghsa" : "cve", status: "error", registry: "OSV", url: `https://osv.dev/vulnerability/${id}`, title: null };
  try {
    const r = await get(`https://api.osv.dev/v1/vulns/${id}`);
    if (r.status === 404) return { ...base, status: "not_found" };
    if (!r.ok) return base;
    const j = await r.json() as { summary?: string; withdrawn?: string };
    return { ...base, status: j.withdrawn ? "withdrawn" : "exists", title: j.summary?.slice(0, 200) ?? null };
  } catch { return base; }
}
async function checkGhsa(id: string): Promise<Artefact> {
  const base: Artefact = { id, kind: "ghsa", status: "error", registry: "GitHub Advisory Database", url: `https://github.com/advisories/${id}`, title: null };
  try {
    const r = await get(`https://api.github.com/advisories/${id}`, { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) });
    if (r.status === 404) { const o = await checkOsv(id); return o.status === "exists" || o.status === "withdrawn" ? o : { ...base, status: o.status === "error" ? "error" : "not_found" }; }
    if (!r.ok) return base;
    const j = await r.json() as { summary?: string; withdrawn_at?: string | null };
    return { ...base, status: j.withdrawn_at ? "withdrawn" : "exists", title: j.summary?.slice(0, 200) ?? null };
  } catch { return base; }
}
async function checkArxiv(id: string): Promise<Artefact> {
  const base: Artefact = { id: `arXiv:${id}`, kind: "arxiv", status: "error", registry: "arXiv", url: `https://arxiv.org/abs/${id}`, title: null };
  try {
    const r = await get(`https://export.arxiv.org/api/query?id_list=${id}&max_results=1`);
    if (!r.ok) return base;
    const x = await r.text();
    const entry = x.split("<entry>")[1];
    if (!entry || /<title>\s*Error\s*<\/title>/i.test(entry) || !/<id>/.test(entry)) return { ...base, status: "not_found" };
    const t = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    return { ...base, status: "exists", title: t?.slice(0, 200) ?? null };
  } catch { return base; }
}

export async function checkArtefacts(text: string): Promise<Artefact[]> {
  const ids = citedIds(text);
  return Promise.all([...ids.cve.map(checkCve), ...ids.ghsa.map(checkGhsa), ...ids.arxiv.map(checkArxiv)]);
}

export type ModelVerdict = {
  claims: { claim: string; primary_sources: string[]; independent_reports: string[]; copies: string[]; contradictions: { source_url: string; detail: string }[] }[];
  suggested_label: Credibility; rationale: string;
};
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["claims", "suggested_label", "rationale"],
  properties: {
    claims: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "primary_sources", "independent_reports", "copies", "contradictions"],
      properties: {
        claim: { type: "string" }, primary_sources: { type: "array", items: { type: "string" } }, independent_reports: { type: "array", items: { type: "string" } }, copies: { type: "array", items: { type: "string" } },
        contradictions: { type: "array", items: { type: "object", additionalProperties: false, required: ["source_url", "detail"], properties: { source_url: { type: "string" }, detail: { type: "string" } } } },
      } } },
    suggested_label: { type: "string", enum: ["verified", "corroborated", "unverified", "disputed", "likely_false"] },
    rationale: { type: "string" },
  },
};
const SYSTEM = `You are the fact-checking stage of SaveBell, a security monitor. ${UNTRUSTED}
Task: decide how credible a security threat REPORT is. Do not judge whether any codebase is affected.
1. Extract at most 4 specific, checkable factual claims (vulnerability exists, affected product/versions, impact, exploitation in the wild, paper results).
2. Use web search to find PRIMARY sources (vendor advisory, CVE/GHSA record, maintainers' release notes or commit, the paper itself) and INDEPENDENT reports (different organisations that did their own analysis).
3. Articles that merely restate one origin are "copies", not independent confirmation. Search results by themselves are not proof.
4. Record contradictions: a primary source that disagrees on existence, versions, impact or status (rejected, withdrawn, disputed).
5. Cite only URLs you actually saw in search results or opened. Never invent URLs. Empty lists are fine.
Labels: verified = a primary source confirms the core claim; corroborated = at least two independent credible reports or one primary source for part of it; unverified = no confirmation found; disputed = credible contradiction; likely_false = cited identifiers or artefacts do not exist or primary sources refute it.`;

export async function adjudicate(report: string, artefacts: Artefact[]): Promise<{ verdict: ModelVerdict; seen: Set<string>; searches: { query: string }[]; tokens: number; ms: number; model: string }> {
  const facts = artefacts.map((a) => `- ${a.id} @ ${a.registry}: ${a.status}${a.title ? ` (${a.title})` : ""}`).join("\n") || "(no identifiers cited)";
  const r = await sparkSearchJSON<ModelVerdict>({ system: SYSTEM, name: "verify", schema: SCHEMA, effort: "low",
    user: `REGISTRY LOOKUPS ALREADY DONE BY CODE (facts):\n${facts}\n\nREPORT (untrusted):\n${report.slice(0, 12000)}` });
  return { verdict: r.out, seen: r.seen, searches: r.searches, tokens: r.tokens, ms: r.ms, model: r.model };
}

/** Pure rule. Inputs are facts (artefacts, sources, publishers) plus model output already filtered to URLs the search saw. */
export function credibilityLabel(input: { officialSource: boolean; artefacts: Artefact[]; publishers: string[]; primary: string[]; independent: string[]; contradictions: { source_url: string; detail: string }[]; suggested: Credibility | null }): { label: Credibility; reason: string } {
  const { officialSource, artefacts, publishers, primary, independent, contradictions, suggested } = input;
  const bad = artefacts.filter((a) => a.status === "rejected" || a.status === "withdrawn");
  if (bad.length) return { label: "disputed", reason: `${bad.map((a) => `${a.id} is ${a.status} at ${a.registry}`).join("; ")}` };
  const missing = artefacts.filter((a) => a.status === "not_found");
  const existing = artefacts.filter((a) => a.status === "exists");
  if (missing.length && !existing.length && !officialSource) return { label: "likely_false", reason: `cited identifier(s) ${missing.map((a) => a.id).join(", ")} do not exist at their registries` };
  let label: Credibility; let reason: string;
  const indepHosts = new Set([...publishers, ...independent.map(hostOf).filter((h): h is string => !!h)]);
  if (officialSource) { label = "verified"; reason = "published by an official vulnerability source"; }
  else if (existing.length && primary.length) { label = "verified"; reason = `primary record ${existing[0].id} exists and a primary source was found`; }
  else if (existing.length || primary.length) { label = "corroborated"; reason = existing.length ? `cited record ${existing.map((a) => a.id).join(", ")} exists at its registry` : "a primary source was found by search"; }
  else if (indepHosts.size >= 2) { label = "corroborated"; reason = `${indepHosts.size} independent publishers`; }
  else { label = "unverified"; reason = "no primary source or independent confirmation found"; }
  if (contradictions.length && RANK[label] > RANK.disputed && !officialSource) { label = "disputed"; reason = `contradicted: ${contradictions[0].detail.slice(0, 160)}`; }
  // The model may only lower the label (e.g. it judged the report a copy of a debunked claim), never raise it.
  if (suggested && RANK[suggested] < RANK[label] && !officialSource && (suggested !== "likely_false" || missing.length || contradictions.length)) { label = suggested; reason = `${reason}; lowered by the fact-checking model`; }
  if (missing.length && label !== "likely_false") reason += `; note: ${missing.map((a) => a.id).join(", ")} not found`;
  return { label, reason };
}

export async function verifyFinding(f: Finding, items: Item[], text: string, version: string, opts: { useModel: boolean }): Promise<Verification> {
  const officialSource = f.sources.some((s) => OFFICIAL_SOURCES.includes(s));
  const artefacts = await checkArtefacts(text);
  const publishers = [...new Set(items.map((i) => hostOf(i.url)).filter((h): h is string => !!h))];
  const evidence: Evidence[] = [
    ...artefacts.map((a) => ({ kind: "artefact" as const, text: `${a.id} at ${a.registry}: ${a.status.replace("_", " ")}${a.title ? ` · ${a.title}` : ""}`, url: a.url })),
    ...publishers.map((p) => ({ kind: "publisher" as const, text: `reported by ${p}`, url: items.find((i) => hostOf(i.url) === p)?.url ?? null })),
  ];
  const model: Verification["model"] = { used: false, suggested: null, searches: 0, queries: [], discarded_urls: 0, tokens: 0, ms: 0, error: null, name: null };
  let primary: string[] = [], independent: string[] = [];
  const contradictions: { source_url: string; detail: string }[] = [];
  // Official-source findings are verified by definition; spend the search only on reports that need it.
  if (opts.useModel && !officialSource) {
    try {
      const r = await adjudicate(text, artefacts);
      const ok = (u: string) => r.seen.has(normUrl(u)) || artefacts.some((a) => normUrl(a.url) === normUrl(u));
      let discarded = 0; const keep = (xs: string[]) => xs.filter((u) => { const k = ok(u); if (!k) discarded++; return k; });
      for (const c of r.verdict.claims) {
        const p = keep(c.primary_sources), i = keep(c.independent_reports), cp = keep(c.copies);
        const cx = c.contradictions.filter((x) => { const k = ok(x.source_url); if (!k) discarded++; return k; });
        primary.push(...p); independent.push(...i); contradictions.push(...cx);
        evidence.push({ kind: "note", text: `claim: ${c.claim}`, url: null });
        for (const u of p) evidence.push({ kind: "primary_source", text: `primary source for: ${c.claim.slice(0, 80)}`, url: u });
        for (const u of i) evidence.push({ kind: "independent_report", text: `independent report: ${hostOf(u)}`, url: u });
        for (const u of cp) evidence.push({ kind: "copy", text: `restates the same origin: ${hostOf(u)}`, url: u });
        for (const x of cx) evidence.push({ kind: "contradiction", text: x.detail.slice(0, 240), url: x.source_url });
      }
      primary = [...new Set(primary)]; independent = [...new Set(independent)];
      Object.assign(model, { used: true, suggested: r.verdict.suggested_label, searches: r.searches.length, queries: r.searches.map((s) => s.query).filter(Boolean).slice(0, 8), discarded_urls: discarded, tokens: r.tokens, ms: r.ms, name: r.model });
      if (r.verdict.rationale) evidence.push({ kind: "note", text: `model rationale: ${r.verdict.rationale.slice(0, 400)}`, url: null });
    } catch (e) { model.error = String((e as Error).message ?? e).slice(0, 200); }
  }
  const { label, reason } = credibilityLabel({ officialSource, artefacts, publishers, primary, independent, contradictions, suggested: model.suggested });
  return { label, reason, evidence: evidence.slice(0, 40), artefacts, publishers, model, checked_at: new Date().toISOString(), version };
}

export const CREDIBILITY_TEXT: Record<Credibility, { label: string; tone: "ok" | "warn" | "bad" | "muted"; help: string }> = {
  verified: { label: "Verified", tone: "ok", help: "A primary source (official advisory, registry record or the paper itself) confirms the report." },
  corroborated: { label: "Corroborated", tone: "ok", help: "Independent sources or a primary record support the report, but not every detail is confirmed." },
  unverified: { label: "Unverified", tone: "warn", help: "No primary source or independent confirmation was found. Treat as a lead." },
  disputed: { label: "Disputed", tone: "bad", help: "A credible source contradicts the report, or its record was rejected or withdrawn." },
  likely_false: { label: "Likely false", tone: "bad", help: "Identifiers the report cites do not exist, or primary sources refute it." },
};
