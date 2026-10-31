import { createHash } from "node:crypto";
import type { Finding, Item, SourceId, Tier } from "./schema";
import { store } from "./store";

export const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

const ID_RE = /\b(CVE-\d{4}-\d{4,7}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|OSV-\d{4}-\d+|PYSEC-\d{4}-\d+|RUSTSEC-\d{4}-\d+)\b/gi;
export const extractIds = (text: string) => [...new Set((text.match(ID_RE) ?? []).map((x) => x.toUpperCase()))];

export function canonicalUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    url.hash = "";
    for (const p of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|fbclid|gclid)/i.test(p)) url.searchParams.delete(p);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const OFFICIAL: SourceId[] = ["ghsa", "kev"];

export function tierFor(f: Pick<Finding, "sources" | "ids" | "items">): Tier {
  if (f.sources.some((s) => OFFICIAL.includes(s))) return "official";
  if (f.items.length >= 2) return "corroborated"; // ≥2 independent items merged into one finding
  return "signal";
}

/**
 * Attach an item to an existing finding (by alias id or canonical URL) or create a new one.
 * Returns the finding and whether it was newly created or materially changed.
 */
export async function upsertFinding(item: Item): Promise<{ finding: Finding; changed: boolean; created: boolean }> {
  const url = canonicalUrl(item.url);
  let fid: string | null = null;
  for (const a of item.ids) { fid = await store.findingIdByAlias(a); if (fid) break; }
  if (!fid && url) fid = await store.findingIdByUrl(url);

  const now = item.discovered_at;
  if (!fid) {
    const f: Finding = {
      id: item.ids[0] ? sha(item.ids[0]) : sha(url ?? item.id),
      ids: item.ids,
      title: item.title,
      tier: "signal",
      items: [item.id],
      sources: [item.source],
      published_at: item.published_at,
      discovered_at: now,
      claim: null,
      claim_version: null,
      status: "new",
      relevant_repos: [],
    };
    f.tier = tierFor(f);
    await store.putFinding(f);
    if (url) await store.setUrl(url, f.id);
    return { finding: f, changed: true, created: true };
  }

  const f = (await store.getFinding(fid))!;
  if (f.items.includes(item.id)) return { finding: f, changed: false, created: false };
  const before = JSON.stringify([f.tier, f.ids, f.published_at]);
  f.items.push(item.id);
  if (!f.sources.includes(item.source)) f.sources.push(item.source);
  f.ids = [...new Set([...f.ids, ...item.ids])];
  if (item.published_at && (!f.published_at || item.published_at < f.published_at)) f.published_at = item.published_at;
  f.tier = tierFor(f);
  await store.putFinding(f);
  if (url) await store.setUrl(url, f.id);
  const changed = before !== JSON.stringify([f.tier, f.ids, f.published_at]);
  return { finding: f, changed, created: false };
}
