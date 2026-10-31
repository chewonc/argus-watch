// S3: early-signal RSS/Atom feeds (polled). Each feed was probed 2026-10-31 and returned 200.
// A feed that fails at poll time is recorded in the log and shown as degraded in the UI; never silently dropped.
import { XMLParser } from "fast-xml-parser";
import { canonicalUrl, extractIds, sha } from "../dedup";
import type { Item } from "../schema";

export type Feed = { id: string; name: string; url: string; kind: "list" | "release" | "research" | "ai_security" | "academic" | "aggregator" };
export const FEEDS: Feed[] = [
  { id: "oss-sec", name: "oss-security (seclists mirror)", url: "https://seclists.org/rss/oss-sec.rss", kind: "list" },
  { id: "fulldisclosure", name: "Full Disclosure", url: "https://seclists.org/rss/fulldisclosure.rss", kind: "list" },
  { id: "nextjs-releases", name: "Next.js releases", url: "https://github.com/vercel/next.js/releases.atom", kind: "release" },
  { id: "arxiv-cscr", name: "arXiv cs.CR", url: "https://rss.arxiv.org/atom/cs.CR", kind: "academic" },
  { id: "project-zero", name: "Google Project Zero", url: "https://googleprojectzero.blogspot.com/feeds/posts/default", kind: "research" },
  { id: "portswigger", name: "PortSwigger Research", url: "https://portswigger.net/research/rss", kind: "research" },
  { id: "wiz", name: "Wiz Research", url: "https://www.wiz.io/feed/rss.xml", kind: "research" },
  { id: "embracethered", name: "Embrace The Red (AI/agent security)", url: "https://embracethered.com/blog/index.xml", kind: "ai_security" },
  { id: "willison-pi", name: "Simon Willison: prompt injection", url: "https://simonwillison.net/tags/prompt-injection.atom", kind: "ai_security" },
  { id: "hn-vuln", name: "Hacker News: vulnerability", url: "https://hnrss.org/newest?q=vulnerability", kind: "aggregator" },
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

export async function fetchFeed(f: Feed): Promise<FeedEntry[]> {
  const r = await fetch(f.url, { headers: { "User-Agent": "ArgusWatch/0.1 (+https://github.com/chewonc/argus-watch)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (!r.ok) throw new Error(`${f.id} ${r.status}`);
  return parseFeed(await r.text());
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
    raw: { feed: f.id, kind: f.kind },
  };
}
