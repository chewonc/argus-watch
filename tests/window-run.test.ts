// Remediation windows: the driver (lib/window-run.ts) with fake side effects. No network, no model, no GitHub.
// Covers budgets, limits, concurrency, deadlines, pause/cancel, repository scope, failures, duplicates, and the
// structural guarantee that windows cannot write to a repository.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { kv, store } from "../lib/store";
import { COST_USD, LEASE_MS, PR_TRIES, Precondition, controlRun, END_GRACE_MS, openRun, startDueRuns, stepRun, type Candidate, type Deps, type WindowRun } from "../lib/window-run";
import { WindowSchedule } from "../lib/window-schedule";

let seq = 0;
const T0 = Date.parse("2026-11-05T14:00:00Z"); // 23:00 KST
const sched = (x: Partial<WindowSchedule> = {}) => WindowSchedule.parse({ id: `s${Date.now().toString(36)}${seq++}`, user_id: `gh:${Date.now().toString(36)}${seq++}`, kind: "once", date: "2026-11-05", tz: "Asia/Seoul", start: "23:00", end: "07:00", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...x });
const cand = (id: string, x: Partial<Candidate> = {}): Candidate => ({ assessment_id: id, repo: "o/r", finding_id: `f-${id}`, title: id, severity: "high", verified: false, kev: false, ...x });

function fake(c: Candidate[], over: Partial<Deps> = {}) {
  const clock = { t: T0 };
  const calls = { verify: 0, draft: 0, runner: [] as string[], cancel: [] as string[], notify: 0, pr: [] as string[] };
  const prOutcome: { held: string | null } = { held: null };
  const fixes = new Map<string, { status: string; error: string | null; pr_url: null; dispatched_at: string | null }>();
  const stale = new Set<string>();
  const deps: Deps = {
    now: () => clock.t,
    activeRepos: async () => ["o/r", "o/s"],
    candidates: async () => c,
    verify: async (id) => { calls.verify++; return { id: `${id}:v`, verdict: "Affected", verified: true }; },
    draft: async (id) => { calls.draft++; return { fix_id: `fix-${id}`, files: 1, error: null }; },
    runnerBlocker: async () => null,
    startRunner: async (fixId) => { calls.runner.push(fixId); fixes.set(fixId, { status: "running", error: null, pr_url: null, dispatched_at: new Date(clock.t).toISOString() }); },
    // A running fake job keeps reporting a recent dispatch time unless a test says otherwise (the 45-minute runner timeout is tested separately).
    fixState: async (id) => { const f = fixes.get(id); return f ? { ...f, dispatched_at: f.status === "running" && !stale.has(id) ? new Date(clock.t - 60e3).toISOString() : f.dispatched_at } : null; },
    cancelFix: async (id) => { calls.cancel.push(id); const f = fixes.get(id); if (f) f.status = "cancelled"; },
    notify: async () => { calls.notify++; },
    openDraftPr: async (fixId) => { calls.pr.push(fixId); return prOutcome.held ? { ok: false as const, held: prOutcome.held } : { ok: true as const, pr_url: `https://github.com/o/r/pull/${calls.pr.length}` }; },
    ...over,
  };
  const step = async (id: string) => { const r = await stepRun(id, deps); clock.t += 60e3; return r; };
  return { deps, calls, clock, fixes, step, stale, prOutcome };
}
async function open(s: WindowSchedule, deps: Deps) { const [id] = await startDueRuns(deps, [s]); assert.ok(id, "a run opens"); return id; }
const get = (id: string) => store.getRun<WindowRun>(id) as Promise<WindowRun>;

test("one run per occurrence: a second scheduler call does not open another", async () => {
  const s = sched(); const { deps } = fake([]);
  assert.equal((await startDueRuns(deps, [s])).length, 1);
  assert.equal((await startDueRuns(deps, [s])).length, 0);
});

