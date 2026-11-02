// Monitoring status: is each repository being watched, in plain words. Source coverage, polling intervals,
// latency and the raw pipeline log are kept under "Advanced diagnostics".
import Link from "next/link";
import { SourceCoverage } from "@/app/sources/page";
import { hasGitHubApp } from "@/lib/env";
import { caseHref, discoveredAt, location, plainTitle, repoStatus } from "@/lib/labels";
import { hostedUsedBy, usageSummary } from "@/lib/usage";
import { requireUser, visibleRepoKeys } from "@/lib/session";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Monitoring() {
  const user = await requireUser("/monitoring");
  const [keys, mine, log] = await Promise.all([visibleRepoKeys(user.id), store.listUserRepos(user.id), store.recentLog(80)]);
  const repos = (await store.listRepos()).filter((r) => keys.has(store.repoKey(r)));
  const [usage, mineUsed, recent] = await Promise.all([usageSummary(), hostedUsedBy(user.id), store.listAssessments(400)]);
  // History: threats Argus checked against your code that do not affect you (kept out of the Alerts list).
  const latest = new Map<string, (typeof recent)[number]>();
  for (const a of recent) { if (!keys.has(a.repo)) continue; const k = `${a.finding_id}|${a.repo}`; if (!latest.has(k) || latest.get(k)!.timestamps.processed_at < a.timestamps.processed_at) latest.set(k, a); }
  const cleared = [...latest.values()].filter((a) => a.verdict === "Not Affected").sort((x, y) => discoveredAt(y).localeCompare(discoveredAt(x)));
  const clearedRows = await Promise.all(cleared.slice(0, 30).map(async (a) => { const [f, r] = await Promise.all([store.getFinding(a.finding_id), store.getRepo(a.repo)]); return { a, title: f?.claim?.tech_tags.length || f?.claim?.packages.length ? `Checked: ${plainTitle({ ...a, verdict: "Unclear" }, f, location(a), r?.tech_tags, r?.packages.map((p) => p.name)).replace(/^Possible security issue with /, "security issue with ")}` : f?.title ?? a.finding_id }; }));
  const analyses = usage.assessment.calls, tokens = usage.claim.tokens + usage.assessment.tokens + usage.fix.tokens;
  const lastCheck = log.find((l) => l.kind === "poll" || l.kind === "heartbeat" || l.kind === "webhook")?.at ?? null;
  const errors = recentErrors(log);
  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-10 grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="grid gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Monitoring status</h1>
        <p className="text-[15px] text-ink2">{errors ? "Some checks had problems in the last hour. Monitoring continues and retries automatically." : "Argus Watch is checking new security threats against your repositories."}</p>
      </div>
      <section className="border hair rounded-[10px] bg-raised overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 px-5 py-3 border-b hair text-[13px]"><span className="font-semibold">Your repositories</span><span className="text-ink2">{lastCheck ? `Last check ${ago(lastCheck)}` : "Waiting for first check"}</span></div>
        <ul>
          {repos.length === 0 && <li className="px-5 py-4 text-[14px] text-ink2">No repositories yet. <Link href="/repos">Add one</Link></li>}
          {repos.map((r) => { const k = store.repoKey(r); const ur = mine.find((m) => m.repo_key === k); const s = repoStatus(r, { connected: !ur || !!ur.installation_id || !hasGitHubApp() }); return (
            <li key={k} className="flex items-center justify-between gap-3 px-5 py-3 border-b hair last:border-0 text-[14px]"><span className="font-medium truncate min-w-0">{k}</span><span className={`tone-${s.tone} shrink-0`}><span aria-hidden>{s.glyph}</span> {s.label}</span></li>); })}
        </ul>
      </section>
      <section className="border hair rounded-[10px] bg-raised overflow-hidden">
        <div className="px-5 py-3 border-b hair text-[13px] font-semibold">AI analysis this month</div>
        <dl className="grid sm:grid-cols-3 text-[14px]">
          <div className="px-5 py-4 grid gap-0.5"><dt className="text-[12px] text-ink2">Threats read by Meta Muse Spark</dt><dd className="font-semibold">{usage.claim.calls}</dd></div>
          <div className="px-5 py-4 grid gap-0.5 sm:border-l hair"><dt className="text-[12px] text-ink2">Code checks by Meta Muse Spark</dt><dd className="font-semibold">{analyses}{tokens ? <span className="text-ink2 font-normal text-[12px]"> · {Math.round(tokens / 1000)}k tokens</span> : null}</dd></div>
          <div className="px-5 py-4 grid gap-0.5 sm:border-l hair"><dt className="text-[12px] text-ink2">Your included code checks</dt><dd className="font-semibold">{mineUsed.cap < 0 ? "Unlimited" : `${Math.min(mineUsed.used, mineUsed.cap)} of ${mineUsed.cap} used`}</dd></div>
        </dl>
        <p className="px-5 pb-4 text-[12px] text-ink2">Package version checks never use AI. {mineUsed.cap >= 0 && mineUsed.used >= mineUsed.cap ? "You've used this month's included checks: new alerts still arrive, marked Possible issue, and your connected AI agent can check them." : "When the included checks run out, alerts keep arriving, marked Possible issue, and your connected AI agent can check them."} Monthly totals cover all of Argus.</p>
      </section>

      <details className="disclose">
        <summary>Threats checked that don&apos;t affect you ({cleared.length})</summary>
        {clearedRows.length === 0 ? <p className="mt-3 text-[13px] text-ink2">None yet.</p> : (
          <ul className="mt-3 border hair rounded-[10px] bg-raised">
            {clearedRows.map(({ a, title }) => <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 border-b hair last:border-0 text-[14px] min-w-0"><Link href={caseHref(a.id)} className="truncate min-w-0 no-underline hover:underline">{title}</Link><span className="text-[12px] tone-ok shrink-0">✓ Not affected</span></li>)}
          </ul>
        )}
      </details>

      <details className="disclose">
        <summary>Advanced diagnostics</summary>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-8">
          <SourceCoverage embedded />
          <section>
            <h2 className="text-[13px] font-semibold mb-2">Raw pipeline log</h2>
            <ul className="mono text-[11px] grid gap-1 max-h-[360px] overflow-auto">
              {log.map((l, i) => <li key={i} className="flex gap-2 min-w-0"><span className="text-ink2 shrink-0">{l.at.slice(0, 19).replace("T", " ")}</span><span className="shrink-0 w-[62px]">{l.kind}</span><span className="truncate min-w-0" title={l.detail}>{l.detail}</span></li>)}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}

function recentErrors(log: { kind: string; at: string }[]) { const now = Date.now(); return log.filter((l) => l.kind === "error" && now - Date.parse(l.at) < 3600e3).length; }
function ago(iso: string) { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; }
