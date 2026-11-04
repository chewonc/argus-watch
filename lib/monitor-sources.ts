// "What We Monitor": the threat-intelligence sources Argus Watch actually collects from, with status derived from real
// collector state (lib/poll.ts poll state per source, per-feed results in the shared seen document, GitHub App webhook
// deliveries in the log). Nothing here is hardcoded as "active": a source is Active only when its last successful
// collection is recent for its schedule. Sources are polled on a schedule; nothing claims real-time streaming.
// Public data only: names, public homepages, statuses and times. No errors, credentials or internal endpoints.
import { hasGitHubApp } from "./env";
import { POLLERS, type PollState } from "./poll";
import { FEEDS } from "./sources/rss";
import { store } from "./store";

export type SourceStatus = "active" | "delayed" | "unavailable" | "not_configured" | "unknown";
export type MonitoredSource = { id: string; name: string; url: string; status: SourceStatus; last_ok: string | null };
export type SourceGroup = { id: "advisories" | "ai" | "research"; title: string; sources: MonitoredSource[] };

/** Status from the last successful collection relative to the source's own schedule. */
export function statusFrom(s: { last_ok: string | null; last_error?: string | null; runs?: number } | null, intervalMin: number, now = Date.now()): SourceStatus {
  if (!s || (!s.last_ok && !s.runs && !s.last_error)) return "unknown";
  if (!s.last_ok) return "unavailable";
  const age = now - Date.parse(s.last_ok);
  if (s.last_error && age > 24 * 3600e3) return "unavailable"; // failing and nothing collected for a day
  if (age <= Math.max(3 * intervalMin, 20) * 60e3 && !s.last_error) return "active";
  return "delayed"; // recent error, or no successful collection within three intervals
}

// Public homepages for sources whose collector URL is an API or a query.
const HOME: Record<string, string> = {
  "hn-vuln": "https://news.ycombinator.com/", "arxiv-ai-sec": "https://arxiv.org/", "arxiv-cscr": "https://arxiv.org/list/cs.CR/recent",
  msrc: "https://msrc.microsoft.com/update-guide", certcc: "https://www.kb.cert.org/vuls/", "oss-sec": "https://seclists.org/oss-sec/",
  fulldisclosure: "https://seclists.org/fulldisclosure/", "nextjs-releases": "https://github.com/vercel/next.js/releases",
  "willison-pi": "https://simonwillison.net/tags/prompt-injection/", "mastodon-infosec": "https://infosec.exchange/tags/vulnerability",
};
const homeOf = (id: string, url: string) => HOME[id] ?? new URL(url).origin + "/";
const AI_KINDS = new Set(["ai_security", "incidents"]);

export async function monitoredSources(now = Date.now()): Promise<SourceGroup[]> {
  const states = new Map(await Promise.all(POLLERS.map(async (p) => [p.id, await store.getPollState<PollState>(p.id)] as const)));
  const seen = ((await store.getSeenDoc<Record<string, { last_ok?: string | null; last_error?: string | null; first_ok: string | null }>>("seen:rss")) ?? {});
  const log = await store.recentLog(500);
  const lastWebhook = log.find((l) => l.kind === "webhook" && /security_advisory/.test(l.detail))?.at ?? null;
  const poller = (id: string) => POLLERS.find((p) => p.id === id)!;
  const fromPoller = (id: string, name: string, url: string): MonitoredSource => {
    const st = states.get(id) ?? null;
    return { id, name, url, status: statusFrom(st, poller(id).interval_min, now), last_ok: st?.last_ok ?? null };
  };
  const advisories: MonitoredSource[] = [
    fromPoller("ghadv", "GitHub Security Advisories", "https://github.com/advisories"),
    fromPoller("nvd", "NVD (National Vulnerability Database)", "https://nvd.nist.gov/"),
    fromPoller("osv", "OSV.dev", "https://osv.dev/"),
    fromPoller("kev", "CISA Known Exploited Vulnerabilities", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"),
  ];
  // GitHub App advisory webhook: event-driven, so "active" means configured and seen recently; never claimed otherwise.
  if (!hasGitHubApp()) advisories.push({ id: "ghsa-webhook", name: "GitHub advisory events (instant)", url: "https://github.com/advisories", status: "not_configured", last_ok: null });
  else advisories.push({ id: "ghsa-webhook", name: "GitHub advisory events (instant)", url: "https://github.com/advisories", status: lastWebhook ? (now - Date.parse(lastWebhook) < 7 * 86400e3 ? "active" : "delayed") : "unknown", last_ok: lastWebhook });
  const ai: MonitoredSource[] = [], research: MonitoredSource[] = [];
  for (const f of FEEDS) {
    if (f.demo) continue; // demo-only feeds are not part of monitoring
    const pollerId = f.cadence === "fast" ? "rss" : "rss-slow";
    const s = seen[f.id];
    // Per-feed result when recorded; before that, only that the feed has been read at least once.
    const status: SourceStatus = s?.last_ok !== undefined || s?.last_error ? statusFrom({ last_ok: s?.last_ok ?? null, last_error: s?.last_error ?? null, runs: 1 }, poller(pollerId).interval_min, now) : s?.first_ok ? "unknown" : "unknown";
    const entry = { id: f.id, name: f.name.replace(/ \(demo only\)$/, ""), url: homeOf(f.id, f.url), status, last_ok: s?.last_ok ?? null };
    if (f.kind === "list" || f.kind === "vendor" && /msrc|certcc/.test(f.id)) advisories.push(entry);
    else if (AI_KINDS.has(f.kind) || f.id === "arxiv-ai-sec") ai.push(entry);
    else research.push(entry);
  }
  return [
    { id: "advisories", title: "Security advisories and vulnerability databases", sources: advisories },
    { id: "ai", title: "AI security and AI safety research", sources: ai },
    { id: "research", title: "Security research and news", sources: research },
  ];
}

export const STATUS_LABEL: Record<SourceStatus, string> = { active: "Active", delayed: "Delayed", unavailable: "Unavailable", not_configured: "Not configured", unknown: "Status not recorded yet" };
