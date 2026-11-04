// "Suggest a source": users propose AI-safety or security feeds. Argus checks each suggestion automatically and adds it
// to monitoring only when every check passes; anything uncertain is queued for an operator instead.
//
// Checks, in order:
//   1. URL is a public http(s) link (no credentials, IPs, internal hosts); the hostname must resolve to public addresses
//      only, and each redirect hop is re-checked (no server-side request forgery).
//   2. Not a duplicate of a built-in feed or an earlier suggestion (same feed URL or same site).
//   3. Platforms whose terms forbid automated collection or need paid/App-Review API access are refused.
//   4. Reachable without login; robots.txt does not disallow the feed; no X-Robots-Tag noindex/none/noai.
//   5. It is an RSS/Atom feed (published for automated reading), found directly or via <link rel="alternate">.
//   6. Relevance: a share of recent entries is about security vulnerabilities or AI safety/security.
// Registered feeds join the hourly ("slow") feed group and flow through the normal pipeline (dedup, credibility
// check, extraction, matching, rule verdict). Items are stored as link + excerpt, like every other feed.
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { disallowed } from "./fetchpage";
import { FEEDS, parseFeed, type Feed, type FeedEntry } from "./sources/rss";
import { reportKey, validateReport } from "./threat-report";
import { kv } from "./store";

export type SuggestionStatus = "registered" | "needs_review" | "rejected" | "duplicate";
export type Suggestion = {
  id: string; user_id: string; name: string; url: string; description: string; submitted_at: string;
  status: SuggestionStatus; reason: string; checks: { name: string; ok: boolean | null; detail: string }[];
  feed_url: string | null; feed_id: string | null; relevance: number | null;
};

const UA = "ArgusWatch/0.1 (+https://github.com/chewonc/argus-watch)";
const MAX_COMMUNITY_FEEDS = 50;
// Terms forbid automated collection, or access needs a paid API / App Review (same list as Sources → Not accessible).
const BLOCKED = /(^|\.)(x\.com|twitter\.com|linkedin\.com|threads\.net|reddit\.com|facebook\.com|instagram\.com|tiktok\.com|news\.google\.com)$/i;
const SECURITY = /\b(vulnerab\w*|cve-\d{4}|exploit\w*|malware|ransomware|advisor(y|ies)|security|zero[- ]day|0day|patch(ed|es)?|phishing|breach\w*|backdoor|supply[- ]chain|xss|sqli|rce|privilege escalation|threat\w*)\b/i;
const AI_SAFETY = /\b(prompt injection|jailbreak\w*|ai safety|alignment|red[- ]team\w*|adversarial|model (theft|extraction|poisoning)|data poisoning|llm security|agent(ic)? (security|risk)|mcp)\b/i;

/** Pure: share of entries about security or AI safety (title + summary). */
export function relevanceScore(entries: Pick<FeedEntry, "title" | "summary">[]): number {
  if (!entries.length) return 0;
  const hits = entries.filter((e) => { const t = `${e.title} ${e.summary.slice(0, 600)}`; return SECURITY.test(t) || AI_SAFETY.test(t); }).length;
  return Math.round((hits / entries.length) * 100) / 100;
}

/** Pure: final decision from the check results. Only an all-green suggestion is registered automatically. */
export function decide(c: { blocked: boolean; duplicate: boolean; reachable: boolean; robotsOk: boolean; headersOk: boolean; isFeed: boolean; entries: number; relevance: number; capacity: boolean }): { status: SuggestionStatus; reason: string } {
  if (c.duplicate) return { status: "duplicate", reason: "Already monitored or already suggested." };
  if (c.blocked) return { status: "rejected", reason: "This platform's terms or API access rules don't allow automated collection." };
  if (!c.reachable) return { status: "needs_review", reason: "The link couldn't be read without signing in, or didn't respond." };
  if (!c.robotsOk || !c.headersOk) return { status: "needs_review", reason: "The site restricts automated access, so an operator will check its terms." };
  if (!c.isFeed) return { status: "needs_review", reason: "No RSS or Atom feed was found. Pages without a feed need an operator's review." };
  if (c.entries < 3) return { status: "needs_review", reason: "The feed has too few entries to judge yet." };
  if (c.relevance < 0.3) return { status: "needs_review", reason: `Only ${Math.round(c.relevance * 100)}% of recent entries are about security or AI safety.` };
  if (!c.capacity) return { status: "needs_review", reason: "The community feed limit is reached; an operator will review it." };
  return { status: "registered", reason: "Checks passed. Added to monitoring; new entries are collected hourly." };
}

const PRIVATE_IP = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i;
async function publicHost(host: string): Promise<boolean> {
  try { const addrs = await lookup(host, { all: true }); return addrs.length > 0 && addrs.every((a) => !PRIVATE_IP.test(a.address)); } catch { return false; }
}

/** GET with SSRF protection: public addresses only, redirects followed manually (max 3) and re-checked, 1.5 MB cap. */
async function safeGet(url: string): Promise<{ ok: boolean; status: number; url: string; type: string; text: string; robotsTag: string } | null> {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(cur);
    if (!/^https?:$/.test(u.protocol) || !(await publicHost(u.hostname))) return null;
    const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html" }, redirect: "manual", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!r) return null;
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { cur = new URL(r.headers.get("location")!, u).toString(); continue; }
    const buf = await r.arrayBuffer().catch(() => new ArrayBuffer(0));
    return { ok: r.ok, status: r.status, url: cur, type: r.headers.get("content-type") ?? "", text: new TextDecoder().decode(buf.slice(0, 1_500_000)), robotsTag: r.headers.get("x-robots-tag") ?? "" };
  }
  return null;
}

