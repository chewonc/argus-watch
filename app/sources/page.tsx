// Source coverage: class per source, measured intervals, feed list, inaccessible sources with reasons.
import { FEEDS } from "@/lib/sources/rss";
import { store } from "@/lib/store";
import { fmtTime } from "@/components/ui";

type PollState = { last_run: string; last_ok: string | null; runs: number; errors: number; last_error: string | null; intervals_ms: number[] };
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export default async function Sources() {
  const [kev, rss, log] = await Promise.all([store.getPollState<PollState>("kev"), store.getPollState<PollState>("rss"), store.recentLog(500)]);
  const deliveries = log.filter((l) => l.kind === "webhook" && /security_advisory/.test(l.detail));
  const row = (name: string, st: PollState | null, nominal: number) => ({
    name, cls: "polled", nominal, measured: st?.intervals_ms?.length ? `${(median(st.intervals_ms)! / 60e3).toFixed(1)} min (n=${st.intervals_ms.length})` : "not yet measured",
    runs: st?.runs ?? 0, lastOk: st?.last_ok ?? null, err: st?.last_error,
  });
  const polled = [row("CISA Known Exploited Vulnerabilities", kev, 30), row(`Early-signal feeds (${FEEDS.length})`, rss, 10)];
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8 grid gap-10">
      <div>
        <h1 className="serif text-[36px]">Sources and coverage</h1>
        <p className="text-ink2">Each source is labeled by how it is actually monitored. Intervals shown are measured from logged runs, not assumed.</p>
      </div>
      <section>
        <h2 className="label mb-3">● Push (event-driven)</h2>
        <div className="border hair rounded-[6px] p-4 text-[13px]">
          <div className="font-medium">GitHub-reviewed global advisories</div>
          <div className="text-ink2">GitHub App webhook <span className="mono">security_advisory</span> (published / updated / withdrawn). Real-time from GitHub's publication, not from first disclosure.</div>
          <div className="mono text-[12px] mt-2">deliveries logged: {deliveries.length} · last: {fmtTime(deliveries[0]?.at ?? null)}</div>
        </div>
      </section>
      <section>
        <h2 className="label mb-3">◐ Polled</h2>
        <div className="grid gap-3">
          {polled.map((p) => (
            <div key={p.name} className="border hair rounded-[6px] p-4 text-[13px]">
              <div className="font-medium">{p.name}</div>
              <div className="mono text-[12px] mt-1">nominal {p.nominal} min · measured {p.measured} · runs {p.runs} · last ok {fmtTime(p.lastOk)}</div>
              {p.err && <div className="text-[12px] mt-1" style={{ color: "var(--contradicted)" }}>degraded: {p.err}</div>}
            </div>
          ))}
          <ul className="grid sm:grid-cols-2 gap-1 text-[13px] mt-2">
            {FEEDS.map((f) => <li key={f.id}><a href={f.url}>{f.name}</a> <span className="label">{f.kind.replace("_", " ")}</span></li>)}
          </ul>
        </div>
      </section>
      <section>
        <h2 className="label mb-3">○ Lookup / on demand</h2>
        <p className="text-[13px]">OSV.dev enriches findings with aliases and version ranges. The <span className="mono">/api/analyze</span> route runs the same pipeline on demand as a manual override and as a read-only tool for agents.</p>
      </section>
      <section>
        <h2 className="label mb-3">⊘ Not accessible (stated, never silently dropped)</h2>
        <ul className="text-[13px] grid gap-1">
          <li><b>Threads</b> keyword search requires an app-review permission.</li>
          <li><b>LinkedIn</b> has no public post-search API and its terms prohibit scraping.</li>
          <li><b>X</b> is pay-per-use only; not funded in this MVP.</li>
          <li><b>Google Custom Search</b> is closed to new customers.</li>
          <li><b>Reddit</b> terms were not verified.</li>
        </ul>
        <p className="text-[12px] text-ink2 mt-2">Pages from these platforms can still appear indirectly when a monitored feed links to them.</p>
      </section>
    </div>
  );
}
