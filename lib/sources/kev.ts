// S2: CISA Known Exploited Vulnerabilities (polled JSON; official; no key).
import { sha } from "../dedup";
import type { Item } from "../schema";
import { USER_AGENT } from "../ua";

export const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

type KEV = { catalogVersion: string; dateReleased: string; count: number; vulnerabilities: {
  cveID: string; vendorProject: string; product: string; vulnerabilityName: string; dateAdded: string;
  shortDescription: string; requiredAction: string; dueDate: string; knownRansomwareCampaignUse: string; notes: string; cwes?: string[];
}[] };

/** Conditional GET on the 1.8 MB catalog: unchanged → 304, nothing parsed. */
export async function fetchKEV(etag?: string | null): Promise<{ kev: KEV | null; etag: string | null; not_modified: boolean }> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (etag) headers["If-None-Match"] = etag;
  const r = await fetch(KEV_URL, { headers, signal: AbortSignal.timeout(30000) });
  if (r.status === 304) return { kev: null, etag: etag ?? null, not_modified: true };
  if (!r.ok) throw new Error(`KEV ${r.status}`);
  return { kev: (await r.json()) as KEV, etag: r.headers.get("etag"), not_modified: false };
}

export function itemsFromKEV(k: KEV, sinceDateAdded: string | null, discovered_at: string): Item[] {
  return k.vulnerabilities
    // dateAdded is day-granular: include the cursor day too and let the caller dedupe by item id (same-day additions are not missed)
    .filter((v) => !sinceDateAdded || v.dateAdded >= sinceDateAdded)
    .map((v) => ({
      id: sha(`kev:${v.cveID}:${v.dateAdded}`),
      source: "kev" as const,
      sourceClass: "polled" as const,
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(v.cveID)}`,
      title: `${v.vendorProject} ${v.product}: ${v.vulnerabilityName}`,
      author: "CISA",
      text: `${v.vulnerabilityName}\n${v.shortDescription}\nRequired action: ${v.requiredAction}\nKnown ransomware use: ${v.knownRansomwareCampaignUse}\nNotes: ${v.notes}`,
      ids: [v.cveID.toUpperCase()],
      packages: [], // KEV names vendor/product, not package coordinates; matching uses tech tags + CVE aliases
      published_at: `${v.dateAdded}T00:00:00Z`,
      discovered_at,
      raw: { vendorProject: v.vendorProject, product: v.product, dueDate: v.dueDate },
    }));
}
