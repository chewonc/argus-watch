// Source coverage, grouped for scanning: how each source is collected, how often (nominal and measured), when it last
// worked, and the measured publication→discovery latency. Labels come from measurements, never from nominal intervals.
import { computeLatency } from "@/lib/latency";
import { POLLERS, TICK_MIN, type PollState } from "@/lib/poll";
import { FEEDS, type Feed } from "@/lib/sources/rss";
import { communityFeeds, listSuggestions } from "@/lib/source-suggest";
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";
import { fmtTime, human } from "@/components/ui";
import { SuggestSource } from "@/components/suggest-source";
import { getDict, getLocale } from "@/lib/i18n";

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const CLASS_LABEL = { push: "Pushed to SaveBell (event-driven)", near_realtime: "Checked every 5 minutes", periodic: "Checked on the source's own schedule" } as const;
const KIND: Record<Feed["kind"], string> = { list: "mailing list", release: "releases", research: "research", ai_security: "AI security", academic: "academic", aggregator: "aggregator", vendor: "vendor", incidents: "incidents", social: "social", news: "news" };
const STATUS_WORD = { registered: "added to monitoring", needs_review: "waiting for review", rejected: "not added", duplicate: "already covered" } as const;

const Bullets = ({ children }: { children: React.ReactNode }) => <ul className="list-disc pl-5 grid gap-1 marker:text-ink2">{children}</ul>;
const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="grid gap-3"><h2 className="text-[calc(15px*var(--ui))] font-semibold">{title}</h2>{children}</section>
);

