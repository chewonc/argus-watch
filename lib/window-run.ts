// Autonomous remediation windows: the driver. One "run" per schedule occurrence. The 5-minute scheduler tick
// (app/api/poll/tick) calls startDueRuns() and stepRun() for every active run; each step does a bounded amount of work.
//
// What a step may do, by authorization level (lib/window-schedule.ts):
//   investigate  re-verify findings against the current commit (lib/reverify.ts, read-only)
//   prepare      + draft a fix (lib/fix.ts) and run it in the isolated runner in PREVIEW mode (lib/runner.ts startRun).
//                Validated patches wait for the user's approval (status "validated"); nothing is written to a repository.
//   draft_pr     + for a validated patch, ask lib/window-write.ts to open a DRAFT pull request. That module re-checks the
//                user's consent and live GitHub permission and holds the patch on any doubt. Nothing else here writes.
// It never merges and never pushes to an existing branch. Every write path stays behind lib/write-auth.ts.
//
// Safety, enforced here on the server (the UI only mirrors it):
//   - hard budget: the estimated cost of an operation is reserved BEFORE it starts; an operation that would cross the cap never starts
//   - max issues and max concurrent runner jobs per run
//   - repository scope: every step re-reads the user's monitored repositories; a repository removed, paused or with lost access is skipped
//   - deadline: no new work at or after the window end; a runner job needs RUNNER_MARGIN_MS of window left to start; in-flight jobs
//     follow the deadline policy (finish: results held for review, stop: cancelled) and are cancelled at END_GRACE_MS regardless
//   - duplicates and overlap: one run per occurrence (atomic claim), one active run per user, one step per run at a time (time-bucketed
//     claim), one attempt per finding per run, and findings that already have an active or validated fix are skipped
//   - failures: every operation is isolated; three consecutive failures stop new work for the rest of the window
import { randomBytes } from "node:crypto";
import { activeOccurrence, type Level, type WindowSchedule } from "./window-schedule";
import { store } from "./store";

export const COST_USD = { verify: 0.04, draft: 0.03, runner: 0.3 } as const; // estimates per operation, shown as estimates
export const RUNNER_MARGIN_MS = 20 * 60e3;
export const VERIFY_MARGIN_MS = 3 * 60e3;
export const END_GRACE_MS = 30 * 60e3;
export const RUNNER_TIMEOUT_MS = 45 * 60e3;
export const OPS_PER_STEP = 3;
const MAX_EVENTS = 150;

export type ItemStage = "verifying" | "confirmed" | "not_affected" | "unclear" | "drafted" | "running" | "validated" | "pr_created" | "tests_failed" | "failed" | "cancelled" | "timed_out";
export type RunItem = {
  assessment_id: string; repo: string; finding_id: string; title: string; severity: string;
  stage: ItemStage; fix_id: string | null; note: string; cost_usd: number; started_at: string; updated_at: string;
  retry?: boolean; // drafted, runner deferred by a limit that can clear (concurrency): try again on a later step
  pr_tried?: boolean; // draft_pr level: one pull-request attempt per validated patch; a held patch waits for the user
  pr_url?: string | null;
};
export type RunStatus = "running" | "paused" | "finishing" | "completed" | "cancelled";
export type WindowRun = {
  id: string; schedule_id: string; user_id: string; occurrence_key: string; label: string; tz: string; level: Level; deadline: "finish" | "stop";
  start_ms: number; end_ms: number; repos: string[]; min_severity: string;
  limits: { max_issues: number; max_jobs: number; budget_usd: number };
  status: RunStatus; stop_reason: string | null; spent_usd: number; failures_in_row: number;
  items: RunItem[]; events: { at: string; kind: string; detail: string }[];
  created_at: string; finished_at: string | null; report: RunReport | null;
};
export type RunReport = {
  investigated: number; confirmed: number; not_affected: number; unclear: number; fixes_generated: number; validated: number;
  tests_failed: number; failed: number; cancelled: number; needs_review: number; prs_created: number; duration_ms: number; spent_usd: number; stop_reason: string | null;
};

/** Thrown by a dependency when an operation is refused before doing any work (configuration, permission): its reserved cost is refunded. */
export class Precondition extends Error { readonly precondition = true; }
const refused = (e: unknown) => !!(e && typeof e === "object" && "precondition" in e);

