// GitHub Advisory Database REST (polled every 5 min; official). Complements the App webhook: catches
// deliveries the webhook missed, backfills, and carries severity + CVSS. Same item shape as the webhook source.
import { env } from "../env";
import { extractIds, sha } from "../dedup";
import type { Item } from "../schema";

export type GHAdvisory = {
  ghsa_id: string; cve_id: string | null; summary: string; description: string | null; severity: string;
  published_at: string; updated_at: string; withdrawn_at: string | null; html_url: string;
  cvss?: { score: number | null; vector_string: string | null } | null;
  vulnerabilities?: { package: { ecosystem: string; name: string } | null; vulnerable_version_range: string | null; first_patched_version: string | null }[] | null;
};

const GH = "https://api.github.com";
const hdr = () => ({ Accept: "application/vnd.github+json", "User-Agent": "ArgusWatch/0.1", "X-GitHub-Api-Version": "2022-11-28", ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) });

/** Reviewed advisories updated since `sinceISO` (inclusive), newest first. Pages of 100, up to 3 pages (a backlog after an
 *  outage longer than one interval is otherwise silently truncated); the conditional GET applies to the first page only. */
export async function fetchAdvisories(sinceISO: string | null, etag?: string | null, maxPages = 3): Promise<{ advisories: GHAdvisory[]; etag: string | null; not_modified: boolean }> {
  const q = new URLSearchParams({ type: "reviewed", sort: "updated", direction: "desc", per_page: "100" });
  if (sinceISO) q.set("updated", `>=${sinceISO.slice(0, 19)}Z`.replace("ZZ", "Z"));
  const headers: Record<string, string> = hdr();
  if (etag) headers["If-None-Match"] = etag;
  const r = await fetch(`${GH}/advisories?${q}`, { headers, signal: AbortSignal.timeout(20000) });
  if (r.status === 304) return { advisories: [], etag: etag ?? null, not_modified: true };
  if (!r.ok) throw new Error(`GitHub advisories ${r.status}`);
  const advisories = (await r.json()) as GHAdvisory[];
  let next = r.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  for (let page = 2; next && page <= maxPages && advisories.length >= 100 * (page - 1); page++) {
    const rn = await fetch(next, { headers: hdr(), signal: AbortSignal.timeout(20000) });
    if (!rn.ok) break;
    advisories.push(...((await rn.json()) as GHAdvisory[]));
    next = rn.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return { advisories, etag: r.headers.get("etag"), not_modified: false };
}

export function itemFromAdvisory(a: GHAdvisory, discovered_at: string): Item {
  const ids = [...new Set([a.ghsa_id, a.cve_id, ...extractIds(a.description ?? "")].filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const vulns = (a.vulnerabilities ?? []).filter((v) => v.package);
  const ranges = vulns.map((v) => `${v.package!.ecosystem}/${v.package!.name}: ${v.vulnerable_version_range ?? "unspecified"}${v.first_patched_version ? ` (patched ${v.first_patched_version})` : ""}`);
  return {
    id: sha(`ghadv:${a.ghsa_id}:${a.updated_at}`),
    source: "ghadv",
    sourceClass: "polled",
    url: a.html_url || `https://github.com/advisories/${a.ghsa_id}`,
    title: a.summary,
    author: "GitHub Advisory Database",
    text: `${a.summary}\n\n${a.description ?? ""}\n\nAffected: ${ranges.join("; ")}\nSeverity: ${a.severity}${a.cvss?.score != null ? ` (CVSS ${a.cvss.score})` : ""}${a.withdrawn_at ? `\nWithdrawn: ${a.withdrawn_at}` : ""}`,
    ids,
    packages: vulns.map((v) => ({ ecosystem: v.package!.ecosystem.toLowerCase(), name: v.package!.name })),
    published_at: a.published_at,
    discovered_at,
    raw: { updated_at: a.updated_at, severity: a.severity, cvss_score: a.cvss?.score ?? null, withdrawn_at: a.withdrawn_at, vulnerabilities: a.vulnerabilities ?? [] },
  };
}