/** Feeds added from suggestions (joined to the hourly feed group by lib/poll.ts). */
export async function communityFeeds(): Promise<Feed[]> { return (await kv.get<Feed[]>("feeds:community")) ?? []; }
export async function listSuggestions(uid?: string, n = 50): Promise<Suggestion[]> { return kv.lrange<Suggestion>(uid ? `source_suggestions:${uid}` : "source_suggestions", 0, n - 1); }

const key = (url: string) => { try { return reportKey(url); } catch { return url; } };
const site = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

export async function evaluateSuggestion(input: { name?: unknown; url?: unknown; description?: unknown; website?: unknown }, uid: string): Promise<Suggestion | { error: string }> {
  const v = validateReport({ url: input.url, description: input.description, website: input.website });
  if (!v.ok) return { error: v.error };
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  if (!name) return { error: "Give the source a name." };
  const url = v.value.url;
  const checks: Suggestion["checks"] = [];
  const base = { id: createHash("sha256").update(`${uid}:${url}:${Date.now()}`).digest("hex").slice(0, 16), user_id: uid, name, url, description: v.value.description, submitted_at: new Date().toISOString(), feed_url: null as string | null, feed_id: null as string | null, relevance: null as number | null };

  const community = await communityFeeds();
  const known = [...FEEDS, ...community];
  const earlier = await listSuggestions(undefined, 500);
  const duplicate = known.some((f) => key(f.url) === key(url)) || earlier.some((s) => key(s.url) === key(url) || (s.feed_url && key(s.feed_url) === key(url)));
  checks.push({ name: "Not already monitored or suggested", ok: !duplicate, detail: duplicate ? "matches an existing source" : "new" });
  const blocked = BLOCKED.test(site(url));
  checks.push({ name: "Platform allows automated collection", ok: !blocked, detail: blocked ? "platform terms or API access rules" : "no known restriction" });
  if (duplicate || blocked) { const d = decide({ blocked, duplicate, reachable: true, robotsOk: true, headersOk: true, isFeed: true, entries: 9, relevance: 1, capacity: true }); return { ...base, ...d, checks }; }

  // Reachable, then find the feed (the URL itself, or <link rel="alternate" type="application/rss+xml|atom+xml">).
  let res = await safeGet(url);
  const reachable = !!res && res.ok;
  checks.push({ name: "Reachable without signing in", ok: reachable, detail: res ? `HTTP ${res.status}` : "no response, or not a public address" });
  let entries: FeedEntry[] = reachable ? parseFeed(res!.text) : [];
  let feedUrl = entries.length ? res!.url : null;
  if (reachable && !entries.length && /html/i.test(res!.type)) {
    const m = res!.text.match(/<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]*>/i)?.[0].match(/href=["']([^"']+)["']/i)?.[1];
    if (m) { const fu = new URL(m, res!.url).toString(); const fr = await safeGet(fu); if (fr?.ok) { const e2 = parseFeed(fr.text); if (e2.length) { entries = e2; feedUrl = fr.url; res = fr; } } }
  }
  const isFeed = !!feedUrl;
  checks.push({ name: "RSS or Atom feed found", ok: isFeed, detail: isFeed ? `${entries.length} entries at ${feedUrl}` : "no feed" });
  const robotsOk = isFeed ? !(await disallowed(new URL(feedUrl!))) : reachable ? !(await disallowed(new URL(url))) : false;
  checks.push({ name: "robots.txt allows reading", ok: reachable ? robotsOk : null, detail: robotsOk ? "allowed" : "disallowed or not checked" });
  const headersOk = !/noindex|none|noai/i.test(res?.robotsTag ?? "");
  checks.push({ name: "No restrictive X-Robots-Tag", ok: headersOk, detail: res?.robotsTag || "none" });
  const relevance = relevanceScore(entries.slice(0, 30));
  checks.push({ name: "About security or AI safety", ok: isFeed ? relevance >= 0.3 : null, detail: isFeed ? `${Math.round(relevance * 100)}% of recent entries` : "not assessed" });
  const capacity = community.length < MAX_COMMUNITY_FEEDS;
  const d = decide({ blocked, duplicate, reachable, robotsOk, headersOk, isFeed, entries: entries.length, relevance, capacity });
  const s: Suggestion = { ...base, ...d, checks, feed_url: feedUrl, relevance: isFeed ? relevance : null };
  if (d.status === "registered" && feedUrl) {
    const ai = entries.slice(0, 30).filter((e) => AI_SAFETY.test(`${e.title} ${e.summary.slice(0, 600)}`)).length >= entries.slice(0, 30).length / 4;
    const feed: Feed = { id: `community-${createHash("sha256").update(key(feedUrl)).digest("hex").slice(0, 10)}`, name: name.slice(0, 80), url: feedUrl, kind: ai ? "ai_security" : "research", cadence: "slow", community: { suggested_by: uid, added_at: s.submitted_at } };
    await kv.set("feeds:community", [...community, feed]);
    s.feed_id = feed.id;
  }
  return s;
}

export async function saveSuggestion(s: Suggestion) {
  await kv.lpush("source_suggestions", s);
  await kv.lpush(`source_suggestions:${s.user_id}`, s);
}
