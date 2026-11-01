// Per-stage latency, measured from stored timestamps. Live items only (never replays), and never the
// first-run backlog: an item published before its source's first successful poll is excluded from L1.
//   L1 source   published_at  -> discovered_at  (per source id)
//   L2 extract  discovered_at -> extracted_at
//   L3 assess   extracted_at  -> processed_at   (per repo)
//   L4 alert    processed_at  -> notified_at    (in-app record)
//   L5 push     notified_at   -> pushed_at      (Web Push sent)      [from notifications]
//   L6 receipt  pushed_at     -> received_at    (service-worker ack) [from notifications]
import type { Assessment, Finding, Item } from "./schema";
import type { PollState } from "./poll";
import { store } from "./store";

export type Stat = { n: number; median_s: number | null; p90_s: number | null; max_s: number | null };
export const stat = (xs: number[]): Stat => {
  if (!xs.length) return { n: 0, median_s: null, p90_s: null, max_s: null };
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, median_s: Math.round(s[Math.floor(s.length / 2)]), p90_s: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]), max_s: Math.round(s[s.length - 1]) };
};
const d = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 1000) : null);

export type Latency = {
  L1_source: Record<string, Stat & { class: string }>;
  L2_extract: Stat; L3_assess: Stat; L4_alert: Stat; L5_push: Stat; L6_receipt: Stat;
  total_publish_to_alert: Stat; total_publish_to_receipt: Stat;
  note: string;
};

/** `firstOk` = per-source first successful poll time; items published before it are backlog. */
export async function computeLatency(assessments: Assessment[], findings: Finding[], notifications: { notified_at: string; pushed_at?: string | null; received_at?: string | null; published_at?: string | null }[] = []): Promise<Latency> {
  const ids = ["ghadv", "rss", "rss-slow", "kev"];
  const states = await Promise.all(ids.map((id) => store.getPollState<PollState>(id)));
  const firstOk: Record<string, string | null> = { ghsa: null };
  ids.forEach((id, i) => (firstOk[id] = states[i]?.first_ok ?? null));
  const liveFindings = findings.filter((f) => f.status !== "error");
  const items = (await Promise.all(liveFindings.flatMap((f) => f.items).map((i) => store.getItem(i)))).filter((x): x is Item => !!x);
  const L1: Record<string, number[]> = {};
  for (const it of items) {
    if (!it.published_at || it.id.length !== 24) continue;
    const key = it.source === "rss" ? ((it.raw as { cadence?: string } | undefined)?.cadence === "slow" ? "rss-slow" : "rss") : it.source;
    if (key === "manual") continue;
    const fo = key === "ghsa" ? null : firstOk[key];
    if (fo && it.published_at < fo) continue; // backlog
    if (fo === null && key !== "ghsa") continue; // source never polled successfully
    const x = d(it.published_at, it.discovered_at); if (x != null) (L1[key] ??= []).push(x);
  }
  const cls: Record<string, string> = { ghsa: "push", ghadv: "near_realtime", rss: "near_realtime", kev: "periodic", "rss-slow": "periodic" };
  const live = assessments.filter((a) => !a.replayed);
  const byF = new Map(findings.map((f) => [f.id, f]));
  const L2 = liveFindings.map((f) => d(f.discovered_at, f.extracted_at)).filter((x): x is number => x != null);
  const L3 = live.map((a) => d(byF.get(a.finding_id)?.extracted_at, a.timestamps.processed_at)).filter((x): x is number => x != null);
  const L4 = live.map((a) => d(a.timestamps.processed_at, a.timestamps.notified_at)).filter((x): x is number => x != null);
  const L5 = notifications.map((n) => d(n.notified_at, n.pushed_at)).filter((x): x is number => x != null);
  const L6 = notifications.map((n) => d(n.pushed_at, n.received_at)).filter((x): x is number => x != null);
  const backlogFree = (a: Assessment) => { const f = byF.get(a.finding_id); const src = f?.sources[0]; const fo = src ? firstOk[src] : null; return a.timestamps.published_at && (!fo || a.timestamps.published_at >= fo) && (src === "ghsa" || fo); };
  const totA = live.filter(backlogFree).map((a) => d(a.timestamps.published_at, a.timestamps.notified_at ?? a.timestamps.processed_at)).filter((x): x is number => x != null);
  const totR = notifications.map((n) => d(n.published_at, n.received_at)).filter((x): x is number => x != null);
  return {
    L1_source: Object.fromEntries(Object.entries(L1).map(([k, v]) => [k, { ...stat(v), class: cls[k] ?? "polled" }])),
    L2_extract: stat(L2), L3_assess: stat(L3), L4_alert: stat(L4), L5_push: stat(L5), L6_receipt: stat(L6),
    total_publish_to_alert: stat(totA), total_publish_to_receipt: stat(totR),
    note: "live items only; replays excluded; items published before a source's first successful poll (backlog) excluded",
  };
}
