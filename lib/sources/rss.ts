// S3: early-signal RSS/Atom feeds (polled). Each feed was probed 2026-10-31 and returned 200.
// A feed that fails at poll time is recorded in the log and shown as degraded in the UI; never silently dropped.
import { XMLParser } from "fast-xml-parser";
import { canonicalUrl, extractIds, sha } from "../dedup";
import type { Item } from "../schema";

// cadence: "fast" feeds are fetched on every 5-minute tick (near-real-time); "slow" feeds hourly (periodic), matching how often they actually publish.
// demo: the feed's terms permit personal/non-commercial use only; items are labelled low-trust and the feed is listed as demo-only.
// format: "rss" (default) is RSS/Atom XML; "hn_algolia" is the Hacker News Algolia JSON search API (hnrss.org, the
// previous source, failed about half of all polls with 502/timeouts on Nov 1 2026; Algolia answered every probe in <1.5 s).
export type Feed = { id: string; name: string; url: string; kind: "list" | "release" | "research" | "ai_security" | "academic" | "aggregator" | "vendor" | "incidents" | "social" | "news"; cadence: "fast" | "slow"; demo?: boolean; format?: "rss" | "hn_algolia"; queries?: string[]; community?: { suggested_by: string; added_at: string } };
export const FEEDS: Feed[] = [
  { id: "oss-sec", name: "oss-security (seclists mirror)", url: "https://seclists.org/rss/oss-sec.rss", kind: "list", cadence: "fast" },
  { id: "fulldisclosure", name: "Full Disclosure", url: "https://seclists.org/rss/fulldisclosure.rss", kind: "list", cadence: "fast" },
  { id: "nextjs-releases", name: "Next.js releases", url: "https://github.com/vercel/next.js/releases.atom", kind: "release", cadence: "fast" },
  { id: "hn-vuln", name: "Hacker News: vulnerability / prompt injection (Algolia)", url: "https://hn.algolia.com/api/v1/search_by_date", kind: "aggregator", cadence: "fast", format: "hn_algolia", queries: ["vulnerability", "\"prompt injection\"", "\"supply chain\""] },
  { id: "embracethered", name: "Embrace The Red (AI/agent security)", url: "https://embracethered.com/blog/index.xml", kind: "ai_security", cadence: "fast" },
  { id: "willison-pi", name: "Simon Willison: prompt injection", url: "https://simonwillison.net/tags/prompt-injection.atom", kind: "ai_security", cadence: "fast" },
  { id: "project-zero", name: "Google Project Zero", url: "https://googleprojectzero.blogspot.com/feeds/posts/default", kind: "research", cadence: "fast" },
  { id: "portswigger", name: "PortSwigger Research", url: "https://portswigger.net/research/rss", kind: "research", cadence: "fast" },
  { id: "wiz", name: "Wiz Research", url: "https://www.wiz.io/feed/rss.xml", kind: "research", cadence: "fast" },
  { id: "certcc", name: "CERT/CC vulnerability notes", url: "https://www.kb.cert.org/vuls/atomfeed/", kind: "list", cadence: "fast" },
  { id: "msrc", name: "Microsoft Security Update Guide", url: "https://api.msrc.microsoft.com/update-guide/rss", kind: "vendor", cadence: "fast" },
  { id: "trailofbits", name: "Trail of Bits", url: "https://blog.trailofbits.com/feed/", kind: "research", cadence: "slow" },
  { id: "github-security", name: "GitHub Blog: security", url: "https://github.blog/security/feed/", kind: "vendor", cadence: "slow" },
  { id: "snyk", name: "Snyk blog (incl. Invariant Labs)", url: "https://snyk.io/blog/feed/", kind: "research", cadence: "slow" },
  { id: "owasp-genai", name: "OWASP GenAI Security Project", url: "https://genai.owasp.org/feed/", kind: "ai_security", cadence: "slow" },
  { id: "hf-blog", name: "Hugging Face blog", url: "https://huggingface.co/blog/feed.xml", kind: "vendor", cadence: "slow" },
  { id: "aiid", name: "AI Incident Database", url: "https://incidentdatabase.ai/rss.xml", kind: "incidents", cadence: "slow" },
  { id: "arxiv-cscr", name: "arXiv cs.CR", url: "https://rss.arxiv.org/atom/cs.CR", kind: "academic", cadence: "slow" },
  { id: "arxiv-ai-sec", name: "arXiv query: prompt injection / LLM agents", url: "http://export.arxiv.org/api/query?search_query=%28cat:cs.CR+OR+cat:cs.AI+OR+cat:cs.LG%29+AND+%28abs:%22prompt+injection%22+OR+abs:jailbreak+OR+abs:%22LLM+agent%22+OR+abs:%22model+context+protocol%22%29&sortBy=submittedDate&max_results=25", kind: "academic", cadence: "slow" },
  { id: "mastodon-infosec", name: "Mastodon infosec.exchange #vulnerability", url: "https://infosec.exchange/tags/vulnerability.rss", kind: "social", cadence: "slow" },
  { id: "gnews-ai-sec", name: "Google News: AI security (demo only)", url: "https://news.google.com/rss/search?q=%22prompt+injection%22+OR+%22AI+agent%22+vulnerability&hl=en-US&gl=US&ceid=US:en", kind: "news", cadence: "slow", demo: true },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", cdataPropName: "#cdata" });
const txt = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") { const o = v as Record<string, unknown>; return txt(o["#cdata"] ?? o["#text"] ?? ""); }
  return String(v);
};
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const asArr = <T,>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

