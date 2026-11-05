// Monitoring status: is each repository being watched, in plain words. Source coverage, polling intervals,
// latency and the raw pipeline log are kept under "Advanced diagnostics".
import Link from "next/link";
import { SourceCoverage } from "@/app/sources/page";
import { hasGitHubApp } from "@/lib/env";
import { caseHref, discoveredAt, location, plainTitle, repoStatus } from "@/lib/labels";
import { hostedUsedBy, usageSummary } from "@/lib/usage";
import { requireUser, visibleRepoKeys } from "@/lib/session";
import { knownRepoNames, logVisibleTo } from "@/lib/authz";
import { getDict, getLocale } from "@/lib/i18n";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Monitoring() {
  const user = await requireUser("/monitoring");
  const d = await getDict(await getLocale());
  const [keys, mine, rawLog, known] = await Promise.all([visibleRepoKeys(user.id), store.listUserRepos(user.id), store.recentLog(200), knownRepoNames()]);
  // Only entries about this user's repositories, or about no repository (pipeline heartbeats); never other users' (V1).
  const log = rawLog.filter((l) => logVisibleTo(l, keys, known)).slice(0, 80);
  const repos = (await store.listRepos()).filter((r) => keys.has(store.repoKey(r)));
  const [usage, mineUsed, recent] = await Promise.all([usageSummary(), hostedUsedBy(user.id), store.listAssessments(400)]);
  // History: threats SaveBell checked against your code that do not affect you (kept out of the Alerts list).
  const latest = new Map<string, (typeof recent)[number]>();
  for (const a of recent) { if (!keys.has(a.repo)) continue; const k = `${a.finding_id}|${a.repo}`; if (!latest.has(k) || latest.get(k)!.timestamps.processed_at < a.timestamps.processed_at) latest.set(k, a); }
  const cleared = [...latest.values()].filter((a) => a.verdict === "Not Affected").sort((x, y) => discoveredAt(y).localeCompare(discoveredAt(x)));
  const clearedRows = await Promise.all(cleared.slice(0, 30).map(async (a) => { const [f, r] = await Promise.all([store.getFinding(a.finding_id), store.getRepo(a.repo)]); return { a, title: f?.claim?.tech_tags.length || f?.claim?.packages.length ? `Checked: ${plainTitle({ ...a, verdict: "Unclear" }, f, location(a), r?.tech_tags, r?.packages.map((p) => p.name)).replace(/^Possible security issue with /, "security issue with ")}` : f?.title ?? a.finding_id }; }));
  const analyses = usage.assessment.calls, tokens = usage.claim.tokens + usage.assessment.tokens + usage.fix.tokens;
  const lastCheck = log.find((l) => l.kind === "poll" || l.kind === "heartbeat" || l.kind === "webhook")?.at ?? null;
  const errors = recentErrors(log);
  return (
    <div className="mx-auto max-w-[calc(760px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="grid gap-1">
        <h1 className="text-[calc(28px*var(--ui))] font-semibold tracking-[-0.02em]">{d.mon_title}</h1>
        <p className="text-[calc(15px*var(--ui))] text-ink2">{errors ? d.mon_errors : d.mon_ok}</p>
      </div>
      <section className="border hair rounded-[10px] bg-raised overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 px-5 py-3 border-b hair text-[calc(13px*var(--ui))]"><span className="font-semibold">{d.mon_your_repos}</span><span className="text-ink2">{lastCheck ? `${d.mon_last_check} ${ago(lastCheck)}` : d.mon_waiting}</span></div>
        <ul>
          {repos.length === 0 && <li className="px-5 py-4 text-[calc(14px*var(--ui))] text-ink2">{d.mon_no_repos} <Link href="/repos">{d.mon_add_one}</Link></li>}
          {repos.map((r) => { const k = store.repoKey(r); const ur = mine.find((m) => m.repo_key === k); const s = repoStatus(r, { connected: !ur || !!ur.installation_id || !hasGitHubApp() }); return (
            <li key={k} className="flex items-center justify-between gap-3 px-5 py-3 border-b hair last:border-0 text-[calc(14px*var(--ui))]"><span className="font-medium truncate min-w-0">{k}</span><span className={`tone-${s.tone} shrink-0`}><span aria-hidden>{s.glyph}</span> {s.label}</span></li>); })}
        </ul>
      </section>
      <section className="border hair rounded-[10px] bg-raised overflow-hidden">
        <div className="px-5 py-3 border-b hair text-[calc(13px*var(--ui))] font-semibold">{d.mon_ai_month}</div>
        <dl className="grid sm:grid-cols-3 text-[calc(14px*var(--ui))]">
          <div className="px-5 py-4 grid gap-0.5"><dt className="text-[calc(12px*var(--ui))] text-ink2">{d.mon_threats_read}</dt><dd className="font-semibold">{usage.claim.calls}</dd></div>
          <div className="px-5 py-4 grid gap-0.5 sm:border-l hair"><dt className="text-[calc(12px*var(--ui))] text-ink2">{d.mon_code_checks}</dt><dd className="font-semibold">{analyses}{tokens ? <span className="text-ink2 font-normal text-[calc(12px*var(--ui))]"> · {Math.round(tokens / 1000)}k tokens</span> : null}</dd></div>
          <div className="px-5 py-4 grid gap-0.5 sm:border-l hair"><dt className="text-[calc(12px*var(--ui))] text-ink2">{d.mon_included}</dt><dd className="font-semibold">{mineUsed.cap < 0 ? d.mon_unlimited : d.mon_used_of.replace("{n}", String(Math.min(mineUsed.used, mineUsed.cap))).replace("{cap}", String(mineUsed.cap))}</dd></div>
        </dl>
        <p className="px-5 pb-4 text-[calc(12px*var(--ui))] text-ink2">Package version checks never use AI. {mineUsed.cap >= 0 && mineUsed.used >= mineUsed.cap ? "You've used this month's included checks: new alerts still arrive, marked Possible issue, and your connected AI agent can check them." : "When the included checks run out, alerts keep arriving, marked Possible issue, and your connected AI agent can check them."} Monthly totals cover all of SaveBell.</p>
      </section>

      <details className="disclose">
        <summary>{d.mon_cleared} ({cleared.length})</summary>
        {clearedRows.length === 0 ? <p className="mt-3 text-[calc(13px*var(--ui))] text-ink2">{d.mon_none_yet}</p> : (
          <ul className="mt-3 border hair rounded-[10px] bg-raised">
            {clearedRows.map(({ a, title }) => <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 border-b hair last:border-0 text-[calc(14px*var(--ui))] min-w-0"><Link href={caseHref(a.id)} className="truncate min-w-0 no-underline hover:underline">{title}</Link><span className="text-[calc(12px*var(--ui))] tone-ok shrink-0">✓ Not affected</span></li>)}
          </ul>
        )}
      </details>

      <details className="disclose">
        <summary>{d.mon_advanced}</summary>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-8">
          <SourceCoverage embedded />
          <section>
            <h2 className="text-[calc(13px*var(--ui))] font-semibold mb-2">{d.mon_raw_log}</h2>
            <ul className="mono text-[calc(11px*var(--ui))] grid gap-1 max-h-[calc(360px*var(--ui))] overflow-auto">
              {log.map((l, i) => <li key={i} className="flex gap-2 min-w-0"><span className="text-ink2 shrink-0">{l.at.slice(0, 19).replace("T", " ")}</span><span className="shrink-0 w-[calc(62px*var(--ui))]">{l.kind}</span><span className="truncate min-w-0" title={l.detail}>{l.detail}</span></li>)}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}

function recentErrors(log: { kind: string; at: string }[]) { const now = Date.now(); return log.filter((l) => l.kind === "error" && now - Date.parse(l.at) < 3600e3).length; }
function ago(iso: string) { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; }
