// Pure rules about GitHub state (no SDK imports, so they are unit-testable).
import type { Fix } from "./schema";

/** Does an installation's permission set allow this write? Branch pushes need contents; pull requests also need pull_requests. */
export const installationCanWrite = (p: Record<string, string>, mode: "pr" | "branch" | "push") => p.contents === "write" && (mode === "branch" || p.pull_requests === "write");

/** What a pull request's GitHub state means for the fix record. Only a real merge marks the fix merged. */
export function pullOutcome(fix: Pick<Fix, "status">, pr: { merged: boolean; merge_commit_sha: string | null; state: string; html_url: string }): { status: "merged"; merge_sha: string | null } | { closed: true } | null {
  if (fix.status === "merged") return null;
  if (pr.merged) return { status: "merged", merge_sha: pr.merge_commit_sha };
  if (pr.state === "closed") return { closed: true };
  return null;
}
