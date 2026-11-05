// Write authorization: the single server-side gate in front of every write to a user's repository.
//
// An approval produces a Grant bound to: user, repository (owner/name), base commit, exact patch (patch_version = hash of
// every path + content), allowed files, action ("pr" | "branch", plus "merge" only when separately chosen), destination
// branch, and an expiry. The grant is stored on the fix. The write boundary (lib/fix-apply.ts applyFix, lib/runner.ts
// tryMerge) re-reads the fix from the store and calls assertWrite() immediately before writing, so a client, a retry, a
// background job or an MCP agent cannot write without a live grant that matches exactly what is about to be written.
//   - single use: each (grant, operation) is claimed atomically (store.claim → KV SETNX); a replay finds the claim taken
//   - revocable: cancel sets revoked_at; a write that has not reached the boundary is refused
//   - time-limited: create-branch/PR within GRANT_TTL of approval; merge only within MERGE_TTL and only if action allows it
//   - least scope: a PR grant never authorizes a merge; a branch grant never names the default branch
// Pure checks are exported for unit tests; GitHub is never called from this module.
import { randomBytes } from "node:crypto";
import { patchVersion } from "./remediation-control";
import type { Fix } from "./schema";
import { store } from "./store";

export const GRANT_TTL_MS = 10 * 60e3;
export const MERGE_TTL_MS = 45 * 60e3;

export type GrantAction = "pr" | "branch" | "pr_then_merge";
export type Grant = NonNullable<Fix["grant"]>;
export type WriteOp = "create_branch" | "create_pr" | "merge";

export class WriteAuthError extends Error { constructor(message: string, readonly status = 403) { super(message); } }

/** Destination branch for a fix. Fixed by the fix id, never chosen by the client. */
import { fixBranch } from "./fix-branch";
export { fixBranch };

/** Issue a grant for the exact patch the user reviewed. Callers have already authenticated the user and checked repository permission. */
export function issueGrant(fix: Fix, input: { userId: string; userLogin: string; action: GrantAction; defaultBranch: string; now?: number }): Grant {
  const now = input.now ?? Date.now();
  if (fix.user_id !== input.userId) throw new WriteAuthError("only the user who started this fix can approve it");
  if (!fix.files.length) throw new WriteAuthError("there is no patch to approve", 409);
  const pv = patchVersion(fix.files);
  if (fix.patch_version && fix.patch_version !== pv) throw new WriteAuthError("the patch changed since it was prepared; review it again", 409);
  const dest = fixBranch(fix.id);
  if (dest === input.defaultBranch) throw new WriteAuthError("the destination would be the default branch", 409);
  return {
    id: randomBytes(12).toString("base64url"), user_id: input.userId, approved_by: input.userLogin, repo: repoOf(fix), base_sha: fix.base_sha,
    patch_version: pv, files: fix.files.map((x) => x.path).sort(), action: input.action, branch: dest, base_branch: input.defaultBranch,
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + GRANT_TTL_MS).toISOString(),
    merge_expires_at: input.action === "pr_then_merge" ? new Date(now + MERGE_TTL_MS).toISOString() : null, revoked_at: null,
  };
}

const repoOf = (fix: Pick<Fix, "repo">) => fix.repo.split("/").slice(0, 2).join("/");

/**
 * The write boundary's check. Throws unless the stored fix carries a live grant that authorizes exactly this operation
 * on exactly these files, this repository, this base commit and this branch.
 */
