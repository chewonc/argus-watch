// One definition of a stalled remediation run, shared by the run route (may re-authorize), the Muse Code panel
// (shows the authorize buttons again) and the finding actions (shows "Fix stalled" + Retry instead of "in progress").
// A run is stalled when the runner never reported back: still "queued" 20 minutes after it was dispatched.
// Dependency-free so client components can import it.
import type { Fix } from "./schema";

export const STALE_RUN_MS = 20 * 60e3;
export function isStaleRun(fix: Pick<Fix, "status" | "runner" | "approved_at" | "created_at">, now = Date.now()): boolean {
  return fix.status === "queued" && now - Date.parse(fix.runner?.dispatched_at ?? fix.approved_at ?? fix.created_at) > STALE_RUN_MS;
}
