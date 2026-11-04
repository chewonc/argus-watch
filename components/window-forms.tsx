"use client";
// Remediation window forms: the recurring/one-time schedule editor (Settings) and "start a window now" (dashboard).
// Every value is re-validated on the server (app/settings/window-actions.ts); limits here only mirror the server caps.
import { useActionState, useMemo, useState, useSyncExternalStore } from "react";
import type { FormState } from "@/app/settings/window-actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEVELS = [
  { id: "investigate", title: "Investigate only", desc: "Re-check findings against your current code. Nothing is changed." },
  { id: "prepare", title: "Prepare fixes", desc: "Investigate, generate fixes and run your tests in an isolated runner. Patches wait for your review; nothing is written to your repositories." },
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
    <label className="grid gap-1">Timezone
      <select name="tz" value={tz} onChange={(e) => setTz(e.target.value)} className={input} required>
        {tz && !zones.includes(tz) && <option value={tz}>{tz}</option>}
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
    </label>
  );
}

function Common({ repos, d }: { repos: string[]; d?: Partial<Record<string, unknown>> }) {
  const sel = (d?.repos as string[] | undefined) ?? [];
  return (
    <>
      <fieldset className="grid gap-1"><legend className="font-medium">Repositories</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="repos" value="*" defaultChecked={!sel.length} /> All monitored repositories</label>
        {repos.map((r) => <label key={r} className="flex items-center gap-2 min-w-0"><input type="checkbox" name="repos" value={r} defaultChecked={sel.includes(r)} /><span className="truncate">{r}</span></label>)}
      </fieldset>
      <fieldset className="grid gap-2"><legend className="font-medium">What it may do</legend>
        {LEVELS.map((l) => <label key={l.id} className="flex items-start gap-2"><input type="radio" name="level" value={l.id} defaultChecked={(d?.level ?? "prepare") === l.id} className="mt-1" /><span><b>{l.title}</b><span className="block text-[calc(13px*var(--ui))] text-ink2">{l.desc}</span></span></label>)}
        <label className="flex items-start gap-2"><input type="radio" name="level" value="draft_pr" defaultChecked={d?.level === "draft_pr"} className="mt-1" /><span><b>Create draft pull requests</b><span className="block text-[calc(13px*var(--ui))] text-ink2">Also open a draft PR for each fix whose tests passed. Saving checks your GitHub write access and authorizes one window; it is re-checked before every PR. Anything uncertain waits for your review. Never merged.</span></span></label>
      </fieldset>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="grid gap-1">Max issues<input name="max_issues" type="number" min={1} max={50} defaultValue={(d?.max_issues as number) ?? 10} className={input} /></label>
        <label className="grid gap-1">Parallel jobs<input name="max_jobs" type="number" min={1} max={3} defaultValue={(d?.max_jobs as number) ?? 1} className={input} /></label>
        <label className="grid gap-1">Budget (USD)<input name="budget_usd" type="number" min={0.1} max={50} step={0.1} defaultValue={(d?.budget_usd as number) ?? 5} className={input} /></label>
        <label className="grid gap-1">Min severity
          <select name="min_severity" defaultValue={(d?.min_severity as string) ?? "low"} className={input}><option value="low">All</option><option value="moderate">Moderate+</option><option value="high">High+</option><option value="critical">Critical</option></select>
        </label>
      </div>
      <label className="grid gap-1 w-fit">At the end of the window
        <select name="deadline" defaultValue={(d?.deadline as string) ?? "finish"} className={input}><option value="finish">Let running tests finish (results held for review)</option><option value="stop">Stop running tests</option></select>
      </label>
    </>
  );
}

function Result({ s }: { s: FormState }) {
  if (s.error) return <p role="alert" className="tone-warn text-[calc(13px*var(--ui))]">{s.error}</p>;
  if (s.ok) return <p role="status" className="text-[calc(13px*var(--ui))] text-ink2">Saved.</p>;
  return null;
}

export type ScheduleDefaults = { id?: string; kind?: "once" | "recurring"; tz?: string; start?: string; end?: string; days?: number[]; date?: string | null; label?: string; level?: string; repos?: string[]; max_issues?: number; max_jobs?: number; budget_usd?: number; min_severity?: string; deadline?: string };

export function ScheduleForm({ action, repos, d, today }: { action: Action; repos: string[]; d?: ScheduleDefaults; today: string }) {
  const [state, run, pending] = useActionState(action, { ok: false, error: null });
  const z = useZones(d?.tz);
  const [kind, setKind] = useState<"once" | "recurring">(d?.kind ?? "recurring");
  return (
    <form action={run} className="grid gap-3 text-[calc(14px*var(--ui))] border hair rounded-[8px] p-3">
      {d?.id && <input type="hidden" name="id" value={d.id} />}
      <div className="flex flex-wrap gap-3 items-end">
        <label className="grid gap-1">Name<input name="label" defaultValue={d?.label ?? ""} placeholder="Night shift" maxLength={60} className={input} /></label>
        <label className="grid gap-1">Repeats
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "once" | "recurring")} className={input}><option value="recurring">Recurring</option><option value="once">One time</option></select>
        </label>
        {kind === "once" && <label className="grid gap-1">Date<input name="date" type="date" defaultValue={d?.date ?? today} className={input} required /></label>}
        <label className="grid gap-1">Start<input name="start" type="time" defaultValue={d?.start ?? "23:00"} className={input} required /></label>
        <label className="grid gap-1">End<input name="end" type="time" defaultValue={d?.end ?? "07:00"} className={input} required /></label>
        <ZoneSelect {...z} />
      </div>
      {kind === "recurring" && (
        <fieldset className="flex flex-wrap gap-3"><legend className="sr-only">Days</legend>
          {DAYS.map((n, i) => <label key={n} className="flex items-center gap-1"><input type="checkbox" name="days" value={i} defaultChecked={(d?.days ?? [0, 1, 2, 3, 4, 5, 6]).includes(i)} />{n}</label>)}
        </fieldset>
      )}
      <p className="text-[calc(12px*var(--ui))] text-ink2">Times are local to the timezone above and follow its daylight saving changes. An end time earlier than the start ends the next morning. Days are the days the window starts.</p>
      <Common repos={repos} d={d} />
      <div className="flex items-center gap-3"><button type="submit" className="btn w-fit" disabled={pending}>{pending ? "Saving…" : d?.id ? "Save changes" : "Add window"}</button><Result s={state} /></div>
    </form>
  );
}

export function StartNowForm({ action, repos }: { action: Action; repos: string[] }) {
  const [state, run, pending] = useActionState(action, { ok: false, error: null });
  const z = useZones();
  return (
    <form action={run} className="grid gap-3 text-[calc(14px*var(--ui))]">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="grid gap-1">For
          <select name="hours" defaultValue="8" className={input}>{[1, 2, 4, 6, 8, 10, 12].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>)}</select>
        </label>
        <ZoneSelect {...z} />
      </div>
      <Common repos={repos} />
      <div className="flex items-center gap-3"><button type="submit" className="btn btn-primary w-fit" disabled={pending}>{pending ? "Starting…" : "Start window now"}</button><Result s={state} /></div>
    </form>
  );
}