/** Source coverage body. `embedded` drops the page container and title (used inside Monitoring status → Advanced diagnostics). */
export async function SourceCoverage({ embedded = false }: { embedded?: boolean }) {
  const [states, log, findings, assessments, community, user] = await Promise.all([Promise.all(POLLERS.map((p) => store.getPollState<PollState>(p.id))), store.recentLog(500), store.listFindings(), store.listAssessments(200), communityFeeds().catch(() => []), currentUser().catch(() => null)]);
  const mine = user && !embedded ? await listSuggestions(user.id, 10).catch(() => []) : [];
  const lat = await computeLatency(assessments, findings);
  const d = await getDict(await getLocale());
  const deliveries = log.filter((l) => l.kind === "webhook" && /security_advisory/.test(l.detail));
  const l1 = (id: string) => { const s = lat.L1_source[id]; return s?.n ? `${human(s.median_s)} median (${s.n} items)` : "not measured yet"; };
  const rows = POLLERS.map((p, i) => {
    const st = states[i];
    return { ...p, measured: st?.intervals_ms?.length ? `${(median(st.intervals_ms)! / 60e3).toFixed(1)} min` : "not measured yet", runs: st?.runs ?? 0, lastOk: st?.last_ok ?? null, err: st?.last_error, l1: l1(p.id) };
  });
  const feedsFor = (id: string) => [...FEEDS.filter((f) => (id === "rss" ? f.cadence === "fast" : f.cadence === "slow")), ...(id === "rss-slow" ? community : [])];
  const t = "text-[calc(13px*var(--ui))]";
  return (
    <div className={`${embedded ? "grid gap-8" : "mx-auto max-w-[calc(860px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid gap-10"} min-w-0 [overflow-wrap:anywhere] ${t}`}>
      {!embedded && (
        <div className="grid gap-3">
          <h1 className="text-[calc(28px*var(--ui))] font-semibold tracking-[-0.02em]">{d.sources_title}</h1>
          <Bullets>
            <li>SaveBell checks these sources on a schedule (every {TICK_MIN} to 60 minutes); GitHub advisories are also pushed to it.</li>
            <li>Intervals and delays below are measured, not promised.</li>
            <li>Sources that can&apos;t be collected are listed at the end with the reason.</li>
          </Bullets>
          <SuggestSource signedIn={!!user} />
        </div>
      )}

      <Group title={CLASS_LABEL.push}>
        <div className="border hair rounded-[8px] p-4 grid gap-2">
          <div className="font-medium">GitHub-reviewed security advisories</div>
          <Bullets>
            <li>Delivered by the GitHub App webhook when GitHub publishes, updates or withdraws an advisory.</li>
            <li>Deliveries logged: {deliveries.length}; last: {fmtTime(deliveries[0]?.at ?? null)}.</li>
            <li>Publication to discovery: {l1("ghsa")}.</li>
          </Bullets>
        </div>
      </Group>

      {(["near_realtime", "periodic"] as const).map((cls) => (
        <Group key={cls} title={CLASS_LABEL[cls]}>
          <div className="grid gap-3">
            {rows.filter((r) => r.cls === cls).map((p) => (
              <div key={p.id} className="border hair rounded-[8px] p-4 grid gap-2">
                <div className="font-medium">{p.name}</div>
                <Bullets>
                  <li>Every {p.interval_min} min planned; {p.measured} measured.</li>
                  <li>Last successful check: {fmtTime(p.lastOk)} ({p.runs} runs).</li>
                  <li>Publication to discovery: {p.l1}.</li>
                  {p.err && <li className="tone-bad">Problem: {p.err}</li>}
                </Bullets>
                {p.id.startsWith("rss") && (
                  <details className="disclose">
                    <summary>Feeds in this group ({feedsFor(p.id).length})</summary>
                    <ul className="list-disc pl-5 grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 marker:text-ink2">
                      {feedsFor(p.id).map((f) => <li key={f.id}><a href={f.url}>{f.name}</a> <span className="text-ink2">· {KIND[f.kind]}{f.demo ? " · demo only, low trust" : ""}{f.community ? " · suggested by a user" : ""}</span></li>)}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Group>
      ))}

      <Group title="Checks on every report">
        <Bullets>
          <li>OSV.dev is queried hourly with the exact package versions in your lockfiles.</li>
          <li>Each report that could affect a watched repository is fact-checked once against NVD, OSV, the GitHub Advisory Database and arXiv.</li>
          <li>Meta Muse Spark web search looks for primary sources and contradictions.</li>
        </Bullets>
      </Group>

      <Group title="Pipeline speed (live items only)">
        <Bullets>
          <li>Discovered to analysed: {lat.L2_extract.n ? `${human(lat.L2_extract.median_s)} median` : "not measured yet"}.</li>
          <li>Analysed to checked against your code: {lat.L3_assess.n ? `${human(lat.L3_assess.median_s)} median` : "not measured yet"}.</li>
          <li>Checked to alert: {lat.L4_alert.n ? `${human(lat.L4_alert.median_s)} median` : "not measured yet"}.</li>
          <li>Alert to browser notification: {lat.L5_push.n ? `${human(lat.L5_push.median_s)} median` : "no push sent yet"}.</li>
          <li>Publication to alert, end to end: {lat.total_publish_to_alert.n ? `${human(lat.total_publish_to_alert.median_s)} median (${lat.total_publish_to_alert.n} alerts)` : "no live alerts yet"}.</li>
        </Bullets>
      </Group>

      <Group title="Not collected">
        <Bullets>
          <li><b>X</b>: pay-per-use API only ($0.005 per post read); not funded.</li>
          <li><b>Threads</b>: keyword search needs Meta App Review.</li>
          <li><b>LinkedIn</b>: no public post-search API; terms prohibit scraping.</li>
          <li><b>Reddit</b>: RSS ends Nov 13 2026; the public API closes March 2027.</li>
          <li><b>Google Custom Search</b>: closed to new customers. Google News RSS is used as a demo-only, low-trust feed (personal, non-commercial terms).</li>
        </Bullets>
        <p className="text-ink2">Pages from these platforms can still appear when a monitored feed links to them.</p>
      </Group>

      {mine.length > 0 && (
        <Group title="Your suggestions">
          <Bullets>{mine.map((s) => <li key={s.id}><b>{s.name}</b> <span className="text-ink2">· {STATUS_WORD[s.status]}: {s.reason}</span></li>)}</Bullets>
        </Group>
      )}
    </div>
  );
}

export default function Sources() {
  return <SourceCoverage />;
}
