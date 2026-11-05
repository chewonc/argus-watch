"use client";
// Remediation window forms: the recurring/one-time schedule editor (Settings) and "start a window now" (dashboard).
// Every value is re-validated on the server (app/settings/window-actions.ts); limits here only mirror the server caps.
import { useActionState, useMemo, useState, useSyncExternalStore } from "react";
import { demoPath } from "@/lib/demo-path";
import type { FormState } from "@/app/settings/window-actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEVELS = [
  { id: "investigate", title: "Check issues" },
  { id: "prepare", title: "Prepare fixes" },
  { id: "draft_pr", title: "Create draft PRs" },
];
const input = "border hair rounded-[6px] px-2 h-9 bg-transparent text-[calc(14px*var(--ui))]";

const noSubscribe = () => () => {};
/** The browser's own zone (empty during server rendering), used as the default for new windows. */
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function useZones(initial?: string) {
  const detected = useSyncExternalStore(noSubscribe, browserZone, () => "");
  const [chosen, setTz] = useState<string | null>(initial ?? null);
  const tz = chosen ?? detected;
  const zones = useMemo(() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return [] as string[]; } }, []);
  return { tz, setTz: (v: string) => setTz(v), zones };
}

function ZoneSelect({ tz, setTz, zones }: ReturnType<typeof useZones>) {
  return (
    <label className="grid gap-1">Time zone
      <select name="tz" value={tz} onChange={(e) => setTz(e.target.value)} className={input} required>
        {tz && !zones.includes(tz) && <option value={tz}>{tz}</option>}
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
    </label>
  );
}