export type Candidate = { assessment_id: string; repo: string; finding_id: string; title: string; severity: string; verified: boolean; kev: boolean };
export type FixState = { status: string; error: string | null; pr_url: string | null; dispatched_at: string | null };

/** Side effects the driver needs. Production wiring: lib/window-deps.ts. Tests pass fakes. */
export type Deps = {
  now(): number;
  /** Repositories the user currently monitors and may act on (not paused, access not lost). */
  activeRepos(uid: string): Promise<string[]>;
  candidates(run: WindowRun, repos: string[]): Promise<Candidate[]>;
  verify(assessmentId: string): Promise<{ id: string; verdict: "Affected" | "Not Affected" | "Unclear"; verified: boolean }>;
  draft(assessmentId: string, uid: string): Promise<{ fix_id: string; files: number; error: string | null }>;
  /** Why the isolated runner cannot run for this repository now, or null. Preview mode: no write permission is needed. */
  runnerBlocker(repoKey: string, uid: string): Promise<string | null>;
  startRunner(fixId: string, runId: string): Promise<void>;
  fixState(fixId: string): Promise<FixState | null>;
  cancelFix(fixId: string): Promise<void>;
  notify(run: WindowRun): Promise<void>;
  /** draft_pr level only: lib/window-write.ts openDraftPr (all authorization checks inside). */
  openDraftPr(fixId: string, run: WindowRun): Promise<{ ok: true; pr_url: string | null } | { ok: false; held: string }>;
};

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, moderate: 2, medium: 2, low: 1, unknown: 0, none: 0 };
export const severityAtLeast = (sev: string, min: string) => (SEV_RANK[sev] ?? 0) >= (SEV_RANK[min] ?? 1) || min === "low";

