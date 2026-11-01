// Watch inbox: the primary screen. Alerts newest first with the event-to-alert timeline; live log; coverage summary.
import Link from "next/link";
import { Band, Timeline, fmtTime, human, secs } from "@/components/ui";
import { store, storageMode } from "@/lib/store";
import { FEEDS } from "@/lib/sources/rss";

export default async function Watch() {
  const [assessments, findings, log, repos] = await Promise.all([store.listAssessments(100), store.listFindings(), store.recentLog(60), store.listRepos()]);
  const alerts = assessments.filter((a) => a.verdict !== "Not Affected");
  const quiet = assessments.filter((a) => a.verdict === "Not Affected");
  const live = assessments.filter((a) => !a.replayed);
  const lat = live.map((a) => secs(a.timestamps.published_at, a.timestamps.notified_at ?? a.timestamps.processed_at)).filter((x): x is number => x != null).sort((a, b) => a - b);
  const notRelevant = findings.filter((f) => f.status === "not_relevant").length;
  const lastDelivery = log.find((l) => l.kind === "webhook" && /security_advisory/.test(l.detail))?.at ?? null;

  return (
    <div className="mx-auto max-w-[1480px] px-6 py-8 grid gap-10 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="serif text-[40px] leading-tight">What touched your code.</h1>
        <p className="text-ink2 mt-1">Advisories and research signals checked against {repos.length} watched {repos.length === 1 ? "repository" : "repositories"}, continuously, read-only.</p>

        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4 mono text-[12px]">
          <Stat k="alerts" v={String(alerts.length)} />
          <Stat k="checked, not relevant" v={String(notRelevant)} />
          <Stat k="live assessments" v={String(live.length)} />
          <Stat k="median publish→alert" v={lat.length ? human(lat[Math.floor(lat.length / 2)]) : "n/a"} note={lat.length ? `n=${lat.length}` : "no live assessments yet"} />
        </div>

        <h2 className="label mt-10 mb-3">Alerts</h2>
        {alerts.length === 0 && <p className="text-ink2">No alerts yet. Alerts appear here automatically when a discovered finding matches a watched repository.</p>}
        <ul className="grid gap-4">
          {alerts.map((a) => (
            <li key={a.id} className="fade border hair rounded-[6px] bg-raised p-4">
              <Band a={a} compact />
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <Link href={`/case/${a.id.split("/").map(encodeURIComponent).join("/")}`} className="text-[15px] font-medium">{a.repo}</Link>
                  <span className="mono text-[12px] text-ink2 ml-2">@{a.sha.slice(0, 7)}</span>
                </div>
                <div className="mono text-[12px] text-ink2">{a.conditions.filter((c) => c.state === "Observed").length} observed · {a.conditions.filter((c) => c.state === "Unknown").length} unknown</div>
              </div>
              <div className="mt-3"><Timeline a={a} /></div>
            </li>
          ))}
        </ul>

        {quiet.length > 0 && (
          <details className="mt-6">
            <summary className="label cursor-pointer">Not affected ({quiet.length})</summary>
            <ul className="mt-3 grid gap-2">
              {quiet.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 text-[13px] border-b hair py-2">
                  <Link href={`/case/${a.id.split("/").map(encodeURIComponent).join("/")}`}>{a.repo}</Link>
                  <span className="mono text-ink2">{a.verdict_reason.slice(0, 60)}{a.replayed ? " · replayed" : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <aside className="grid gap-8 content-start">
        <div>
          <h2 className="label mb-3">Coverage</h2>
          <ul className="text-[13px] grid gap-2">
            <Row glyph="●" name="GitHub-reviewed advisories" cls="push" note={lastDelivery ? `last delivery ${fmtTime(lastDelivery)}` : "no deliveries yet"} />
            <Row glyph="◐" name="GitHub Advisory Database (REST)" cls="near-real-time · polled every 5 min" />
            <Row glyph="◐" name={`${FEEDS.filter((f) => f.cadence === "fast").length} fast disclosure feeds`} cls="near-real-time · polled every 5 min" />
            <Row glyph="○" name={`CISA KEV · ${FEEDS.filter((f) => f.cadence === "slow").length} research feeds`} cls="periodic · 10 min / hourly" />
            <Row glyph="⊘" name="Threads, LinkedIn, X" cls="not accessible / not funded" />
          </ul>
          <Link href="/sources" className="text-[12px] mt-2 inline-block">Measured intervals and feed list →</Link>
          <p className="mono text-[11px] text-ink2 mt-2">storage: {storageMode}</p>
        </div>
        <div>
          <h2 className="label mb-3">Watched</h2>
          <ul className="text-[13px] grid gap-1">
            {repos.map((r) => <li key={r.repo + r.subdir} className="flex justify-between gap-2"><span className="truncate">{r.subdir ? `${r.repo}/${r.subdir}` : r.repo}</span><span className="mono text-ink2 shrink-0">{r.packages.length} pkgs</span></li>)}
            {repos.length === 0 && <li className="text-ink2">None. Register with the admin API (see SETUP.md).</li>}
          </ul>
        </div>
        <div>
          <h2 className="label mb-3">Live log</h2>
          <ul className="mono text-[11px] grid gap-1 max-h-[480px] overflow-auto">
            {log.map((l, i) => <li key={i} className="flex gap-2"><span className="text-ink2 shrink-0">{l.at.slice(11, 19)}</span><span className="shrink-0 w-[62px]">{l.kind}</span><span className="truncate" title={l.detail}>{l.detail}</span></li>)}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Stat({ k, v, note }: { k: string; v: string; note?: string }) {
  return <div className="border hair rounded-[6px] p-3"><div className="label">{k}</div><div className="text-[22px] text-ink font-sans">{v}</div>{note && <div className="text-ink2">{note}</div>}</div>;
}
function Row({ glyph, name, cls, note }: { glyph: string; name: string; cls: string; note?: string }) {
  return <li className="flex gap-2"><span aria-hidden className="w-4">{glyph}</span><span className="flex-1">{name}<span className="block mono text-[11px] text-ink2">{cls}{note ? ` · ${note}` : ""}</span></span></li>;
}
