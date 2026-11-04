// NVD CVE API 2.0 (official, polled every 30 minutes). Items are keyed by CVE id + lastModified, so a CVE that the
// GitHub Advisory Database already reported merges into the same finding through its alias (lib/dedup.ts) instead of
// duplicating it. Without an API key NVD allows 5 requests per 30 s; one request per run stays well inside that.
// Only CVEs that look relevant to software supply chains or AI systems are ingested (keyword gate below), so the
// ~150 daily NVD changes do not flood the pipeline; everything else is still covered by OSV for watched packages.
import { sha } from "../dedup";
import type { Item } from "../schema";
import { USER_AGENT } from "../ua";

type NvdCve = { id: string; published: string; lastModified: string; vulnStatus: string; descriptions: { lang: string; value: string }[];
  configurations?: { nodes: { cpeMatch: { criteria: string; vulnerable: boolean }[] }[] }[]; references?: { url: string }[];
  metrics?: Record<string, { cvssData: { baseScore: number; baseSeverity?: string } }[]> };

export const NVD_RELEVANT = /\b(node\.?js|npm packages?|pypi|python packages?|langchain|llama ?index|llama\.cpp|ollama|openai|anthropic|hugging ?face|transformers|pytorch|tensorflow|model context protocol|mcp servers?|prompt injection|large language models?|llms?|ai agents?|agentic|next\.?js|react|express\.?js|django|flask|fastapi|axios|jsonwebtoken|vite|webpack|electron|vs ?code|copilot|github actions?|docker|kubernetes|go modules?|crates\.io)\b/i;
/** Acronyms count only when written upper-case (MCP, JWT), and "npm" only lower-case, so product names like "NPM" (NuPoint Messenger) do not match. */
export const relevantNvd = (hay: string) => NVD_RELEVANT.test(hay) || /\b(MCP|JWT)\b/.test(hay) || /\bnpm\b/.test(hay);

/** NVD often answers 503/502/429 under load: retry twice with growing waits before giving up. */
export async function nvdGet(url: string, headers: Record<string, string>, waits = [2000, 8000], get: typeof fetch = fetch): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await get(url, { headers, signal: AbortSignal.timeout(30_000) }).catch((e) => { if (i >= waits.length) throw e; return null; });
    if (r && (r.ok || ![429, 500, 502, 503, 504].includes(r.status) || i >= waits.length)) return r;
    await new Promise((res) => setTimeout(res, waits[i]));
  }
}

export async function fetchNvd(sinceIso: string, untilIso: string, maxPages = 3): Promise<NvdCve[]> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT };
  if (process.env.NVD_API_KEY) headers.apiKey = process.env.NVD_API_KEY;
  const out: NvdCve[] = [];
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ lastModStartDate: sinceIso, lastModEndDate: untilIso, resultsPerPage: "200", startIndex: String(page * 200) });
    const r = await nvdGet(`https://services.nvd.nist.gov/rest/json/cves/2.0?${q}&noRejected`, headers);
    if (!r.ok) { if (page > 0) break; throw new Error(`NVD ${r.status}${r.status === 403 || r.status === 429 ? " (rate limited)" : ""}`); }
    const j = (await r.json()) as { totalResults?: number; vulnerabilities?: { cve: NvdCve }[] };
    out.push(...(j.vulnerabilities ?? []).map((v) => v.cve));
    if ((page + 1) * 200 >= (j.totalResults ?? 0)) break;
    await new Promise((res) => setTimeout(res, process.env.NVD_API_KEY ? 700 : 6500)); // NVD public rate limit: 5 requests / 30 s
  }
  return out;
}

/** cpe:2.3:a:vendor:product:... → "vendor product" for the item text (helps tech-tag matching). */
const cpeProducts = (c: NvdCve) => [...new Set((c.configurations ?? []).flatMap((x) => x.nodes.flatMap((n) => n.cpeMatch.filter((m) => m.vulnerable).map((m) => m.criteria.split(":").slice(3, 5).join(" ")))))].slice(0, 8);

export function itemFromNvd(c: NvdCve, discovered_at: string): Item | null {
  const desc = c.descriptions.find((d) => d.lang === "en")?.value ?? "";
  const products = cpeProducts(c);
  const hay = `${desc} ${products.join(" ")}`;
  if (!relevantNvd(hay)) return null;
  const metric = Object.values(c.metrics ?? {}).flat()[0]?.cvssData;
  return {
    id: sha(`nvd:${c.id}:${c.lastModified}`),
    source: "nvd", sourceClass: "polled",
    url: `https://nvd.nist.gov/vuln/detail/${c.id}`,
    title: `${c.id}: ${desc.slice(0, 120)}`,
    author: "NVD",
    text: `${desc}\nAffected products (CPE): ${products.join(", ") || "not yet analysed"}\nStatus: ${c.vulnStatus}${metric ? `\nCVSS ${metric.baseScore}${metric.baseSeverity ? ` (${metric.baseSeverity})` : ""}` : ""}\nReferences: ${(c.references ?? []).slice(0, 5).map((r) => r.url).join(" ")}`,
    ids: [c.id.toUpperCase()],
    packages: [],
    published_at: c.published.endsWith("Z") ? c.published : `${c.published}Z`,
    discovered_at,
    raw: { vulnStatus: c.vulnStatus, cvss: metric?.baseScore ?? null },
  };
}