test("one active run per user: an overlapping schedule is recorded as skipped, not run", async () => {
  const a = sched(); const b = sched({ user_id: a.user_id }); const { deps } = fake([cand("x")]);
  await open(a, deps);
  const second = await openRun(b, { key: "k-overlap" + seq++, start_ms: T0, end_ms: T0 + 8 * 36e5 }, deps);
  assert.equal(second?.status, "cancelled"); assert.match(second!.stop_reason!, /already active/);
});

test("investigate only: findings are re-verified, nothing is drafted or run", async () => {
  const s = sched({ level: "investigate" }); const f = fake([cand("a"), cand("b", { verified: true })]);
  const id = await open(s, f.deps);
  const r = (await f.step(id)).run!;
  assert.equal(f.calls.verify, 1, "only the unconfirmed finding costs a verification");
  assert.equal(f.calls.draft, 0); assert.equal(f.calls.runner.length, 0);
  assert.equal(r.status, "completed"); assert.equal(r.report?.confirmed, 2); assert.equal(f.calls.notify, 1);
});

test("prepare: a confirmed finding gets a fix run in the isolated runner; the validated patch waits for review", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  let r = (await f.step(id)).run!;
  assert.equal(f.calls.runner.length, 1); assert.equal(r.items[0].stage, "running"); assert.equal(r.status, "running");
  f.fixes.get("fix-a")!.status = "validated";
  r = (await f.step(id)).run!;
  assert.equal(r.items[0].stage, "validated"); assert.equal(r.status, "completed");
  assert.equal(r.report?.validated, 1); assert.equal(r.report?.needs_review, 1); assert.equal(r.report?.prs_created, 0);
});

test("hard budget: an operation that would cross the cap never starts", async () => {
  const s = sched({ level: "investigate", budget_usd: 0.1 }); const f = fake([cand("a"), cand("b"), cand("c"), cand("d")]);
  const id = await open(s, f.deps);
  const r = (await f.step(id)).run!;
  assert.equal(f.calls.verify, Math.floor(0.1 / COST_USD.verify)); // 2
  assert.ok(r.spent_usd <= 0.1 + 1e-9); assert.match(r.stop_reason!, /budget/); assert.equal(r.status, "completed");
});

test("maximum issue count", async () => {
  const s = sched({ level: "investigate", max_issues: 1 }); const f = fake([cand("a"), cand("b")]);
  const r = (await f.step(await open(s, f.deps))).run!;
  assert.equal(r.items.length, 1); assert.match(r.stop_reason!, /limit of 1/);
});

test("maximum concurrent runner jobs: the second fix waits, then starts when a slot frees", async () => {
  const s = sched({ max_jobs: 1 }); const f = fake([cand("a", { verified: true }), cand("b", { verified: true })]);
  const id = await open(s, f.deps);
  let r = (await f.step(id)).run!;
  assert.equal(f.calls.runner.length, 1); assert.equal(r.items.filter((i) => i.stage === "drafted").length, 1);
  f.fixes.get("fix-a")!.status = "validated";
  r = (await f.step(id)).run!;
  assert.equal(f.calls.runner.length, 2); assert.deepEqual(f.calls.runner, ["fix-a", "fix-b"]);
});

test("no runner job starts with less than 20 minutes left", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  f.clock.t = (await get(id)).end_ms - 10 * 60e3;
  const r = (await f.step(id)).run!;
  assert.equal(f.calls.runner.length, 0); assert.match(r.items[0].note, /too little time/);
});

test("deadline, finish policy: in-flight jobs finish after the window, no new work starts, then the run closes", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  await f.step(id);
  f.clock.t = (await get(id)).end_ms + 60e3;
  let r = (await f.step(id)).run!;
  assert.equal(r.status, "finishing"); assert.equal(f.calls.cancel.length, 0);
  f.fixes.get("fix-a")!.status = "validated";
  r = (await f.step(id)).run!;
  assert.equal(r.status, "completed"); assert.equal(r.items[0].stage, "validated");
});

