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

const OFFICIAL: SourceId[] = ["ghsa", "ghadv", "kev", "nvd", "osv"];

/** Who published an item: the URL host (www. stripped), else the source id. Two posts on one site are one publisher. */
export const publisherOf = (item: Pick<Item, "url" | "source">): string => { try { return item.url ? new URL(item.url).hostname.toLowerCase().replace(/^www\./, "") : item.source; } catch { return item.source; } };

/** Withdrawal time stated by a registry record carried in the item (GitHub Advisory DB / GHSA webhook / OSV). */
export function withdrawnAt(item: Pick<Item, "raw">): string | null {
  const r = (item.raw ?? {}) as Record<string, unknown>;
  const adv = (r.security_advisory ?? r) as Record<string, unknown>;
  const w = adv.withdrawn_at ?? adv.withdrawn ?? r.withdrawn;
  return typeof w === "string" && w ? w : null;
}

export function tierFor(f: Pick<Finding, "sources" | "ids" | "items" | "publishers">): Tier {
  if (f.sources.some((s) => OFFICIAL.includes(s))) return "official";
  // Corroborated needs at least two distinct publishers; several posts or feed entries from one site are one voice.
  // Records created before publishers were tracked keep the old item count.
  if ((f.publishers ? f.publishers.length : f.items.length) >= 2) return "corroborated";
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
      publishers: [publisherOf(item)],
      withdrawn_at: withdrawnAt(item),
    };
    f.tier = tierFor(f);
    await store.putFinding(f);
    if (url) await store.setUrl(url, f.id);
    return { finding: f, changed: true, created: true };
  }

  const f = (await store.getFinding(fid))!;
  if (f.items.includes(item.id)) return { finding: f, changed: false, created: false };
  const before = JSON.stringify([f.tier, f.ids, f.published_at, f.withdrawn_at ?? null]);
  // Older records: rebuild the publisher list from the stored items once.
  if (!f.publishers) f.publishers = [...new Set((await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x): x is Item => !!x).map(publisherOf))];
  f.items.push(item.id);
  const pub = publisherOf(item); if (!f.publishers.includes(pub)) f.publishers.push(pub);
  const w = withdrawnAt(item); if (w && !f.withdrawn_at) f.withdrawn_at = w;
  if (!f.sources.includes(item.source)) f.sources.push(item.source);
  f.ids = [...new Set([...f.ids, ...item.ids])];
  if (item.published_at && (!f.published_at || item.published_at < f.published_at)) f.published_at = item.published_at;
  f.tier = tierFor(f);
  await store.putFinding(f);
  if (url) await store.setUrl(url, f.id);
  // A new item with substantive text changes what the claim is extracted from (the claim version is a hash of all item
  // text), so the finding is re-processed: re-extraction, new assessments and a fresh timeline. Withdrawal also counts.
  const newText = (item.text ?? "").trim().length >= 200;
  const changed = newText || before !== JSON.stringify([f.tier, f.ids, f.published_at, f.withdrawn_at ?? null]);
  return { finding: f, changed, created: false };
}