/** Priority: confirmed findings first (they can go straight to a fix), then severity, then known-exploited. */
export function prioritize(c: Candidate[]): Candidate[] {
  return [...c].sort((a, b) => Number(b.verified) - Number(a.verified) || (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || Number(b.kev) - Number(a.kev) || a.assessment_id.localeCompare(b.assessment_id));
}

/** Levels that draft and test fixes (draft_pr adds pull requests on top). */
export const prepares = (r: Pick<WindowRun, "level">) => r.level !== "investigate";

const TERMINAL: RunStatus[] = ["completed", "cancelled"];
export const isTerminal = (r: Pick<WindowRun, "status">) => TERMINAL.includes(r.status);
const INFLIGHT: ItemStage[] = ["running", "verifying"];
export const inflightJobs = (r: WindowRun) => r.items.filter((i) => i.stage === "running").length;
export const issuesStarted = (r: WindowRun) => r.items.length;

/** Whether one more operation of this kind may start now. Pure; the single place the limits are decided. */
export function gate(r: WindowRun, now: number, kind: keyof typeof COST_USD, newIssue: boolean): { ok: true } | { ok: false; reason: string; final: boolean } {
  if (r.status !== "running") return { ok: false, reason: `run is ${r.status}`, final: false };
  if (now >= r.end_ms) return { ok: false, reason: "the window has ended", final: true };
  if (r.failures_in_row >= 3) return { ok: false, reason: "stopped after three consecutive failures", final: true };
  if (newIssue && issuesStarted(r) >= r.limits.max_issues) return { ok: false, reason: `reached the limit of ${r.limits.max_issues} issue(s)`, final: true };
  if (r.spent_usd + COST_USD[kind] > r.limits.budget_usd + 1e-9) return { ok: false, reason: `the next step would exceed the $${r.limits.budget_usd.toFixed(2)} budget`, final: kind === "verify" };
  if (kind === "runner") {
    if (inflightJobs(r) >= r.limits.max_jobs) return { ok: false, reason: `${r.limits.max_jobs} runner job(s) already in progress`, final: false };
    if (r.end_ms - now < RUNNER_MARGIN_MS) return { ok: false, reason: "too little time left in the window to run tests", final: false };
  }
  if (kind === "verify" && r.end_ms - now < VERIFY_MARGIN_MS) return { ok: false, reason: "too little time left in the window", final: true };
  return { ok: true };
}

const iso = (ms: number) => new Date(ms).toISOString();
function ev(r: WindowRun, now: number, kind: string, detail: string): void {
  r.events.push({ at: iso(now), kind, detail: detail.slice(0, 300) });
  if (r.events.length > MAX_EVENTS) r.events.splice(0, r.events.length - MAX_EVENTS);
}

export function newRun(s: WindowSchedule, occ: { key: string; start_ms: number; end_ms: number }, now: number, repos: string[]): WindowRun {
  return {
    id: `${occ.key.replace(/[^A-Za-z0-9-]/g, "-")}-${randomBytes(4).toString("hex")}`, schedule_id: s.id, user_id: s.user_id, occurrence_key: occ.key, label: s.label || (s.kind === "once" ? "One-time window" : "Recurring window"),
    tz: s.tz, level: s.level, deadline: s.deadline, start_ms: occ.start_ms, end_ms: occ.end_ms, repos, min_severity: s.min_severity,
    limits: { max_issues: s.max_issues, max_jobs: s.max_jobs, budget_usd: s.budget_usd },
    status: "running", stop_reason: null, spent_usd: 0, failures_in_row: 0, items: [], events: [{ at: iso(now), kind: "started", detail: `window opened (${s.level}); ends ${iso(occ.end_ms)}` }],
    created_at: iso(now), finished_at: null, report: null,
  };
}

export function summarize(r: WindowRun, now: number): RunReport {
  const n = (s: ItemStage[]) => r.items.filter((i) => s.includes(i.stage)).length;
  return {
    investigated: r.items.length, confirmed: n(["confirmed", "drafted", "running", "validated", "pr_created", "tests_failed"]) + r.items.filter((i) => i.stage === "failed" && !!i.fix_id).length,
    not_affected: n(["not_affected"]), unclear: n(["unclear"]), fixes_generated: r.items.filter((i) => !!i.fix_id).length, validated: n(["validated"]),
    tests_failed: n(["tests_failed"]), failed: n(["failed"]), cancelled: n(["cancelled", "timed_out"]),
    needs_review: n(["validated", "pr_created", "drafted", "unclear", "confirmed"]), prs_created: n(["pr_created"]), duration_ms: Math.max(0, Math.min(now, r.end_ms) - r.start_ms), spent_usd: Math.round(r.spent_usd * 100) / 100, stop_reason: r.stop_reason,
  };
}

/** Start a run for every enabled schedule whose occurrence is in progress. Idempotent: the occurrence claim makes a second call a no-op. */
export async function startDueRuns(deps: Deps, schedules?: WindowSchedule[]): Promise<string[]> {
  const now = deps.now();
  const started: string[] = [];
  for (const s of schedules ?? (await store.listSchedules<WindowSchedule>())) {
    const occ = activeOccurrence(s, now);
    if (!occ) continue;
    if (!(await store.claim(`wocc:${occ.key}`))) continue; // this occurrence already has (or had) its run
    const run = await openRun(s, occ, deps);
    if (run) started.push(run.id);
  }
  return started;
}

/** Create the run record for an occurrence (also used by "start now"). Refuses when the user already has an active run. */
export async function openRun(s: WindowSchedule, occ: { key: string; start_ms: number; end_ms: number }, deps: Deps): Promise<WindowRun | null> {
  const now = deps.now();
  const active = await activeRunFor(s.user_id);
  const mine = new Set(await deps.activeRepos(s.user_id));
  const repos = (s.repos.length ? s.repos : [...mine]).filter((r) => mine.has(r));
  const run = newRun(s, occ, now, repos);
  if (active) {
    run.status = "cancelled"; run.stop_reason = `another window was already running (${active.id})`; run.finished_at = iso(now);
    ev(run, now, "skipped", run.stop_reason); run.report = summarize(run, now);
    await store.putRun(run, true); await store.retireRun(run.id);
    return run;
  }
  if (!repos.length) ev(run, now, "warning", "no monitored repositories are in scope for this window");
  await store.putRun(run, true);
  await store.log({ kind: "fix", source: "window", detail: `remediation window opened for ${s.user_id} (${s.level}, ${repos.length} repositories)`, ref: run.id });
  return run;
}

export async function activeRunFor(uid: string): Promise<WindowRun | null> {
  for (const id of await store.activeRunIds()) {
    const r = await store.getRun<WindowRun>(id);
    if (r && r.user_id === uid && !isTerminal(r)) return r;
  }
  return null;
}

async function finalize(r: WindowRun, now: number, deps: Deps, status: "completed" | "cancelled" = "completed"): Promise<WindowRun> {
  r.status = status; r.finished_at = iso(now); r.report = summarize(r, now);
  ev(r, now, status, `${r.report.investigated} investigated, ${r.report.validated} validated fix(es), ${r.report.needs_review} need review; estimated cost $${r.report.spent_usd.toFixed(2)}`);
  await store.putRun(r); await store.retireRun(r.id);
  await deps.notify(r).catch((e) => store.log({ kind: "error", source: "window", detail: `report notification failed: ${String(e).slice(0, 160)}`, ref: r.id }));
  return r;
}

/** Map the fix record onto the run item. */
function applyFixState(it: RunItem, st: FixState | null, now: number): void {
  if (!st) { it.stage = "failed"; it.note = "fix record missing"; return; }
  const was = it.stage;
  if (st.status === "validated") { it.stage = "validated"; it.note = "tests passed or static checks only; waiting for your review"; }
  else if (st.status === "validation_failed") { it.stage = "tests_failed"; it.note = st.error ?? "the patch failed validation"; }
  else if (st.status === "failed") { it.stage = "failed"; it.note = st.error ?? "the runner failed"; }
  else if (st.status === "cancelled") { it.stage = "cancelled"; it.note = "runner cancelled"; }
  else if (["queued", "running"].includes(st.status) && st.dispatched_at && now - Date.parse(st.dispatched_at) > RUNNER_TIMEOUT_MS) { it.stage = "timed_out"; it.note = "the runner did not report back in time"; }
  if (it.stage !== was) it.updated_at = iso(now);
}

/** User controls. Pause stops new work (in-flight jobs continue); resume continues before the deadline; cancel stops everything now. */
export async function controlRun(id: string, uid: string, action: "pause" | "resume" | "cancel", deps: Deps): Promise<WindowRun> {
  const r = await store.getRun<WindowRun>(id);
  if (!r || r.user_id !== uid) throw new Error("not found");
  const now = deps.now();
  if (isTerminal(r)) return r;
  if (action === "pause" && r.status === "running") { r.status = "paused"; ev(r, now, "paused", "paused by you; no new work starts"); }
  else if (action === "resume" && r.status === "paused") { if (now >= r.end_ms) throw new Error("the window has already ended"); r.status = "running"; ev(r, now, "resumed", "resumed by you"); }
  else if (action === "cancel") {
    for (const it of r.items.filter((i) => i.stage === "running" && i.fix_id)) { await deps.cancelFix(it.fix_id!).catch(() => {}); it.stage = "cancelled"; it.note = "cancelled with the window"; it.updated_at = iso(now); }
    ev(r, now, "cancel", "cancelled by you");
    await import("./window-consent").then((m) => m.revokeConsents((c) => c.occurrence_key === r.occurrence_key && c.user_id === r.user_id, "window cancelled")).catch(() => {});
    return finalize(r, now, deps, "cancelled");
  }
  await store.putRun(r);
  return r;
}

/** One bounded step of an active run. Safe to call concurrently and repeatedly: a per-minute claim admits one caller. */
export async function stepRun(id: string, deps: Deps): Promise<{ run: WindowRun | null; did: string[] }> {
  const now = deps.now();
  const did: string[] = [];
  let r = await store.getRun<WindowRun>(id);
  if (!r) { await store.retireRun(id); return { run: null, did }; }
  if (isTerminal(r)) { await store.retireRun(id); return { run: r, did }; }
  if (r.status === "paused" && now < r.end_ms) return { run: r, did: ["paused"] }; // nothing to do; does not use up this minute's step
  if (!(await store.claim(`wstep:${id}:${Math.floor(now / 60e3)}`))) return { run: r, did: ["busy"] };

  // 1. Follow in-flight runner jobs.
  for (const it of r.items.filter((i) => i.stage === "running" && i.fix_id)) applyFixState(it, await deps.fixState(it.fix_id!).catch(() => null), now);

  // 2. Repository scope: work only on repositories the user still monitors and can access.
  const scope = new Set(await deps.activeRepos(r.user_id));
  const lost = r.repos.filter((x) => !scope.has(x));
  if (lost.length) { r.repos = r.repos.filter((x) => scope.has(x)); ev(r, now, "scope", `no longer in scope (removed, paused or access lost): ${lost.join(", ")}`); }

  // 2b. draft_pr level: one pull-request attempt per validated patch, only while the window is active.
  if (r.level === "draft_pr" && r.status === "running" && now < r.end_ms) {
    for (const it of r.items.filter((i) => i.stage === "validated" && !i.pr_tried && i.fix_id)) {
      it.pr_tried = true;
      const out = await deps.openDraftPr(it.fix_id!, r).catch((e) => ({ ok: false as const, held: String((e as Error).message ?? e).slice(0, 160) }));
      if (out.ok) { it.stage = "pr_created"; it.pr_url = out.pr_url; it.note = "draft pull request opened for your review"; ev(r, now, "pr", `draft pull request for ${it.repo}${out.pr_url ? `: ${out.pr_url}` : ""}`); did.push(`draft PR ${it.repo}`); }
      else { it.note = `validated; pull request held for your review: ${out.held}`; ev(r, now, "held", `${it.repo}: ${out.held}`); }
      it.updated_at = iso(now);
    }
  }

  // 3. Deadline.
  if (now >= r.end_ms) {
    if (r.status !== "finishing") {
      r.status = "finishing"; ev(r, now, "deadline", `window ended; ${r.deadline === "stop" ? "cancelling in-flight jobs" : "letting in-flight jobs finish, results held for review"}`);
      if (r.deadline === "stop") for (const it of r.items.filter((i) => i.stage === "running" && i.fix_id)) { await deps.cancelFix(it.fix_id!).catch(() => {}); it.stage = "cancelled"; it.note = "cancelled at the window deadline"; it.updated_at = iso(now); }
    }
    if (now >= r.end_ms + END_GRACE_MS) for (const it of r.items.filter((i) => i.stage === "running" && i.fix_id)) { await deps.cancelFix(it.fix_id!).catch(() => {}); it.stage = "timed_out"; it.note = "still running 30 minutes after the window ended; cancelled"; it.updated_at = iso(now); }
    if (!r.items.some((i) => INFLIGHT.includes(i.stage))) return { run: await finalize(r, now, deps), did: ["finalized"] };
    await store.putRun(r);
    return { run: r, did: ["waiting for in-flight jobs"] };
  }
  if (r.status !== "running") { await store.putRun(r); return { run: r, did: [r.status] }; }

  // 4. New work, bounded per step.
  const seen = new Set(r.items.map((i) => i.finding_id + "|" + i.repo));
  const all = prioritize((await deps.candidates(r, r.repos).catch(() => [] as Candidate[])).filter((c) => r!.repos.includes(c.repo) && severityAtLeast(c.severity, r!.min_severity)));
  // Items confirmed earlier in this run that still need a fix (prepare level), then new candidates.
  const pending = prepares(r) ? r.items.filter((i) => i.stage === "confirmed" || (i.stage === "drafted" && i.retry)) : [];
  const fresh = all.filter((c) => !seen.has(c.finding_id + "|" + c.repo));
  let ops = 0;
  const stop = (reason: string) => { if (r!.stop_reason !== reason) { r!.stop_reason = reason; ev(r!, now, "limit", reason); } };

  for (const it of pending) {
    if (ops >= OPS_PER_STEP) break;
    const res = await prepareItem(r, it, now, deps); if (res === "stop") break; if (res === "did") { ops++; did.push(`prepared ${it.repo}`); }
  }
  for (const c of fresh) {
    if (ops >= OPS_PER_STEP) break;
    const kind = c.verified ? (prepares(r) ? "draft" : null) : "verify";
    if (kind) { const g = gate(r, now, kind, true); if (!g.ok) { stop(g.reason); if (g.final) break; continue; } }
    else if (issuesStarted(r) >= r.limits.max_issues) { stop(`reached the limit of ${r.limits.max_issues} issue(s)`); break; }
    if (!(await store.claim(`witem:${r.id}:${c.assessment_id}`))) continue;
    const it: RunItem = { assessment_id: c.assessment_id, repo: c.repo, finding_id: c.finding_id, title: c.title, severity: c.severity, stage: c.verified ? "confirmed" : "verifying", fix_id: null, note: c.verified ? "already confirmed" : "", cost_usd: 0, started_at: iso(now), updated_at: iso(now) };
    r.items.push(it);
    if (!c.verified) {
      r.spent_usd += COST_USD.verify; it.cost_usd += COST_USD.verify; ops++;
      try {
        const v = await deps.verify(c.assessment_id);
        it.assessment_id = v.id; r.failures_in_row = 0;
        it.stage = v.verdict === "Not Affected" ? "not_affected" : v.verified ? "confirmed" : "unclear";
        it.note = v.verdict === "Not Affected" ? "not affected at the current commit" : v.verified ? "confirmed at the current commit" : "evidence incomplete: needs your review";
        did.push(`verified ${c.repo}: ${v.verdict}`);
      } catch (e) {
        if (refused(e)) { r.spent_usd -= COST_USD.verify; it.cost_usd -= COST_USD.verify; } else r.failures_in_row++;
        it.stage = "failed"; it.note = `verification ${refused(e) ? "not possible" : "failed"}: ${String((e as Error).message ?? e).slice(0, 160)}`;
      }
      it.updated_at = iso(now);
    }
    if (it.stage === "confirmed" && prepares(r) && ops < OPS_PER_STEP) {
      const res = await prepareItem(r, it, now, deps); if (res === "did") { ops++; did.push(`prepared ${it.repo}`); } if (res === "stop") break;
    }
  }

  // 5. Nothing left to do and nothing in flight: close early.
  const remaining = fresh.filter((c) => !r!.items.some((i) => i.finding_id === c.finding_id && i.repo === c.repo)).length + (prepares(r) ? r.items.filter((i) => i.stage === "confirmed" || (i.stage === "drafted" && i.retry)).length : 0);
  const blocked = !!r.stop_reason && /limit|budget|failures/.test(r.stop_reason);
  if (!r.items.some((i) => INFLIGHT.includes(i.stage)) && (remaining === 0 || blocked)) {
    if (!r.stop_reason) r.stop_reason = "no eligible findings left";
    return { run: await finalize(r, now, deps), did: [...did, "finalized"] };
  }
  await store.putRun(r);
  r = await store.getRun<WindowRun>(id) ?? r;
  return { run: r, did };
}

/** Draft a fix and start the isolated runner (preview mode) for a confirmed item. */
async function prepareItem(r: WindowRun, it: RunItem, now: number, deps: Deps): Promise<"did" | "skip" | "stop"> {
  if (!it.fix_id) {
    const g = gate(r, now, "draft", false); if (!g.ok) { if (r.stop_reason !== g.reason) { r.stop_reason = g.reason; ev(r, now, "limit", g.reason); } return g.final ? "stop" : "skip"; }
    r.spent_usd += COST_USD.draft; it.cost_usd += COST_USD.draft;
    try {
      const d = await deps.draft(it.assessment_id, r.user_id);
      it.fix_id = d.files ? d.fix_id : null; r.failures_in_row = 0;
      if (!d.files) { it.stage = "failed"; it.note = d.error ?? "no patch could be drafted"; it.updated_at = iso(now); return "did"; }
      it.stage = "drafted"; it.note = "patch drafted (not yet tested)";
    } catch (e) {
      if (refused(e)) { r.spent_usd -= COST_USD.draft; it.cost_usd -= COST_USD.draft; } else r.failures_in_row++;
      it.stage = "failed"; it.note = `drafting ${refused(e) ? "not possible" : "failed"}: ${String((e as Error).message ?? e).slice(0, 160)}`; it.updated_at = iso(now); return "did";
    }
    it.updated_at = iso(now);
  }
  const blocker = await deps.runnerBlocker(it.repo, r.user_id).catch((e) => String(e));
  if (blocker) { it.retry = false; it.note = `patch drafted; tests not run: ${blocker}`; it.updated_at = iso(now); return "did"; }
  const g = gate(r, now, "runner", false);
  if (!g.ok) { it.retry = !g.final && /in progress/.test(g.reason); it.note = `patch drafted; tests not started: ${g.reason}`; it.updated_at = iso(now); return g.final ? "stop" : "skip"; }
  r.spent_usd += COST_USD.runner; it.cost_usd += COST_USD.runner;
  it.retry = false;
  try { await deps.startRunner(it.fix_id!, r.id); it.stage = "running"; it.note = "fix running in the isolated runner (tests)"; r.failures_in_row = 0; }
  catch (e) { it.stage = "failed"; it.note = `runner could not start: ${String((e as Error).message ?? e).slice(0, 160)}`; r.failures_in_row++; }
  it.updated_at = iso(now);
  return "did";
}
