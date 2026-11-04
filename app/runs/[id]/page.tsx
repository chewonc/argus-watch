// One remediation-window run: live progress while active, the morning report when finished. Owner only.
// Every finding links to its case page (where validated patches are reviewed and approved); nothing is approved here.
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunControls } from "@/components/run-controls";
import { RUN_STATUS } from "@/components/remediation-windows";
import { caseHref } from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";
import type { ItemStage, WindowRun } from "@/lib/window-run";
import { fmtLocal, LEVEL_TEXT } from "@/lib/window-schedule";

export const dynamic = "force-dynamic";

const STAGE: Record<ItemStage, { label: string; tone: string }> = {
  verifying: { label: "Checking", tone: "muted" }, confirmed: { label: "Confirmed", tone: "warn" }, not_affected: { label: "Not affected", tone: "ok" },
  unclear: { label: "Needs your review", tone: "warn" }, drafted: { label: "Patch drafted, not tested", tone: "warn" }, running: { label: "Testing fix", tone: "muted" },
  validated: { label: "Fix ready to review", tone: "ok" }, pr_created: { label: "Draft PR opened", tone: "ok" }, tests_failed: { label: "Tests failed", tone: "sev-critical" }, failed: { label: "Failed", tone: "sev-critical" },
  cancelled: { label: "Cancelled", tone: "muted" }, timed_out: { label: "Timed out", tone: "sev-critical" },
};

function Stat({ n, label }: { n: number | string; label: string }) {
  return <div className="grid gap-0.5 border hair rounded-[8px] px-3 py-2"><span className="text-[calc(20px*var(--ui))] font-semibold">{n}</span><span className="text-[calc(12px*var(--ui))] text-ink2">{label}</span></div>;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/settings#windows");
  const run = await store.getRun<WindowRun>(decodeURIComponent((await params).id));
  if (!run || run.user_id !== user.id) notFound();
  const fixes = new Map((await Promise.all(run.items.filter((i) => i.fix_id).map((i) => store.getFix(i.fix_id!)))).filter((f) => !!f).map((f) => [f!.id, f!]));
  const r = run.report;
  const active = !r;
  const dur = (ms: number) => `${Math.floor(ms / 36e5)}h ${Math.round((ms % 36e5) / 60e3)}m`;
  return (
    <div className="mx-auto max-w-[calc(980px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid gap-6">
      <header className="grid gap-2">
        <Link href="/settings#windows" className="text-[calc(13px*var(--ui))] text-ink2 underline w-fit">Remediation windows</Link>
        <h1 className="text-[calc(26px*var(--ui))] font-semibold tracking-[-0.02em]">{run.label}</h1>
        <p className="text-[calc(14px*var(--ui))] text-ink2">{RUN_STATUS[run.status] ?? run.status} · {fmtLocal(run.tz, run.start_ms)} to {fmtLocal(run.tz, run.end_ms)} · {LEVEL_TEXT[run.level].title}</p>
        <p className="text-[calc(13px*var(--ui))] text-ink2">Limits: {run.limits.max_issues} issues, {run.limits.max_jobs} parallel job(s), ${run.limits.budget_usd.toFixed(2)} budget. Estimated spend so far ${run.spent_usd.toFixed(2)}. Repositories: {run.repos.length ? run.repos.join(", ") : "none in scope"}.</p>
        {run.stop_reason && <p className="text-[calc(13px*var(--ui))] tone-warn">Stopped starting new work: {run.stop_reason}.</p>}
        <RunControls id={run.id} status={run.status} />
      </header>

      {r && (
        <section className="grid gap-3" aria-labelledby="report">
          <h2 id="report" className="text-[calc(17px*var(--ui))] font-semibold">Morning report</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat n={r.investigated} label="Investigated" /><Stat n={r.confirmed} label="Confirmed" /><Stat n={r.fixes_generated} label="Fixes generated" /><Stat n={r.validated} label="Fixes ready to review" />
            <Stat n={r.tests_failed} label="Tests failed" /><Stat n={r.needs_review} label="Need your review" /><Stat n={r.prs_created} label="Draft PRs created" /><Stat n={`$${r.spent_usd.toFixed(2)}`} label={`Estimated cost · ${dur(r.duration_ms)}`} />
          </div>
          <p className="text-[calc(13px*var(--ui))] text-ink2">Costs are estimates per operation. Validated fixes passed the repository&apos;s tests (or static checks where no tests exist) in an isolated runner, and the patched code was re-checked statically against the finding&apos;s conditions (shown per finding). Whether the vulnerability is gone is not proven by running an exploit. Open a finding to review and approve its patch.</p>
        </section>
      )}

      <section className="grid gap-2" aria-labelledby="items">
        <h2 id="items" className="text-[calc(17px*var(--ui))] font-semibold">{active ? "Progress" : "Findings"}</h2>
        {run.items.length === 0 ? <p className="text-[calc(14px*var(--ui))] text-ink2">{active ? "Nothing has started yet. Work begins on the next scheduler tick (about every 5 minutes) or when you choose Check now." : "No eligible findings were found in this window."}</p> : (
          <ul className="border hair rounded-[10px] overflow-hidden">
            {run.items.map((i) => {
              const f = i.fix_id ? fixes.get(i.fix_id) : null;
              const st = STAGE[i.stage];
              return (
                <li key={i.assessment_id + i.started_at} className="grid gap-1 px-3 py-3 border-b hair last:border-0 text-[calc(14px*var(--ui))]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={caseHref(i.assessment_id)} className="font-medium underline min-w-0 truncate">{i.title}</Link>
                    <span className={`tone-${st.tone} shrink-0`}>{st.label}</span>
                  </div>
                  <div className="text-[calc(13px*var(--ui))] text-ink2">{i.repo} · {i.severity} · {i.note}{f?.runner?.tests?.summary ? ` · ${f.runner.tests.summary.passed}/${f.runner.tests.summary.total} tests passed` : ""}{f?.runner?.run_url ? <> · <a href={f.runner.run_url} className="underline" target="_blank" rel="noreferrer">runner log</a></> : null}{(f?.pr_url ?? i.pr_url) ? <> · <a href={(f?.pr_url ?? i.pr_url)!} className="underline" target="_blank" rel="noreferrer">pull request</a></> : null}</div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="disclose text-[calc(13px*var(--ui))] text-ink2"><summary>Activity log</summary>
        <ol className="mt-2 grid gap-1">{[...run.events].reverse().map((e, n) => <li key={n}><span className="mono">{fmtLocal(run.tz, Date.parse(e.at), false)}</span> {e.kind}: {e.detail}</li>)}</ol>
      </details>
    </div>
  );
}