test("deadline, stop policy: in-flight jobs are cancelled at the deadline", async () => {
  const s = sched({ deadline: "stop" }); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  await f.step(id);
  f.clock.t = (await get(id)).end_ms;
  const r = (await f.step(id)).run!;
  assert.deepEqual(f.calls.cancel, ["fix-a"]); assert.equal(r.status, "completed"); assert.equal(r.items[0].stage, "cancelled");
});

test("deadline grace: a job still running 30 minutes after the end is cancelled and the run closes", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  await f.step(id);
  f.clock.t = (await get(id)).end_ms + END_GRACE_MS;
  const r = (await f.step(id)).run!;
  assert.deepEqual(f.calls.cancel, ["fix-a"]); assert.equal(r.items[0].stage, "timed_out"); assert.equal(r.status, "completed");
});

test("pause stops new work, resume continues, cancel stops in-flight jobs and closes the run", async () => {
  const s = sched({ max_jobs: 2 }); const f = fake([cand("a", { verified: true }), cand("b", { verified: true })], {});
  const id = await open(s, f.deps);
  await controlRun(id, s.user_id, "pause", f.deps);
  await f.step(id);
  assert.equal(f.calls.runner.length, 0, "paused: nothing starts");
  await controlRun(id, s.user_id, "resume", f.deps);
  await f.step(id);
  assert.equal(f.calls.runner.length, 2);
  const r = await controlRun(id, s.user_id, "cancel", f.deps);
  assert.equal(r.status, "cancelled"); assert.equal(f.calls.cancel.length, 2); assert.equal(f.calls.notify, 1);
  await assert.rejects(controlRun(id, "gh:someone-else", "cancel", f.deps), /not found/, "another user cannot control the run");
});

test("repository scope: a repository the user no longer monitors is dropped mid-run", async () => {
  const s = sched({ level: "investigate" }); const repos = ["o/r", "o/s"];
  const f = fake([cand("a", { repo: "o/s" }), cand("b", { repo: "o/r" })], { activeRepos: async () => repos });
  const id = await open(s, f.deps);
  repos.splice(1, 1); // o/s removed (paused, access lost or uninstalled)
  const r = (await f.step(id)).run!;
  assert.deepEqual(r.repos, ["o/r"]); assert.deepEqual(r.items.map((i) => i.repo), ["o/r"]);
  assert.ok(r.events.some((e) => e.kind === "scope"));
});

test("three consecutive failures stop new work; each failure is recorded", async () => {
  const s = sched({ level: "investigate" });
  const f = fake([cand("a"), cand("b"), cand("c"), cand("d")], { verify: async () => { throw new Error("model down"); } });
  const id = await open(s, f.deps);
  let r = (await f.step(id)).run!;
  assert.equal(r.items.filter((i) => i.stage === "failed").length, 3);
  r = (await f.step(id)).run!;
  assert.equal(r.items.length, 3, "no fourth attempt"); assert.equal(r.status, "completed"); assert.match(r.stop_reason!, /failures/);
});

test("a runner that never reports back is marked timed out after 45 minutes", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  await f.step(id);
  f.stale.add("fix-a"); f.clock.t += 46 * 60e3;
  const r = (await f.step(id)).run!;
  assert.equal(r.items[0].stage, "timed_out");
});

test("concurrent steps: only one caller works on a run in the same minute", async () => {
  const s = sched({ level: "investigate" }); const f = fake([cand("a")]);
  const id = await open(s, f.deps);
  const [x, y] = await Promise.all([stepRun(id, f.deps), stepRun(id, f.deps)]);
  assert.equal([x.did, y.did].filter((d) => d.includes("busy")).length, 1);
  assert.equal(f.calls.verify, 1);
});

test("runner unavailable: the patch is drafted and held, tests are not claimed", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })], { runnerBlocker: async () => "the isolated test runner is not configured on this deployment" });
  const r = (await f.step(await open(s, f.deps))).run!;
  assert.equal(r.items[0].stage, "drafted"); assert.match(r.items[0].note, /tests not run/); assert.equal(r.status, "completed");
});

