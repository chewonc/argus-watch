"use server";
// Remediation windows: create, edit, enable/disable, delete schedules, and start a one-time window now.
// Every input is validated here (lib/window-schedule.ts scheduleErrors + the zod schema caps); the form only mirrors it.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertUserCanWrite } from "@/lib/access";
import { env, hasGitHubApp } from "@/lib/env";
import type { User } from "@/lib/schema";
import { githubUserToken, isSystemRepo, requireUser } from "@/lib/session";
import { issueConsent, revokeConsents } from "@/lib/window-consent";
import { store } from "@/lib/store";
import { activeRepoKeys as activeRepos, windowDeps } from "@/lib/window-deps";
import { activeRunFor, controlRun, openRun } from "@/lib/window-run";
import { dateKey, LIMITS, nextOccurrence, scheduleErrors, wallAt, WindowSchedule } from "@/lib/window-schedule";

export type FormState = { ok: boolean; error: string | null };

const num = (v: FormDataEntryValue | null, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pad = (n: number) => String(n).padStart(2, "0");

/** Deployment switches the chosen level depends on, checked when the window is saved (the driver re-checks every step). */
const levelBlocked = (level: string) =>
  level !== "investigate" && !env.FIX_ENABLED ? "Fixes are turned off on this deployment (automated fixes are disabled). Choose Investigate only."
  : level === "draft_pr" && !hasGitHubApp() ? "Pull requests need the GitHub App, which is not configured on this deployment." : null;

/**
 * Consent for unattended draft pull requests (lib/window-consent.ts), for ONE occurrence. Issued only now, while the user
 * is signed in: every repository must allow changes, not be a shared demo, and the user's own GitHub token must show push
 * access. Returns an error in plain words, or null once consent is recorded.
 */
async function authorize(user: User, s: WindowSchedule, occ: { key: string; end_ms: number }): Promise<string | null> {
  const repos = s.repos.length ? s.repos : await activeRepos(user.id);
  if (!repos.length) return "Pick at least one repository for pull requests.";
  if (!/^gh:\d+$/.test(user.id)) return "Pull requests need a GitHub sign-in.";
  const token = await githubUserToken();
  for (const k of repos) {
    if (await isSystemRepo(k)) return `${k} is a shared demo repository and never receives changes.`;
    const ur = await store.getUserRepo(user.id, k);
    if (!ur?.allow_pr) return `Changes are turned off for ${k}. Allow changes for it under Repositories first.`;
    try { await assertUserCanWrite(token, k); } catch (e) { return `${k}: ${String((e as Error).message ?? e)}`; }
  }
  await issueConsent({ userId: user.id, login: user.login, scheduleId: s.id, occurrenceKey: occ.key, repos, endMs: occ.end_ms });
  await store.log({ kind: "fix", source: "settings", detail: `${user.login} authorized draft pull requests for window ${occ.key} on ${repos.length} repositories`, ref: s.id }).catch(() => {});
  return null;
}

/** Turning a window off or deleting it also stops its run in progress (in-flight tests are cancelled). */
async function stopActiveRunOf(uid: string, scheduleId: string): Promise<void> {
  const r = await activeRunFor(uid);
  if (r && r.schedule_id === scheduleId) await controlRun(r.id, uid, "cancel", windowDeps());
}

function parseCommon(fd: FormData) {
  const repos = fd.getAll("repos").map(String).filter(Boolean);
  return {
    label: String(fd.get("label") ?? "").slice(0, 60),
    tz: String(fd.get("tz") ?? "").trim(),
    level: String(fd.get("level") ?? "prepare") as WindowSchedule["level"],
    repos: repos.includes("*") ? [] : repos,
    min_severity: String(fd.get("min_severity") ?? "low") as WindowSchedule["min_severity"],
    max_issues: Math.round(num(fd.get("max_issues"), 10)),
    max_jobs: Math.round(num(fd.get("max_jobs"), 1)),
    budget_usd: num(fd.get("budget_usd"), 5),
    deadline: (fd.get("deadline") === "stop" ? "stop" : "finish") as WindowSchedule["deadline"],
    quiet: fd.get("quiet") === "on",
  };
}

export async function saveWindowSchedule(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/settings");
  const id = String(fd.get("id") ?? "");
  const existing = id ? await store.getSchedule<WindowSchedule>(id) : null;
  if (id && (!existing || existing.user_id !== user.id)) return { ok: false, error: "That schedule no longer exists." };
  const kind = fd.get("kind") === "once" ? "once" : "recurring";
  const now = new Date().toISOString();
  const parsed = WindowSchedule.safeParse({
    ...parseCommon(fd), id: existing?.id ?? `w${randomBytes(6).toString("hex")}`, user_id: user.id, enabled: existing?.enabled ?? true, kind,
    start: String(fd.get("start") ?? ""), end: String(fd.get("end") ?? ""),
    days: kind === "recurring" ? fd.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6],
    date: kind === "once" ? String(fd.get("date") ?? "") || null : null,
    created_at: existing?.created_at ?? now, updated_at: now,
  });
  if (!parsed.success) return { ok: false, error: `Check the limits: at most ${LIMITS.maxIssues} issues, ${LIMITS.maxJobs} parallel jobs and $${LIMITS.maxBudgetUsd} per window.` };
  const errs = scheduleErrors(parsed.data, Date.now(), new Set(await activeRepos(user.id)));
  if (errs.length) return { ok: false, error: errs[0] };
  const lb = levelBlocked(parsed.data.level); if (lb) return { ok: false, error: lb };
  // Any change to a window voids its earlier pull-request authorization; draft_pr re-authorizes the next occurrence now.
  if (existing) await revokeConsents((c) => c.schedule_id === existing.id, "window settings changed");
  if (parsed.data.level === "draft_pr") {
    const occ = nextOccurrence(parsed.data, Date.now());
    if (occ) { const err = await authorize(user, parsed.data, occ); if (err) return { ok: false, error: err }; }
  }
  await store.putSchedule(parsed.data);
  await store.log({ kind: "fix", source: "settings", detail: `${user.login} ${existing ? "updated" : "created"} a remediation window (${parsed.data.kind}, ${parsed.data.start}-${parsed.data.end} ${parsed.data.tz}, ${parsed.data.level})`, ref: parsed.data.id }).catch(() => {});
  revalidatePath("/settings");
  return { ok: true, error: null };
}

