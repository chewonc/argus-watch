// Plain-language description of a pipeline log entry for the Activity log (null = not shown to users).
import type { LogEntry } from "./schema";

export function describe(l: LogEntry): string | null {
  const d = l.detail;
  if (l.kind === "alert") return "New issue detected";
  if (l.kind === "fix") return /pr|pull/i.test(d) ? "Fix pull request opened" : "Fix prepared";
  if (l.kind === "notify") return "Notification sent";
  if (l.kind === "webhook") return /push/.test(d) ? "Repository updated" : /security_advisory/.test(d) ? "New security advisory received" : /installation/.test(d) ? "GitHub connection changed" : null;
  if (l.kind === "process") return /new finding/.test(d) ? "New security report found" : /not relevant|no watched repo/.test(d) ? "Security check completed: doesn't affect your repositories" : /assessed/.test(d) ? "Security check completed" : null;
  if (l.kind === "replay") return "Security check re-run";
  if (l.kind === "poll") return "Checked security news sources";
  if (l.kind === "error") return "A check failed and will be retried";
  return null;
}
