// Autonomous remediation windows: schedule validation and timezone arithmetic. Pure (no store, no network), so the
// daylight-saving and midnight-crossing rules are unit-tested directly (tests/window-schedule.test.ts).
//
// Times are stored as the user typed them: a local wall-clock start and end ("23:00", "07:00") plus an IANA zone
// ("Asia/Seoul"). Each occurrence is converted to UTC with the zone's rules on that date, so a recurring window keeps
// its local times across DST changes. A window whose end is not after its start ends on the next local day.
// Local times that do not exist (spring-forward gap) move forward by the gap; ambiguous ones (fall-back) take the
// earlier instant. This matches Temporal's "compatible" disambiguation.
import { z } from "zod";

export const LEVELS = ["investigate", "prepare", "draft_pr"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_TEXT: Record<Level, { title: string; desc: string }> = {
  investigate: { title: "Check issues", desc: "Re-check findings against your current code. Nothing is changed." },
  prepare: { title: "Prepare fixes", desc: "Investigate, then generate fixes and run your tests in an isolated runner. Validated patches wait for your review. Nothing is written to your repositories." },
  draft_pr: { title: "Create draft PRs", desc: "Also open a draft PR for each fix whose tests passed. You authorize each run; your GitHub access is re-checked before every PR, and anything uncertain waits for your review. Never merged." },
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const LIMITS = { maxIssues: 50, maxJobs: 3, maxBudgetUsd: 50, maxHours: 16 } as const;

export const WindowSchedule = z.object({
  id: z.string(),
  user_id: z.string(),
  label: z.string().max(60).default(""),
  enabled: z.boolean().default(true),
  kind: z.enum(["once", "recurring"]),
  tz: z.string(),
  start: z.string().regex(HHMM),
  end: z.string().regex(HHMM),
  days: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]), // recurring: local weekdays, 0 = Sunday
  date: z.string().regex(DATE).nullable().default(null), // once: the local date the window starts
  repos: z.array(z.string()).default([]), // empty = every repository the user monitors
  min_severity: z.enum(["low", "moderate", "high", "critical"]).default("low"),
  max_issues: z.number().int().min(1).max(LIMITS.maxIssues).default(10),
  max_jobs: z.number().int().min(1).max(LIMITS.maxJobs).default(1),
  budget_usd: z.number().min(0.1).max(LIMITS.maxBudgetUsd).default(5),
  level: z.enum(LEVELS).default("prepare"),
  quiet: z.boolean().default(true), // while the window runs, push only critical alerts (others stay in-app); the summary is always sent
  deadline: z.enum(["finish", "stop"]).default("finish"), // in-flight runner jobs at the deadline: let them finish (results held) or cancel them
  created_at: z.string(),
  updated_at: z.string(),
});
export type WindowSchedule = z.infer<typeof WindowSchedule>;

/** True if the runtime knows this IANA zone. */
export function validZone(tz: string): boolean {
  if (!tz || !/^[A-Za-z_+\-0-9/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0); return true; } catch { return false; }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); fmtCache.set(tz, f); }
  return f;
}

export type Wall = { y: number; m: number; d: number; h: number; min: number; s: number; dow: number };
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The local wall-clock time of an instant in a zone. */
export function wallAt(tz: string, ms: number): Wall {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, dow: DOW[p.weekday] ?? 0 };
}