function Common({ repos, d }: { repos: string[]; d?: Partial<Record<string, unknown>> }) {
  const sel = (d?.repos as string[] | undefined) ?? [];
  const [pick, setPick] = useState(sel.length > 0);
  const [level, setLevel] = useState((d?.level as string | undefined) ?? "prepare");
  return (
    <>
      <label className="grid gap-1">Repositories
        <select value={pick ? "pick" : "all"} onChange={(e) => setPick(e.target.value === "pick")} className={input}>
          <option value="all">All repositories</option>
          <option value="pick">Choose repositories…</option>
        </select>
      </label>
      {pick ? (
        <fieldset className="grid gap-1 pl-1"><legend className="sr-only">Choose repositories</legend>
          {repos.map((r) => <label key={r} className="flex items-center gap-2 min-w-0"><input type="checkbox" name="repos" value={r} defaultChecked={sel.includes(r)} /><span className="truncate">{demoPath(r)}</span></label>)}
        </fieldset>
      ) : <input type="hidden" name="repos" value="*" />}
      <label className="grid gap-1">Action
        <select name="level" value={level} onChange={(e) => setLevel(e.target.value)} aria-describedby={level === "draft_pr" ? "level-note" : undefined} className={input}>
          {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
        {level === "draft_pr" && <span id="level-note" role="note" className="text-[calc(12px*var(--ui))] text-ink2">Needs GitHub write access. PRs stay drafts and are never merged.</span>}
      </label>
      <details className="disclose">
        <summary className="text-ink2">Advanced settings</summary>
        <div className="grid gap-3 mt-3">
          <label className="grid gap-1">Issues to check<input name="max_issues" type="number" min={1} max={50} defaultValue={(d?.max_issues as number) ?? 10} className={input} /></label>
          <label className="grid gap-1">Fixes at once<input name="max_jobs" type="number" min={1} max={3} defaultValue={(d?.max_jobs as number) ?? 1} className={input} /></label>
          <label className="grid gap-1">Spending limit ($)<input name="budget_usd" type="number" min={0.1} max={50} step={0.1} defaultValue={(d?.budget_usd as number) ?? 5} className={input} /></label>
          <label className="grid gap-1">Issue severity
            <select name="min_severity" defaultValue={(d?.min_severity as string) ?? "low"} className={input}><option value="low">All</option><option value="moderate">Moderate and up</option><option value="high">High and up</option><option value="critical">Critical only</option></select>
          </label>
          <label className="grid gap-1">When time runs out
            <select name="deadline" defaultValue={(d?.deadline as string) ?? "finish"} className={input}><option value="finish">Finish current tests</option><option value="stop">Stop tests</option></select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" name="quiet" defaultChecked={(d?.quiet as boolean | undefined) ?? true} /> Notify me only for critical issues</label>
        </div>
      </details>
    </>
  );
}

function Result({ s }: { s: FormState }) {
  if (s.error) return <p role="alert" className="tone-warn text-[calc(13px*var(--ui))]">{s.error}</p>;
  if (s.ok) return <p role="status" className="text-[calc(13px*var(--ui))] text-ink2">Saved.</p>;
  return null;
}

export type ScheduleDefaults = { id?: string; kind?: "once" | "recurring"; tz?: string; start?: string; end?: string; days?: number[]; date?: string | null; label?: string; level?: string; repos?: string[]; max_issues?: number; max_jobs?: number; budget_usd?: number; min_severity?: string; deadline?: string; quiet?: boolean };

export function ScheduleForm({ action, repos, d, today }: { action: Action; repos: string[]; d?: ScheduleDefaults; today: string }) {
  const [state, run, pending] = useActionState(action, { ok: false, error: null });
  const z = useZones(d?.tz);
  const [kind, setKind] = useState<"once" | "recurring">(d?.kind ?? "recurring");
  // The browser's own date (en-CA formats as YYYY-MM-DD); the server's UTC date is only the first-render fallback.
  const localToday = useSyncExternalStore(noSubscribe, () => new Date().toLocaleDateString("en-CA"), () => today);
  return (
    <form action={run} className="grid gap-3 max-w-[calc(420px*var(--ui))] text-[calc(14px*var(--ui))]">
      {d?.id && <input type="hidden" name="id" value={d.id} />}
      <label className="grid gap-1">Name (optional)<input name="label" defaultValue={d?.label ?? ""} placeholder="Night shift" maxLength={60} className={input} /></label>
      <label className="grid gap-1">Repeats
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "once" | "recurring")} className={input}><option value="recurring">Every week</option><option value="once">Once</option></select>
      </label>
      {kind === "once" ? <label className="grid gap-1">Date<input key={localToday} name="date" type="date" defaultValue={d?.date ?? localToday} className={input} required /></label> : (
        <fieldset className="grid gap-1"><legend className="mb-1">Days</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">{DAYS.map((n, i) => <label key={n} className="flex items-center gap-1"><input type="checkbox" name="days" value={i} defaultChecked={(d?.days ?? [0, 1, 2, 3, 4, 5, 6]).includes(i)} />{n}</label>)}</div>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-3 items-end">
        <label className="grid gap-1">Starts<input name="start" type="time" defaultValue={d?.start ?? "23:00"} className={input} required /></label>
        <label className="grid gap-1">Ends<input name="end" type="time" defaultValue={d?.end ?? "07:00"} className={input} required /></label>
      </div>
      <ZoneSelect {...z} />
      <Common repos={repos} d={d} />
      <div className="flex items-center gap-3"><button type="submit" className="btn btn-primary w-fit" disabled={pending}>{pending ? "Saving…" : d?.id ? "Save changes" : "Schedule run"}</button><Result s={state} /></div>
    </form>
  );
}

export function StartNowForm({ action, repos }: { action: Action; repos: string[] }) {
  const [state, run, pending] = useActionState(action, { ok: false, error: null });
  const z = useZones();
  return (
    <form action={run} className="grid gap-3 max-w-[calc(420px*var(--ui))] text-[calc(14px*var(--ui))]">
      <div className="grid gap-3">
        <label className="grid gap-1">Duration
          <select name="hours" defaultValue="8" className={input}>{[1, 2, 4, 6, 8, 10, 12].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>)}</select>
        </label>
        <ZoneSelect {...z} />
      </div>
      <Common repos={repos} />
      <div className="flex items-center gap-3"><button type="submit" className="btn btn-primary w-fit" disabled={pending}>{pending ? "Starting…" : "Start"}</button><Result s={state} /></div>
    </form>
  );
}

/** "Authorize next run" for a recurring draft-PR window; shows why when the server refuses. */
export function AuthorizeButton({ action, id }: { action: Action; id: string }) {
  const [state, run, pending] = useActionState(action, { ok: false, error: null });
  return (
    <form action={run} className="grid gap-1 justify-items-end">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn-ghost" disabled={pending}>{pending ? "Checking access…" : "Authorize next run"}</button>
      {state.error && <span role="alert" className="tone-warn text-[calc(12px*var(--ui))] max-w-[calc(320px*var(--ui))] text-right">{state.error}</span>}
    </form>
  );
}
