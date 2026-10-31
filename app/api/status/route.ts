// Public read-only status: source coverage classes with measured intervals, recent log, counts.
import { FEEDS } from "@/lib/sources/rss";
import { hasQStash, hasRedis } from "@/lib/env";
import { store, storageMode } from "@/lib/store";


type PollState = { last_run: string; last_ok: string | null; runs: number; errors: number; last_error: string | null; intervals_ms: number[] };
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export async function GET() {
  const [kev, rss, log, findings, assessments, repos] = await Promise.all([
    store.getPollState<PollState>("kev"), store.getPollState<PollState>("rss"), store.recentLog(300), store.listFindings(), store.listAssessments(200), store.listRepos(),
  ]);
  const webhookCount = log.filter((l) => l.kind === "webhook" && /security_advisory/.test(l.detail)).length;
  const lastWebhook = log.find((l) => l.kind === "webhook" && /security_advisory/.test(l.detail))?.at ?? null;
  const pollRow = (id: string, name: string, nominalMin: number, st: PollState | null) => ({
    id, name, class: "polled", nominal_interval_min: nominalMin,
    measured_interval_min: st?.intervals_ms?.length ? Math.round((median(st.intervals_ms)! / 60e3) * 10) / 10 : null,
    runs: st?.runs ?? 0, last_ok: st?.last_ok ?? null, last_error: st?.last_error ?? null, status: !st ? "never ran" : st.last_error ? "degraded" : "ok",
  });
  const sources = [
    { id: "ghsa", name: "GitHub-reviewed advisories (GitHub App webhook)", class: "push", deliveries: webhookCount, last_delivery: lastWebhook, status: webhookCount ? "receiving" : "no deliveries yet" },
    pollRow("kev", "CISA Known Exploited Vulnerabilities", 30, kev),
    { ...pollRow("rss", `Early-signal feeds (${FEEDS.length})`, 10, rss), feeds: FEEDS.map((f) => ({ id: f.id, name: f.name, kind: f.kind })) },
    { id: "osv", name: "OSV.dev", class: "lookup", status: "enrichment only" },
    { id: "x", name: "X (Twitter)", class: "not_accessible", reason: "pay-per-use API; not funded in the MVP" },
    { id: "threads", name: "Threads keyword search", class: "not_accessible", reason: "requires app-review permission" },
    { id: "linkedin", name: "LinkedIn", class: "not_accessible", reason: "no post-search API; scraping prohibited by terms" },
    { id: "google", name: "Google Custom Search", class: "not_accessible", reason: "closed to new customers" },
    { id: "reddit", name: "Reddit", class: "not_accessible", reason: "terms not verified" },
  ];
  // latency per class over live (non-replayed) assessments
  const live = assessments.filter((a) => !a.replayed && a.timestamps.published_at);
  const lat = live.map((a) => (Date.parse(a.timestamps.notified_at ?? a.timestamps.processed_at) - Date.parse(a.timestamps.published_at!)) / 1000);
  return Response.json({
    infra: { storage: storageMode, queue: hasQStash() ? "upstash-qstash" : "inline (dev)", durable: hasRedis() },
    sources,
    counts: { findings: findings.length, by_status: Object.fromEntries(["new", "not_relevant", "not_actionable", "analyzing", "assessed", "error"].map((s) => [s, findings.filter((f) => f.status === s).length])), assessments: assessments.length, live_assessments: live.length, replayed_assessments: assessments.filter((a) => a.replayed).length, watched_repos: repos.length },
    latency_s: { n: lat.length, median: median(lat), max: lat.length ? Math.max(...lat) : null, note: "notified_at (or processed_at) minus source published_at, live assessments only" },
    log: log.slice(0, 100),
  });
}
