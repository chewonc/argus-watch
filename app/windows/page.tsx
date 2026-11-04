// Remediation windows (/windows): the one place to start, schedule and follow autonomous remediation. Reached from the
// primary navigation ("Remediation"); the same schedules also appear under Settings. Reuses the Settings components.
import Link from "next/link";
import { startWindowNow } from "@/app/settings/window-actions";
import { RemediationWindows } from "@/components/remediation-windows";
import { StartNowForm } from "@/components/window-forms";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";
import { activeRunFor } from "@/lib/window-run";
import { fmtLocal, LEVEL_TEXT } from "@/lib/window-schedule";

export const dynamic = "force-dynamic";

export default async function WindowsPage() {
  const user = await requireUser("/windows");
  const [active, mine] = await Promise.all([activeRunFor(user.id), store.listUserRepos(user.id)]);
  const repos = mine.filter((m) => !m.paused && !m.access_lost).map((m) => m.repo_key);
  return (
    <div className="mx-auto max-w-[calc(860px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-[calc(28px*var(--ui))] font-semibold tracking-[-0.02em]">Remediation windows</h1>
        <p className="text-[calc(15px*var(--ui))] text-ink2">Let Argus Watch take the night shift. During a window it re-checks your open findings against your current code, prepares fixes and runs your tests in an isolated runner, and leaves you a report. You choose how far it may go: investigate only, prepare fixes for your review, or open draft pull requests. Nothing is ever merged.</p>
      </header>

      <section className="grid gap-3" aria-labelledby="now">
        <h2 id="now" className="text-[calc(17px*var(--ui))] font-semibold">Right now</h2>
        {active ? (
          <Link href={`/runs/${encodeURIComponent(active.id)}`} className="border hair rounded-[10px] px-4 py-3 grid gap-1 text-[calc(14px*var(--ui))] hover:bg-raised">
            <span><b>{active.label}</b> <span className="text-ink2">· {active.status === "paused" ? "paused" : "running"} · {LEVEL_TEXT[active.level].title}</span></span>
            <span className="text-ink2">Until {fmtLocal(active.tz, active.end_ms)} · {active.items.length} finding(s) so far · estimated ${active.spent_usd.toFixed(2)} of ${active.limits.budget_usd.toFixed(2)}</span>
            <span className="underline w-fit">View progress, pause or cancel</span>
          </Link>
        ) : repos.length === 0 ? (
          <p className="text-[calc(14px*var(--ui))] text-ink2">Connect a repository first: <Link href="/settings#repositories" className="underline">Repositories</Link>.</p>
        ) : (
          <div className="border hair rounded-[10px] px-4 py-4 grid gap-2">
            <p className="text-[calc(14px*var(--ui))]">Start a window now and come back to the results.</p>
            <StartNowForm action={startWindowNow} repos={repos} />
          </div>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="sched">
        <h2 id="sched" className="text-[calc(17px*var(--ui))] font-semibold">Scheduled windows and history</h2>
        <RemediationWindows userId={user.id} />
      </section>
    </div>
  );
}