test("a step refused before doing any work (deployment switch off) is not charged and does not count as a failure", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true }), cand("b", { verified: true })], { draft: async () => { throw new Precondition("automated fixes are turned off on this deployment"); } });
  const r = (await f.step(await open(s, f.deps))).run!;
  assert.equal(r.spent_usd, 0); assert.equal(r.failures_in_row, 0); assert.match(r.items[0].note, /not possible/);
});

test("the report shows test results and the re-check of the patched code", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })], {});
  const base = f.deps.fixState;
  f.deps.fixState = async (id) => { const st = await base(id); return st && st.status === "validated" ? { ...st, tests: "3 of 3 tests passed", recheck: "predicted Not Affected (supported)" } : st; };
  const id = await open(s, f.deps);
  await f.step(id); f.fixes.get("fix-a")!.status = "validated";
  const r = (await f.step(id)).run!;
  assert.match(r.items[0].note, /3 of 3 tests passed; re-check of the patched code: predicted Not Affected/);
});

test("quiet windows: while one runs, only critical alerts push", async () => {
  const { quietWindow } = await import("../lib/notify");
  const s = sched({ quiet: true }); const f = fake([]);
  const id = await open(s, f.deps);
  assert.equal(await quietWindow(s.user_id), true);
  await controlRun(id, s.user_id, "cancel", f.deps);
  assert.equal(await quietWindow(s.user_id), false, "after the window, alerts push normally");
  const loud = sched({ quiet: false }); await open(loud, f.deps);
  assert.equal(await quietWindow(loud.user_id), false);
  assert.match(readFileSync("lib/notify.ts", "utf8"), /severity\.level !== "critical" && \(await quietWindow\(t\.uid\)\)/);
});

