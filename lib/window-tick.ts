// Called from the 5-minute scheduler tick (app/api/poll/tick, QStash plus the GitHub Actions heartbeat backup): open
// remediation windows whose occurrence has started, then advance every active run by one bounded step. A deadline
// is enforced on the next tick after it passes (at most about 5 minutes late), and the runner margin (20 minutes)
// keeps new test jobs from starting close to the end.
import { store } from "./store";
import { startDueRuns, stepRun, type Deps } from "./window-run";

export async function windowsTick(deps: Deps, budgetMs = 150e3): Promise<{ opened: string[]; stepped: { id: string; did: string[] }[]; error?: string }> {
  const t0 = Date.now();
  const opened = await startDueRuns(deps);
  const stepped: { id: string; did: string[] }[] = [];
  for (const id of await store.activeRunIds()) {
    if (Date.now() - t0 > budgetMs) break; // the rest run on the next tick
    try { const r = await stepRun(id, deps); stepped.push({ id, did: r.did }); }
    catch (e) { stepped.push({ id, did: [`error: ${String((e as Error).message ?? e).slice(0, 160)}`] }); await store.log({ kind: "error", source: "window", detail: `step failed: ${String(e).slice(0, 160)}`, ref: id }); }
  }
  return { opened, stepped };
}