/** The zone's UTC offset at an instant, in milliseconds (positive east of Greenwich). */
export function offsetAt(tz: string, ms: number): number {
  const w = wallAt(tz, ms);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for a local wall-clock time in a zone ("compatible" disambiguation, see the header). */
export function localToUtc(tz: string, y: number, m: number, d: number, h: number, min: number): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const before = offsetAt(tz, guess - 86400e3), after = offsetAt(tz, guess + 86400e3);
  const matches = (t: number) => { const w = wallAt(tz, t); return w.y === y && w.m === m && w.d === d && w.h === h && w.min === min; };
  const c = [guess - before, guess - after].filter(matches);
  if (c.length) return Math.min(...c); // ambiguous: the earlier instant
  return guess - before; // inside a spring-forward gap: the same distance past the gap
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (w: Pick<Wall, "y" | "m" | "d">) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;
/** Calendar arithmetic on a local date (no zone involved). */
export function addDays(date: string, n: number): { y: number; m: number; d: number; dow: number; key: string } {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const r = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
  return { ...r, key: dateKey(r) };
}

export type Occurrence = { key: string; local_date: string; start_ms: number; end_ms: number };

type Times = Pick<WindowSchedule, "tz" | "start" | "end">;
/** The occurrence that starts on a local date (end on the next local day when end <= start). */
export function occurrenceOn(s: Times & { id?: string }, localDate: string): Occurrence {
  const [sh, sm] = s.start.split(":").map(Number), [eh, em] = s.end.split(":").map(Number);
  const day = addDays(localDate, 0);
  const crosses = eh * 60 + em <= sh * 60 + sm;
  const endDay = addDays(localDate, crosses ? 1 : 0);
  const start_ms = localToUtc(s.tz, day.y, day.m, day.d, sh, sm);
  const end_ms = localToUtc(s.tz, endDay.y, endDay.m, endDay.d, eh, em);
  return { key: `${s.id ?? "w"}:${localDate}`, local_date: localDate, start_ms, end_ms };
}

/** Whether a schedule has an occurrence starting on this local date. */
export function runsOn(s: Pick<WindowSchedule, "kind" | "days" | "date">, localDate: string): boolean {
  if (s.kind === "once") return s.date === localDate;
  return s.days.includes(addDays(localDate, 0).dow);
}

/** The occurrence in progress at `now`, if any. Checks windows that started today or yesterday (local). */
export function activeOccurrence(s: WindowSchedule, now: number): Occurrence | null {
  if (!s.enabled) return null;
  const today = dateKey(wallAt(s.tz, now));
  for (const d of [addDays(today, -1).key, today]) {
    if (!runsOn(s, d)) continue;
    const o = occurrenceOn(s, d);
    if (o.start_ms <= now && now < o.end_ms) return o;
  }
  return null;
}

/** The next occurrence that has not ended yet (in progress or upcoming), within the next 8 local days. */
export function nextOccurrence(s: WindowSchedule, now: number): Occurrence | null {
  if (!s.enabled) return null;
  const today = dateKey(wallAt(s.tz, now));
  for (let i = -1; i <= 8; i++) {
    const d = addDays(today, i).key;
    if (!runsOn(s, d)) continue;
    const o = occurrenceOn(s, d);
    if (o.end_ms > now) return o;
  }
  return null;
}

/** Display: "Thu, Nov 5, 23:00 KST (Asia/Seoul)". The zone name is always shown. */
export function fmtLocal(tz: string, ms: number, withDate = true): string {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const w = wallAt(tz, ms);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(ms));
  return `${withDate ? `${date}, ` : ""}${pad(w.h)}:${pad(w.min)} ${short} (${tz})`;
}

/** Validation errors in plain words, or [] when the schedule is acceptable. Server-side: every write goes through this. */
export function scheduleErrors(s: Pick<WindowSchedule, "kind" | "tz" | "start" | "end" | "days" | "date" | "level" | "repos">, now = Date.now(), allowedRepos?: Set<string>): string[] {
  const e: string[] = [];
  if (!validZone(s.tz)) e.push(`Unknown timezone "${s.tz}". Use an IANA name such as Asia/Seoul or America/Los_Angeles.`);
  if (!HHMM.test(s.start) || !HHMM.test(s.end)) e.push("Start and end must be times like 23:00.");
  if (s.start === s.end) e.push("Start and end cannot be the same time.");
  if (HHMM.test(s.start) && HHMM.test(s.end)) {
    const [sh, sm] = s.start.split(":").map(Number), [eh, em] = s.end.split(":").map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm); if (mins <= 0) mins += 1440;
    if (mins > LIMITS.maxHours * 60) e.push(`A run can last at most ${LIMITS.maxHours} hours.`);
  }
  if (s.kind === "recurring" && !s.days.length) e.push("Pick at least one day.");
  if (s.kind === "once") {
    if (!s.date || !DATE.test(s.date)) e.push("Pick a date for a one-time window.");
    else if (!e.length && occurrenceOn(s as Times, s.date).end_ms <= now) e.push("That time has already passed.");
  }
  if (!LEVELS.includes(s.level)) e.push("Unknown level.");
  if (allowedRepos) for (const r of s.repos) if (!allowedRepos.has(r)) e.push(`You do not monitor ${r}.`);
  return e;
}