test("below the draft-PR level a window never asks for a pull request", async () => {
  const s = sched(); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  await f.step(id); f.fixes.get("fix-a")!.status = "validated";
  const r = (await f.step(id)).run!;
  assert.equal(f.calls.pr.length, 0); assert.equal(r.items[0].stage, "validated"); assert.equal(r.report?.prs_created, 0);
  assert.match(readFileSync("lib/window-deps.ts", "utf8"), /startRun\(\{ \.\.\.fix, window_run_id: runId \}, a, "preview"/, "the runner itself never writes");
});

test("draft-PR level: one attempt per validated patch; success is reported, a held patch waits for review", async () => {
  const s = sched({ level: "draft_pr", max_jobs: 2 }); const f = fake([cand("a", { verified: true }), cand("b", { verified: true })]);
  const id = await open(s, f.deps);
  await f.step(id);
  f.fixes.get("fix-a")!.status = "validated";
  let r = (await f.step(id)).run!;
  assert.deepEqual(f.calls.pr, ["fix-a"]); assert.equal(r.items.find((i) => i.fix_id === "fix-a")!.stage, "pr_created");
  f.prOutcome.held = "GitHub reports your permission on this repository is now \"read\", not write";
  f.fixes.get("fix-b")!.status = "validated";
  r = (await f.step(id)).run!;
  const b = r.items.find((i) => i.fix_id === "fix-b")!;
  assert.equal(b.stage, "validated"); assert.match(b.note, /held for your review: GitHub reports/);
  await f.step(id);
  assert.equal(f.calls.pr.length, 2, "a held patch is not retried");
  assert.equal(r.status, "completed"); assert.equal(r.report?.prs_created, 1); assert.equal(r.report?.needs_review, 2);
});

test("draft-PR level: a patch validated after the window ends is held, not opened", async () => {
  const s = sched({ level: "draft_pr" }); const f = fake([cand("a", { verified: true })]);
  const id = await open(s, f.deps);
  await f.step(id);
  f.clock.t = (await get(id)).end_ms + 60e3; f.fixes.get("fix-a")!.status = "validated";
  const r = (await f.step(id)).run!;
  assert.equal(f.calls.pr.length, 0); assert.equal(r.items[0].stage, "validated");
});

// ---- Regression tests for the audit findings ----

test("audit 1: a step never runs while another holds the run's lease; an expired lease is taken over", async () => {
  const s = sched({ level: "investigate" }); const f = fake([cand("a")]);
  const id = await open(s, f.deps);
  await kv.set(`wlease:${id}`, f.clock.t + LEASE_MS); // another step is working on this run
  assert.deepEqual((await stepRun(id, f.deps)).did, ["busy"]); assert.equal(f.calls.verify, 0);
  f.clock.t += LEASE_MS + 1; // that step died without releasing
  await stepRun(id, f.deps);
  assert.equal(f.calls.verify, 1, "the expired lease was taken over");
});

test("audit 2: a cancel that arrives during a step is applied by that step and cannot be undone", async () => {
  const s = sched({ level: "investigate" }); const f = fake([cand("a"), cand("b")]);
  const id = await open(s, f.deps);
  await kv.set(`wlease:${id}`, f.clock.t + LEASE_MS); // a step is in progress
  const queued = await controlRun(id, s.user_id, "cancel", f.deps);
  assert.equal(queued.status, "running", "queued, not yet applied");
  await kv.del(`wlease:${id}`);
  const r = (await stepRun(id, f.deps)).run!;
  assert.equal(r.status, "cancelled"); assert.equal(f.calls.verify, 0, "no new work after the cancel");
  assert.equal((await get(id)).status, "cancelled");
  assert.equal((await stepRun(id, f.deps)).run!.status, "cancelled", "stays cancelled");
});

test("audit 3: an item left mid-check by a crashed step is closed after the grace period, so the run always finishes", async () => {
  const s = sched({ level: "investigate" }); const f = fake([]);
  const id = await open(s, f.deps);
  const r0 = await get(id);
  r0.items.push({ assessment_id: "x", repo: "o/r", finding_id: "fx", title: "x", severity: "high", stage: "verifying", fix_id: null, note: "", cost_usd: 0.04, started_at: "", updated_at: "" });
  await store.putRun(r0);
  f.clock.t = r0.end_ms + 60e3;
  assert.equal((await f.step(id)).run!.status, "finishing");
  f.clock.t = r0.end_ms + 31 * 60e3;
  const r = (await f.step(id)).run!;
  assert.equal(r.status, "completed"); assert.equal(r.items[0].stage, "timed_out");
});

test("audit 4: a failed findings lookup does not end the window as 'nothing left'", async () => {
  const s = sched({ level: "investigate" });
  let fail = true;
  const f = fake([cand("a")], { candidates: async () => { if (fail) throw new Error("store unavailable"); return [cand("a")]; } });
  const id = await open(s, f.deps);
  let r = (await f.step(id)).run!;
  assert.equal(r.status, "running"); assert.equal(r.failures_in_row, 1);
  fail = false;
  r = (await f.step(id)).run!;
  assert.equal(f.calls.verify, 1); assert.equal(r.status, "completed");
});

test("audit 10: a pull request that failed for a temporary reason is retried, up to a limit", async () => {
  const s = sched({ level: "draft_pr" });
  const f = fake([cand("a", { verified: true })], { openDraftPr: async () => ({ ok: false as const, held: "a check could not be completed (502)", transient: true }) });
  const id = await open(s, f.deps);
  await f.step(id); f.fixes.get("fix-a")!.status = "validated";
  for (let i = 0; i < PR_TRIES + 2; i++) await f.step(id);
  const it = (await get(id)).items[0];
  assert.equal(it.pr_tries, PR_TRIES); assert.equal(it.pr_tried, true); assert.match(it.note, /held for your review/);
});

test("audit 12: two windows opening at once for the same user: only one runs", async () => {
  const a = sched(); const b = sched({ user_id: a.user_id }); const { deps } = fake([]);
  const [x, y] = await Promise.all([
    openRun(a, { key: `ka${seq++}`, start_ms: T0, end_ms: T0 + 36e5 }, deps),
    openRun(b, { key: `kb${seq++}`, start_ms: T0, end_ms: T0 + 36e5 }, deps),
  ]);
  assert.equal([x, y].filter((r) => r?.status === "running").length, 1);
});
