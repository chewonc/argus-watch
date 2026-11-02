// Source coverage: class per source (push / near-real-time / periodic / not accessible), measured intervals and
// measured publication→discovery latency per source. Labels come from measurements, never from nominal intervals.
import { computeLatency } from "@/lib/latency";
import { POLLERS, TICK_MIN, type PollState } from "@/lib/poll";
import { FEEDS } from "@/lib/sources/rss";
import { store } from "@/lib/store";
import { fmtTime, human } from "@/components/ui";
import { getDict, getLocale } from "@/lib/i18n";

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const CLASS_LABEL = { push: "● push (event-driven)", near_realtime: "◐ near-real-time (polled every 5 min)", periodic: "○ periodic (polled at the source's own cadence)" } as const;

export default async function Sources() {
  const [states, log, findings, assessments] = await Promise.all([Promise.all(POLLERS.map((p) => store.getPollState<PollState>(p.id))), store.recentLog(500), store.listFindings(), store.listAssessments(200)]);
  const lat = await computeLatency(assessments, findings);
  const d = await getDict(await getLocale());
  const deliveries = log.filter((l) => l.kind === "webhook" && /security_advisory/.test(l.detail));
  const l1 = (id: string) => { const s = lat.L1_source[id]; return s?.n ? `${human(s.median_s)} median (n=${s.n})` : "not yet measured"; };
  const rows = POLLERS.map((p, i) => {
    const st = states[i];
    return { ...p, measured: st?.intervals_ms?.length ? `${(median(st.intervals_ms)! / 60e3).toFixed(1)} min (n=${st.intervals_ms.length})` : "not yet measured", runs: st?.runs ?? 0, lastOk: st?.last_ok ?? null, err: st?.last_error, l1: l1(p.id) };
  });
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8 grid gap-10">
      <div>
        <h1 className="serif text-[36px]">{d.sources_title}</h1>
        <p className="text-ink2">{d.sources_intro.replace("{n}", String(TICK_MIN))}</p>
      </div>
      <section>
        <h2 className="label mb-3">{CLASS_LABEL.push}</h2>
        <div className="border hair rounded-[6px] p-4 text-[13px]">
          <div className="font-medium">GitHub-reviewed global advisories {deliveries.length > 0 && <span className="label ml-2">real-time from GitHub&apos;s publication</span>}</div>
          <div className="text-ink2">GitHub App webhook <span className="mono">security_advisory</span> (published / updated / withdrawn). Delivered by GitHub at publication, not at first disclosure. The real-time label appears only once a live delivery has been measured.</div>
          <div className="mono text-[12px] mt-2">deliveries logged: {deliveries.length} · last: {fmtTime(deliveries[0]?.at ?? null)} · publish→discover {l1("ghsa")}</div>
        </div>
      </section>
      {(["near_realtime", "periodic"] as const).map((cls) => (
        <section key={cls}>
          <h2 className="label mb-3">{CLASS_LABEL[cls]}</h2>
          <div className="grid gap-3">
            {rows.filter((r) => r.cls === cls).map((p) => (
              <div key={p.id} className="border hair rounded-[6px] p-4 text-[13px]">
                <div className="font-medium">{p.name}</div>
                <div className="mono text-[12px] mt-1">nominal {p.interval_min} min · measured {p.measured} · runs {p.runs} · last ok {fmtTime(p.lastOk)} · publish→discover {p.l1}</div>
                {p.err && <div className="text-[12px] mt-1" style={{ color: "var(--contradicted)" }}>degraded: {p.err}</div>}
                {p.id.startsWith("rss") && (
                  <ul className="grid sm:grid-cols-2 gap-1 text-[12px] mt-2">
                    {FEEDS.filter((f) => (p.id === "rss" ? f.cadence === "fast" : f.cadence === "slow")).map((f) => <li key={f.id}><a href={f.url}>{f.name}</a> <span className="label">{f.kind.replace("_", " ")}{f.demo ? " · demo only, low trust" : ""}</span></li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2 className="label mb-3">Pipeline latency (live items, backlog excluded)</h2>
        <ul className="mono text-[12px] grid sm:grid-cols-2 gap-1">
          <li>L2 discovered→extracted: {lat.L2_extract.n ? `${human(lat.L2_extract.median_s)} median, p90 ${human(lat.L2_extract.p90_s)} (n=${lat.L2_extract.n})` : "n/a"}</li>
          <li>L3 extracted→assessed: {lat.L3_assess.n ? `${human(lat.L3_assess.median_s)} median, p90 ${human(lat.L3_assess.p90_s)} (n=${lat.L3_assess.n})` : "n/a"}</li>
          <li>L4 assessed→alert: {lat.L4_alert.n ? `${human(lat.L4_alert.median_s)} median (n=${lat.L4_alert.n})` : "n/a"}</li>
          <li>L5 alert→push sent: {lat.L5_push.n ? `${human(lat.L5_push.median_s)} median (n=${lat.L5_push.n})` : "no push sent yet"}</li>
          <li>L6 push→received: {lat.L6_receipt.n ? `${human(lat.L6_receipt.median_s)} median (n=${lat.L6_receipt.n})` : "no receipt yet"}</li>
          <li>Total publish→alert: {lat.total_publish_to_alert.n ? `${human(lat.total_publish_to_alert.median_s)} median, p90 ${human(lat.total_publish_to_alert.p90_s)} (n=${lat.total_publish_to_alert.n})` : "no live alerts yet"}</li>
        </ul>
      </section>
      <section>
        <h2 className="label mb-3">Lookup / on demand</h2>
        <p className="text-[13px]">OSV.dev enriches findings with aliases and version ranges. The <span className="mono">/api/analyze</span> route runs the same pipeline on demand as a manual override and as a read-only tool for agents.</p>
      </section>
      <section>
        <h2 className="label mb-3">⊘ Not accessible (stated, never silently dropped)</h2>
        <ul className="text-[13px] grid gap-1">
          <li><b>X</b> is pay-per-use only ($0.005 per post read, no free reads); not funded.</li>
          <li><b>Threads</b> keyword search requires App Review for <span className="mono">threads_keyword_search</span>.</li>
          <li><b>LinkedIn</b> has no public post-search API and its terms prohibit scraping.</li>
          <li><b>Reddit</b> ends RSS on Nov 13 2026 and closes its public API in March 2027.</li>
          <li><b>Google Custom Search</b> is closed to new customers and ends Jan 1 2027. Google News RSS is used as a demo-only, low-trust feed because its terms allow personal, non-commercial use only.</li>
        </ul>
        <p className="text-[12px] text-ink2 mt-2">Pages from these platforms can still appear indirectly when a monitored feed links to them.</p>
      </section>
    </div>
  );
}
