// Public read-only status: source coverage classes with measured intervals, per-stage latency, counts, recent log.
import { computeLatency } from "@/lib/latency";
import { POLLERS, TICK_MIN, type PollState, type TickState } from "@/lib/poll";
import { FEEDS } from "@/lib/sources/rss";
import { hasQStash, hasRedis } from "@/lib/env";
import { store, storageMode } from "@/lib/store";

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export async function GET() {
  const [states, log, findings, assessments, repos, tickState, notifications] = await Promise.all([
    Promise.all(POLLERS.map((p) => store.getPollState<PollState>(p.id))), store.recentLog(2000), store.listFindings(), store.listAssessments(200), store.listRepos(), store.getPollState<TickState>("tick"), store.listAllNotifications().catch(() => []),
  ]);
  const webhookLogs = log.filter((l) => l.kind === "webhook" && /security_advisory/.test(l.detail));
  const webhookCount = webhookLogs.length;
  const lastWebhook = webhookLogs[0]?.at ?? null;
  const firstWebhook = webhookLogs[webhookLogs.length - 1]?.at ?? null;
  const lastHeartbeat = log.find((l) => l.kind === "heartbeat")?.at ?? null;
  const lastLegacy = log.find((l) => l.kind === "poll" && (l.source === "rss" || l.source === "kev") && /also_ran|legacy/.test(l.detail))?.at ?? null;
  const pollRows = POLLERS.map((p, i) => {
    const st = states[i];
    const measured = st?.intervals_ms?.length ? Math.round((median(st.intervals_ms)! / 60e3) * 10) / 10 : null;
    return { id: p.id, name: p.name, class: p.cls, nominal_interval_min: p.interval_min, measured_interval_min: measured, runs: st?.runs ?? 0, first_ok: st?.first_ok ?? null, last_ok: st?.last_ok ?? null, last_error: st?.last_error ?? null,
      status: !st ? "never ran" : st.last_error ? "degraded" : "ok", ...(p.id.startsWith("rss") ? { feeds: FEEDS.filter((f) => (p.id === "rss" ? f.cadence === "fast" : f.cadence === "slow")).map((f) => ({ id: f.id, name: f.name, kind: f.kind, demo: !!f.demo })) } : {}) };
  });
  const sources = [
    { id: "ghsa", name: "GitHub-reviewed advisories (GitHub App webhook)", class: "push", deliveries: webhookCount, last_delivery: lastWebhook, status: webhookCount ? "receiving" : "no deliveries yet", realtime_label_allowed: webhookCount > 0 },
    ...pollRows,
    { id: "osv", name: "OSV.dev", class: "lookup", status: "enrichment only" },
    { id: "x", name: "X (Twitter)", class: "not_accessible", reason: "pay-per-use API ($0.005/post read, no free reads); not funded" },
    { id: "threads", name: "Threads keyword search", class: "not_accessible", reason: "requires App Review for threads_keyword_search" },
    { id: "linkedin", name: "LinkedIn", class: "not_accessible", reason: "no post-search API; scraping prohibited by terms" },
    { id: "google", name: "Google Custom Search", class: "not_accessible", reason: "closed to new customers; ends Jan 1 2027" },
    { id: "reddit", name: "Reddit", class: "not_accessible", reason: "RSS ends Nov 13 2026; public API closes Mar 2027" },
  ];
  const latency = await computeLatency(assessments, findings, notifications.map((n) => ({ notified_at: n.notified_at, pushed_at: n.pushed_at, received_at: n.received_at, published_at: n.published_at })), firstWebhook);
  // AT-3: expected vs observed tick runs over the last 24 h (from poll logs)
  const dayAgo = Date.now() - 86400e3;
  const tickRuns = log.filter((l) => l.kind === "poll" && Date.parse(l.at) > dayAgo && (l.source === "rss" || l.source === "ghadv")).length;
  const live = assessments.filter((a) => !a.replayed);
  return Response.json({
    infra: { storage: storageMode, queue: hasQStash() ? "upstash-qstash" : "inline (dev)", durable: hasRedis(), scheduler: {
      tick_interval_min: TICK_MIN, last_tick: tickState?.last_run ?? null, last_tick_ran: tickState?.ran ?? [],
      // The QStash schedule for /api/poll/tick is confirmed only by a delivery carrying upstash-schedule-id.
      tick_schedule_detected: (tickState?.scheduled_runs ?? 0) > 0, tick_scheduled_runs: tickState?.scheduled_runs ?? 0, last_scheduled_tick: tickState?.last_scheduled ?? null,
      last_heartbeat: lastHeartbeat, last_legacy_schedule_tick: lastLegacy,
      note: "If tick_schedule_detected is false, the /api/poll/tick schedule has never delivered; legacy per-source schedules (rss, kev) also run every other due poller as a fallback.",
    } },
    sources,
    counts: { findings: findings.length, by_status: Object.fromEntries(["new", "not_relevant", "not_actionable", "analyzing", "assessed", "error"].map((s) => [s, findings.filter((f) => f.status === s).length])), assessments: assessments.length, live_assessments: live.length, replayed_assessments: assessments.length - live.length, watched_repos: repos.length },
    latency,
    unattended_24h: { near_realtime_poll_runs_logged: tickRuns, expected_at_5_min: Math.round(2 * 1440 / TICK_MIN), note: "AT-3: counts rss+ghadv poll runs in the last 24 h of the log (log holds the latest 2000 entries)" },
    log: log.slice(0, 100),
  });
}
