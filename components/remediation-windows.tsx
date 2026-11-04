// Settings → Automatic fix runs, as three separate parts: "Schedule a run" (create), "Scheduled runs" (upcoming
// schedules: edit, turn on/off, delete, authorize) and "History" (past runs). Server component; the forms are client
// components (components/window-forms.tsx). Data model names ("window") are unchanged.
import Link from "next/link";
import { authorizeNextWindow, deleteWindowSchedule, saveWindowSchedule, toggleWindowSchedule } from "@/app/settings/window-actions";
import { consentFor, consentProblem } from "@/lib/window-consent";
import { AuthorizeButton, ScheduleForm } from "@/components/window-forms";
import { store } from "@/lib/store";
import type { WindowRun } from "@/lib/window-run";
import { dateKey, fmtLocal, LEVEL_TEXT, nextOccurrence, occurrenceOn, wallAt, type WindowSchedule } from "@/lib/window-schedule";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const RUN_STATUS: Record<string, string> = { running: "Running", paused: "Paused", finishing: "Finishing tests", completed: "Finished", cancelled: "Cancelled" };

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
    // A one-time schedule that already has a run (including "start now" runs) belongs to History, not Scheduled runs.
    list: await Promise.all(schedules.filter((s) => !(s.kind === "once" && ((!!s.date && occurrenceOn(s, s.date).end_ms <= now) || runs.some((r) => r.schedule_id === s.id)))).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(async (s) => {
      const next = nextOccurrence(s, now);
      // draft_pr: is the next occurrence authorized? (any repository it lists counts; each PR re-checks its own repository)
      const c = s.level === "draft_pr" && next ? await consentFor(next.key) : null;
      const authProblem = s.level === "draft_pr" && next ? (c ? consentProblem(c, { userId: s.user_id, occurrenceKey: next.key, repoKey: c.repos[0] ?? "", now }) : "not authorized yet") : null;
      return { s, next, authProblem, authorized: s.level === "draft_pr" && !!c && !authProblem };
    })),
  };
}

const h3 = "text-[calc(15px*var(--ui))] font-semibold";
const muted = "text-[calc(13px*var(--ui))] text-ink2";

export async function RemediationWindows({ userId }: { userId: string }) {
  const { now, runs, repos, today, list } = await load(userId);
  const past = runs.filter((r) => r.status === "completed" || r.status === "cancelled");
  return (
    <div className="grid gap-8 text-[calc(14px*var(--ui))]">
      <section className="grid gap-3" aria-labelledby="schedule-run">
        <h3 id="schedule-run" className={h3}>Schedule a run</h3>
        {repos.length ? <ScheduleForm action={saveWindowSchedule} repos={repos} today={today} /> : <p className={muted}>Connect a repository first.</p>}
      </section>

      <section className="grid gap-3" aria-labelledby="scheduled-runs">
        <h3 id="scheduled-runs" className={h3}>Scheduled runs</h3>
        {list.length === 0 ? <p className={muted}>Nothing scheduled.</p> : (
          <ul className="border hair rounded-[8px]">
            {list.map(({ s, next, authProblem, authorized }) => (
              <li key={s.id} className="grid gap-2 px-3 py-3 border-b hair last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="grid gap-0.5 min-w-0">
                    <span className="font-medium">{s.label || (s.kind === "once" ? "One-time run" : "Weekly run")}{!s.enabled && <span className="text-ink2 font-normal"> · off</span>}</span>
                    <span className={muted}>{when(s)} · {LEVEL_TEXT[s.level].title}</span>
                    <span className={muted}>{s.enabled && next ? `${next.start_ms <= now ? "Running now, ends" : "Next"} ${fmtLocal(s.tz, next.start_ms <= now ? next.end_ms : next.start_ms)}` : "No upcoming run"}</span>
                    {s.level === "draft_pr" && s.enabled && next && <span className={`text-[calc(13px*var(--ui))] ${authorized ? "tone-ok" : "tone-warn"}`}>{authorized ? "Draft PRs authorized for the next run." : `Draft PRs not authorized (${authProblem}). Fixes will wait for your review.`}</span>}
                  </span>
                  <span className="flex gap-2">
                    {s.level === "draft_pr" && s.enabled && next && !authorized && <AuthorizeButton action={authorizeNextWindow} id={s.id} />}
                    <form action={toggleWindowSchedule}><input type="hidden" name="id" value={s.id} /><button type="submit" className="btn-ghost">{s.enabled ? "Turn off" : "Turn on"}</button></form>
                    <form action={deleteWindowSchedule}><input type="hidden" name="id" value={s.id} /><button type="submit" className="btn-ghost btn-danger">Delete</button></form>
                  </span>
                </div>
                <details className="disclose text-[calc(13px*var(--ui))]"><summary>Edit</summary><div className="mt-3"><ScheduleForm action={saveWindowSchedule} repos={repos} d={s} today={today} /></div></details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="run-history">
        <h3 id="run-history" className={h3}>History</h3>
        {past.length === 0 ? <p className={muted}>No finished runs yet.</p> : (
          <ul className="border hair rounded-[8px]">
            {past.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b hair last:border-0 text-[calc(13px*var(--ui))]">
                <Link href={`/runs/${encodeURIComponent(r.id)}`} className="underline">{r.label}</Link>
                <span className="text-ink2">{fmtLocal(r.tz, r.start_ms)} · {RUN_STATUS[r.status] ?? r.status}{r.report ? ` · ${r.report.validated} fix(es) ready, ${r.report.needs_review} to review` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