export type FeedEntry = { title: string; link: string | null; author: string | null; published: string | null; summary: string; guid: string };

export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml);
  const out: FeedEntry[] = [];
  if (doc.rss?.channel) {
    for (const it of asArr<Record<string, unknown>>(doc.rss.channel.item)) {
      const link = txt(it.link) || null;
      out.push({ title: strip(txt(it.title)), link, author: txt(it["dc:creator"] ?? it.author) || null,
        published: toISO(txt(it.pubDate ?? it["dc:date"])), summary: strip(txt(it.description ?? it["content:encoded"])).slice(0, 4000),
        guid: txt(it.guid) || link || strip(txt(it.title)) });
    }
  } else if (doc.feed) {
    for (const e of asArr<Record<string, unknown>>(doc.feed.entry)) {
      const links = asArr<Record<string, string>>(e.link as Record<string, string>);
      const link = (links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate")?.["@_href"] ?? links[0]?.["@_href"]) || null;
      const author = e.author && typeof e.author === "object" ? txt((e.author as Record<string, unknown>).name) : txt(e.author);
      out.push({ title: strip(txt(e.title)), link, author: author || null,
        published: toISO(txt(e.published ?? e.updated)), summary: strip(txt(e.summary ?? e.content)).slice(0, 4000),
        guid: txt(e.id) || link || strip(txt(e.title)) });
    }
  }
  return out;
}

function toISO(s: string): string | null { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }

export type Conditional = { etag?: string | null; last_modified?: string | null };

// ---- Hacker News via Algolia (JSON) -------------------------------------------------------------
export type HNHit = { objectID: string; title: string | null; url: string | null; author: string | null; created_at: string; created_at_i: number; story_text?: string | null; points?: number | null };
/** Pure mapping of one Algolia story hit to the common FeedEntry shape (unit-tested). */
export function entryFromHNHit(h: HNHit): FeedEntry {
  const hnUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
  return { title: strip(h.title ?? ""), link: h.url || hnUrl, author: h.author ?? null, published: toISO(h.created_at), summary: strip(h.story_text ?? "").slice(0, 4000), guid: `hn:${h.objectID}` };
}
/** One request per keyword query, newest first; `since` (epoch seconds, kept in the seen-doc's last_modified slot) bounds the response. */
async function fetchHNAlgolia(f: Feed, since: number | null): Promise<{ entries: FeedEntry[]; newest: number | null }> {
  const byId = new Map<string, HNHit>();
  for (const q of f.queries ?? ["vulnerability"]) {
    const p = new URLSearchParams({ query: q, tags: "story", hitsPerPage: "30" });
    if (since) p.set("numericFilters", `created_at_i>${since}`);
    const r = await fetch(`${f.url}?${p}`, { headers: { "User-Agent": "ArgusWatch/0.1 (+https://github.com/chewonc/argus-watch)", Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${f.id} ${r.status}`);
    for (const h of ((await r.json()) as { hits: HNHit[] }).hits ?? []) if (h.objectID && h.title) byId.set(h.objectID, h);
  }
  const hits = [...byId.values()].sort((a, b) => b.created_at_i - a.created_at_i);
  return { entries: hits.map(entryFromHNHit), newest: hits[0]?.created_at_i ?? since };
}

/** Conditional GET: an unchanged feed answers 304 and costs nothing downstream. */
export async function fetchFeed(f: Feed, cond: Conditional = {}): Promise<{ entries: FeedEntry[]; not_modified: boolean; etag: string | null; last_modified: string | null }> {
  if (f.format === "hn_algolia") {
    const since = cond.last_modified && /^\d+$/.test(cond.last_modified) ? Number(cond.last_modified) : null;
    const r = await fetchHNAlgolia(f, since);
    if (!r.entries.length) return { entries: [], not_modified: true, etag: null, last_modified: cond.last_modified ?? null };
    return { entries: r.entries, not_modified: false, etag: null, last_modified: r.newest ? String(r.newest) : cond.last_modified ?? null };
  }
  const headers: Record<string, string> = { "User-Agent": "ArgusWatch/0.1 (+https://github.com/chewonc/argus-watch)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" };
  if (cond.etag) headers["If-None-Match"] = cond.etag;
  if (cond.last_modified) headers["If-Modified-Since"] = cond.last_modified;
  const r = await fetch(f.url, { headers, signal: AbortSignal.timeout(15000) });
  if (r.status === 304) return { entries: [], not_modified: true, etag: cond.etag ?? null, last_modified: cond.last_modified ?? null };
  if (!r.ok) throw new Error(`${f.id} ${r.status}`);
  return { entries: parseFeed(await r.text()), not_modified: false, etag: r.headers.get("etag"), last_modified: r.headers.get("last-modified") };
}

export function itemFromEntry(f: Feed, e: FeedEntry, discovered_at: string): Item {
  const url = canonicalUrl(e.link);
  const text = `${e.title}\n\n${e.summary}`;
  return {
    id: sha(`rss:${f.id}:${e.guid}`),
    source: "rss",
    sourceClass: "polled",
    url,
    title: e.title || "(untitled)",
    author: e.author ?? f.name,
    text,
    ids: extractIds(text),
    packages: [],
    published_at: e.published,
    discovered_at,
    raw: { feed: f.id, kind: f.kind, cadence: f.cadence, demo: !!f.demo },
  };
}