export function checkWrite(fix: Fix, op: { kind: WriteOp; repo: string; branch: string; baseBranch?: string; files?: { path: string; after: string }[] }, now = Date.now(), cancelledAt: string | null = null): Grant {
  const g = fix.grant;
  if (!g) throw new WriteAuthError("no approval on record for this change");
  if (g.revoked_at) throw new WriteAuthError("the approval was revoked");
  // A cancellation recorded at or after the approval voids it, even if a concurrent request rewrote the fix status.
  if (cancelledAt && Date.parse(cancelledAt) >= Date.parse(g.issued_at)) throw new WriteAuthError("the fix was cancelled after this approval");
  if (fix.status === "cancelled") throw new WriteAuthError("the fix was cancelled");
  if (g.user_id !== fix.user_id) throw new WriteAuthError("the approval belongs to a different user");
  if (op.repo.split("/").slice(0, 2).join("/") !== g.repo || repoOf(fix) !== g.repo) throw new WriteAuthError("the approval is for a different repository");
  if (fix.base_sha !== g.base_sha) throw new WriteAuthError("the base commit changed since approval");
  if (op.branch !== g.branch || op.branch === g.base_branch) throw new WriteAuthError("the destination branch is not the approved one");
  if (op.kind === "merge") {
    if (g.action !== "pr_then_merge") throw new WriteAuthError("the approval does not include merging");
    if (!g.merge_expires_at || Date.parse(g.merge_expires_at) <= now) throw new WriteAuthError("the merge approval expired");
    return g;
  }
  if (Date.parse(g.expires_at) <= now) throw new WriteAuthError("the approval expired; review and approve again");
  if (op.kind === "create_pr" && g.action === "branch") throw new WriteAuthError("the approval is for a branch push, not a pull request");
  if (op.kind === "create_pr" && op.baseBranch !== g.base_branch) throw new WriteAuthError("the pull request target is not the approved one");
  const files = op.files ?? [];
  if (patchVersion(files) !== g.patch_version || patchVersion(fix.files) !== g.patch_version) throw new WriteAuthError("the patch differs from the approved patch");
  const allowed = new Set(g.files);
  for (const f of files) if (!allowed.has(f.path)) throw new WriteAuthError(`${f.path} is not in the approved files`);
  return g;
}

/**
 * checkWrite against the freshest stored record, then claim the operation once (atomic). Use immediately before the
 * GitHub call. Returns the grant; a second caller (double click, retry, replay) gets "already used".
 */
export async function assertWrite(fixId: string, op: Parameters<typeof checkWrite>[1]): Promise<Grant> {
  const fresh = await store.getFix(fixId);
  if (!fresh) throw new WriteAuthError("fix not found", 404);
  const g = checkWrite(fresh, op, Date.now(), await store.cancelledAt(fixId));
  if (!(await store.claim(`write:${g.id}:${op.kind}`))) throw new WriteAuthError("this approval was already used for that operation", 409);
  return g;
}

/** Re-check (no claim) between irreversible steps: a cancellation that lands mid-write stops the remaining steps. */
export async function stillAllowed(fixId: string, op: Parameters<typeof checkWrite>[1]): Promise<void> {
  const fresh = await store.getFix(fixId);
  if (!fresh) throw new WriteAuthError("fix not found", 404);
  checkWrite(fresh, op, Date.now(), await store.cancelledAt(fixId));
}

/** Revoke: future writes under this grant are refused. Does not undo a write GitHub already completed. */
export const revoke = (g: Grant | null | undefined, now = Date.now()): Grant | null => (g ? { ...g, revoked_at: g.revoked_at ?? new Date(now).toISOString() } : null);

/**
 * Record the user's approval atomically: re-read the fix, require the exact reviewed patch version, claim this approval
 * once (a double click or a concurrent cancel cannot both win), then store status "approved" with a fresh grant.
 * check: the per-path rule for what may be approved (remediation-control checkApprovable for runner patches).
 */
export async function recordApproval(fixId: string, input: { userId: string; userLogin: string; reviewedVersion: string; action: GrantAction; defaultBranch: string; check: (f: Fix, v: string) => void; detail: string; event: (f: Fix, actor: string, action: string, detail: string) => Fix }): Promise<Fix> {
  const fresh = await store.getFix(fixId);
  if (!fresh) throw new WriteAuthError("fix not found", 404);
  input.check(fresh, input.reviewedVersion);
  if (!(await store.claim(`approve:${fresh.id}:${fresh.events.length}:${fresh.status}`))) throw new WriteAuthError("this patch is already being approved", 409);
  const grant = issueGrant(fresh, input);
  const next = input.event({ ...fresh, status: "approved", approved_at: grant.issued_at, grant }, input.userLogin, "approved",
    `${input.detail}; approval ${grant.id.slice(0, 6)} for patch ${grant.patch_version} → ${grant.action === "branch" ? `branch ${grant.branch}` : `${grant.action === "pr_then_merge" ? "pull request, merge after CI" : "draft pull request"} from ${grant.branch} into ${grant.base_branch}`}, valid until ${grant.expires_at}`);
  await store.putFix(next);
  return next;
}
