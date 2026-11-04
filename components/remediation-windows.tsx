// Settings → Autonomous remediation windows: schedules (next run with its timezone), add/edit, enable/disable,
// delete, and recent run history. Server component; the forms are client components (components/window-forms.tsx).
import Link from "next/link";
import { authorizeNextWindow, deleteWindowSchedule, saveWindowSchedule, toggleWindowSchedule } from "@/app/settings/window-actions";
import { consentFor, consentProblem } from "@/lib/window-consent";
import { ScheduleForm } from "@/components/window-forms";
import { store } from "@/lib/store";
import type { WindowRun } from "@/lib/window-run";
import { addDays, dateKey, fmtLocal, LEVEL_TEXT, nextOccurrence, wallAt, type WindowSchedule } from "@/lib/window-schedule";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const RUN_STATUS: Record<string, string> = { running: "Running", paused: "Paused", finishing: "Finishing running tests", completed: "Finished", cancelled: "Cancelled" };

function when(s: WindowSchedule): string {
  const days = s.kind === "once" ? s.date ?? "" : s.days.length === 7 ? "Every day" : s.days.map((d) => DAY[d]).join(", ");
  return `${days}, ${s.start} to ${s.end} (${s.tz})`;
}

/** Data for the section, read at request time (kept out of the component body: rendering stays pure). */
async function load(userId: string) {
  const [schedules, runs, mine] = await Promise.all([store.listSchedules<WindowSchedule>(userId), store.listRuns<WindowRun>(userId, 10), store.listUserRepos(userId)]);
  const now = Date.now();
  return {
    now, runs, repos: mine.filter((u) => !u.paused && !u.access_lost).map((u) => u.repo_key), today: dateKey(wallAt("UTC", now)),
    list: await Promise.all(schedules.filter((s) => !(s.kind === "once" && !nextOccurrence(s, now))).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(async (s) => {
      const next = nextOccurrence(s, now);
      // draft_pr: is the next occurrence authorized? (any repository it lists counts; each PR re-checks its own repository)
      const c = s.level === "draft_pr" && next ? await consentFor(next.key) : null;
      const authProblem = s.level === "draft_pr" && next ? (c ? consentProblem(c, { userId: s.user_id, occurrenceKey: next.key, repoKey: c.repos[0] ?? "", now }) : "not authorized yet") : null;
      return { s, next, authProblem, authorized: s.level === "draft_pr" && !!c && !authProblem };
    })),
  };
}

export async function RemediationWindows({ userId }: { userId: string }) {
  const { now, runs, repos, today, list } = await load(userId);
  return (
    <div className="grid gap-4 text-[calc(14px*var(--ui))]">
      {list.length > 0 && (
        <ul className="border hair rounded-[8px]">
          {list.map(({ s, next, authProblem, authorized }) => {
            return (
              <li key={s.id} className="grid gap-2 px-3 py-3 border-b hair last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="grid gap-0.5 min-w-0"><span className="font-medium">{s.label || (s.kind === "once" ? "One-time window" : "Recurring window")}{!s.enabled && <span className="text-ink2 font-normal"> · off</span>}</span>
                    <span className="text-[calc(13px*var(--ui))] text-ink2">{when(s)} · {LEVEL_TEXT[s.level].title} · up to {s.max_issues} issues, {s.max_jobs} parallel, ${s.budget_usd.toFixed(2)}</span>
                    <span className="text-[calc(13px*var(--ui))] text-ink2">{s.enabled && next ? `${next.start_ms <= now ? "In progress, ends" : "Next run"}: ${fmtLocal(s.tz, next.start_ms <= now ? next.end_ms : next.start_ms)}` : "No upcoming run"}</span>
                    {s.level === "draft_pr" && s.enabled && next && <span className={`text-[calc(13px*var(--ui))] ${authorized ? "tone-ok" : "tone-warn"}`}>{authorized ? "Draft pull requests authorized for this window." : `Draft pull requests not authorized for this window (${authProblem}); fixes will be prepared and held for your review.`}</span>}
                  </span>
                  <span className="flex gap-2">
                    {s.level === "draft_pr" && s.enabled && next && !authorized && <form action={authorizeNextWindow}><input type="hidden" name="id" value={s.id} /><button type="submit" className="btn-ghost">Authorize this window</button></form>}
                    <form action={toggleWindowSchedule}><input type="hidden" name="id" value={s.id} /><button type="submit" className="btn-ghost">{s.enabled ? "Turn off" : "Turn on"}</button></form>
                    <form action={deleteWindowSchedule}><input type="hidden" name="id" value={s.id} /><button type="submit" className="btn-ghost btn-danger">Delete</button></form>
                  </span>
                </div>
                <details className="disclose text-[calc(13px*var(--ui))]"><summary>Edit</summary><div className="mt-2"><ScheduleForm action={saveWindowSchedule} repos={repos} d={s} today={today} /></div></details>
              </li>
            );
          })}
        </ul>
      )}
      <details className="disclose" open={list.length === 0}><summary className="font-medium">Add a window</summary><div className="mt-2"><ScheduleForm action={saveWindowSchedule} repos={repos} today={addDays(today, 0).key} /></div></details>
      {runs.length > 0 && (
        <div className="grid gap-1">
          <div className="label">Recent runs</div>
          <ul className="border hair rounded-[8px]">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b hair last:border-0 text-[calc(13px*var(--ui))]">
                <Link href={`/runs/${encodeURIComponent(r.id)}`} className="underline">{r.label}</Link>
                <span className="text-ink2">{fmtLocal(r.tz, r.start_ms)} · {RUN_STATUS[r.status] ?? r.status}{r.report ? ` · ${r.report.validated} fix(es) ready, ${r.report.needs_review} to review` : ` · ${r.items.length} so far`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
