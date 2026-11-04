// Approve-the-exact-patch and cancellation for automated remediation, kept free of the GitHub client so the rules are
// unit-testable. lib/runner.ts re-exports these and adds the GitHub write (approveValidated -> applyFix).
import { createHash } from "node:crypto";
import { env } from "./env";
import { USER_AGENT } from "./ua";
import { RunnerError, event } from "./runner-gates";
import type { Fix } from "./schema";
import { store } from "./store";
import { revoke } from "./write-auth";

const now = () => new Date().toISOString();

/** Version of a patch: changes whenever any path or content changes (lockfiles included). */
export function patchVersion(files: Pick<Fix["files"][number], "path" | "after">[]): string {
  return createHash("sha256").update(files.map((x) => `${x.path}\n${x.after}`).sort().join("\n\u0000\n")).digest("hex").slice(0, 16);
}

/** Throws unless the fix holds a validated patch whose stored files still match the version the user reviewed. */
export function checkApprovable(fix: Pick<Fix, "status" | "patch_version" | "files">, reviewedVersion: string): void {
  if (fix.status !== "validated") throw new RunnerError(`nothing to approve: the fix is ${fix.status}`, 409);
  if (!fix.patch_version || reviewedVersion !== fix.patch_version || patchVersion(fix.files) !== fix.patch_version) throw new RunnerError("the patch changed since you reviewed it; review the current patch and approve again", 409);
}

/** Which states the user can still stop, and what stopping means there. */
export function cancellable(fix: Pick<Fix, "status">): { ok: boolean; why: string } {
  if (fix.status === "queued" || fix.status === "running") return { ok: true, why: "Stops the isolated runner; nothing has been written to your repository." };
  if (fix.status === "validated") return { ok: true, why: "Discards the validated patch; nothing has been written to your repository." };
  if (fix.status === "merging") return { ok: true, why: "Cancels the automatic merge; the pull request stays open for you." };
  if (fix.status === "approved") return { ok: false, why: "The pull request is being created right now and can no longer be stopped; close it on GitHub if you change your mind." };
  return { ok: false, why: `Nothing is running (the fix is ${fix.status}).` };
}

/** Cancel in the backend: revoke the runner's credential (no brief, no result accepted), stop the Actions run when its id is known, or stop an automatic merge. */
export async function cancelRun(fix: Fix, userLogin: string): Promise<Fix> {
  const c = cancellable(fix);
  if (!c.ok) throw new RunnerError(c.why, 409);
  // Record the cancellation first: any approval issued before this moment is void at the write boundary, even if a
  // concurrent request rewrites the fix record afterwards. A write GitHub already completed is not undone by this.
  await store.setCancelledAt(fix.id, now());
  await import("./agent-token").then((m) => m.revokeRunnerTokens(fix.user_id, fix.id)).catch(() => {});
  if (fix.status === "merging") {
    const next = event({ ...fix, status: "pr_created", grant: revoke(fix.grant) }, userLogin, "merge_cancelled", "automatic merge cancelled by the user; the pull request stays open");
    await store.putFix(next);
    return next;
  }
  let actions = "no Actions run id known yet; the runner's credential is revoked, so it cannot fetch the repository or report a result";
  const runId = /\/actions\/runs\/(\d+)/.exec(fix.runner?.run_url ?? "")?.[1];
  if (runId && env.RUNNER_DISPATCH_TOKEN) {
    const r = await fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/runs/${runId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${env.RUNNER_DISPATCH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": USER_AGENT } }).catch(() => null);
    actions = r?.status === 202 ? `GitHub Actions run ${runId} cancelled` : r?.status === 409 ? `GitHub Actions run ${runId} had already finished` : `could not cancel GitHub Actions run ${runId} (${r?.status ?? "network error"}); its credential is revoked, so it cannot write`;
  }
  const next = event({ ...fix, status: "cancelled", nonce_hash: null, grant: revoke(fix.grant), error: "cancelled by the user", runner: fix.runner ? { ...fix.runner, finished_at: now(), error: "cancelled by the user" } : fix.runner }, userLogin, "cancelled", `${c.why} ${actions}.`);
  await store.putFix(next);
  await store.log({ kind: "fix", source: "runner", detail: `cancelled by ${userLogin}: ${actions}`, ref: fix.assessment_id });
  return next;
}
