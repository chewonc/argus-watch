// S2: CISA Known Exploited Vulnerabilities (polled JSON; official; no key).
import { sha } from "../dedup";
import type { Item } from "../schema";

export const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

type KEV = { catalogVersion: string; dateReleased: string; count: number; vulnerabilities: {
  cveID: string; vendorProject: string; product: string; vulnerabilityName: string; dateAdded: string;
  shortDescription: string; requiredAction: string; dueDate: string; knownRansomwareCampaignUse: string; notes: string; cwes?: string[];
}[] };

export async function fetchKEV(): Promise<KEV> {
  const r = await fetch(KEV_URL, { headers: { "User-Agent": "ArgusWatch/0.1 (+https://github.com/chewonc/argus-watch)" } });
  if (!r.ok) throw new Error(`KEV ${r.status}`);
  return (await r.json()) as KEV;
}

export function itemsFromKEV(k: KEV, sinceDateAdded: string | null, discovered_at: string): Item[] {
  return k.vulnerabilities
    .filter((v) => !sinceDateAdded || v.dateAdded > sinceDateAdded)
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