export async function toggleWindowSchedule(fd: FormData) {
  const user = await requireUser("/settings");
  const s = await store.getSchedule<WindowSchedule>(String(fd.get("id") ?? ""));
  if (!s || s.user_id !== user.id) return;
  await store.putSchedule({ ...s, enabled: !s.enabled, updated_at: new Date().toISOString() });
  if (s.enabled) { await revokeConsents((c) => c.schedule_id === s.id, "window turned off"); await stopActiveRunOf(user.id, s.id); }
  revalidatePath("/settings");
}

export async function deleteWindowSchedule(fd: FormData) {
  const user = await requireUser("/settings");
  const s = await store.getSchedule<WindowSchedule>(String(fd.get("id") ?? ""));
  if (!s || s.user_id !== user.id) return;
  await revokeConsents((c) => c.schedule_id === s.id, "window deleted");
  await stopActiveRunOf(user.id, s.id);
  await store.deleteSchedule(user.id, s.id);
  revalidatePath("/settings");
}

/** One-time window starting now (dashboard). Opens the run immediately; the scheduler tick (or "Check now") advances it. */
export async function startWindowNow(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/alerts");
  const tz = String(fd.get("tz") ?? "").trim();
  const hours = Math.min(LIMITS.maxHours, Math.max(1, Math.round(num(fd.get("hours"), 8))));
  const active = await activeRunFor(user.id);
  if (active) return { ok: false, error: "A remediation window is already running. Open it from the banner above, or cancel it first." };
  // Exactly `hours` of real time from this minute, even on a daylight-saving changeover day.
  const startMs = Math.floor(Date.now() / 60e3) * 60e3, endMs = startMs + hours * 36e5;
  let local, localEnd;
  try { local = wallAt(tz, startMs); localEnd = wallAt(tz, endMs); } catch { return { ok: false, error: `Unknown timezone "${tz}".` }; }
  const now = new Date().toISOString();
  const parsed = WindowSchedule.safeParse({
    ...parseCommon(fd), id: `w${randomBytes(6).toString("hex")}`, user_id: user.id, enabled: true, kind: "once", tz,
    start: `${pad(local.h)}:${pad(local.min)}`, end: `${pad(localEnd.h)}:${pad(localEnd.min)}`, date: dateKey(local), label: String(fd.get("label") ?? "") || "Started from the dashboard",
    created_at: now, updated_at: now,
  });
  if (!parsed.success) return { ok: false, error: `Check the limits: at most ${LIMITS.maxIssues} issues, ${LIMITS.maxJobs} parallel jobs and $${LIMITS.maxBudgetUsd} per window.` };
  const errs = scheduleErrors(parsed.data, Date.now(), new Set(await activeRepos(user.id)));
  if (errs.length) return { ok: false, error: errs[0] };
  const lb = levelBlocked(parsed.data.level); if (lb) return { ok: false, error: lb };
  const occ = { key: `${parsed.data.id}:${parsed.data.date}`, start_ms: startMs, end_ms: endMs };
  if (parsed.data.level === "draft_pr") { const err = await authorize(user, parsed.data, occ); if (err) return { ok: false, error: err }; }
  if (!(await store.claim(`wocc:${occ.key}`))) return { ok: false, error: "That window is already open." };
  await store.putSchedule(parsed.data);
  const run = await openRun(parsed.data, occ, windowDeps());
  if (!run || run.status === "cancelled") {
    // Refused (another window started meanwhile): leave nothing behind, no live authorization and no orphan schedule.
    await revokeConsents((c) => c.schedule_id === parsed.data.id, "the window could not start");
    await store.deleteSchedule(user.id, parsed.data.id);
    return { ok: false, error: run?.stop_reason ?? "The window could not be opened." };
  }
  revalidatePath("/alerts"); revalidatePath("/settings");
  redirect(`/runs/${encodeURIComponent(run.id)}`);
}

/** Recurring draft-PR windows: authorize the next occurrence (consent covers one occurrence at a time). The reason is shown when refused. */
export async function authorizeNextWindow(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/settings");
  const s = await store.getSchedule<WindowSchedule>(String(fd.get("id") ?? ""));
  if (!s || s.user_id !== user.id) return { ok: false, error: "That window no longer exists." };
  if (s.level !== "draft_pr" || !s.enabled) return { ok: false, error: "This window does not create pull requests, or it is turned off." };
  const occ = nextOccurrence(s, Date.now());
  if (!occ) return { ok: false, error: "This window has no upcoming run." };
  const err = await authorize(user, s, occ);
  if (err) return { ok: false, error: err };
  revalidatePath("/settings");
  return { ok: true, error: null };
}
