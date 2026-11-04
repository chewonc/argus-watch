// POST {groups: [{fix_ids, patch_versions}], mode} — the user's explicit approval of the listed repository operations
// after reviewing the exact patches. One operation per group: a single fix, or a combined patch for compatible fixes in
// one repository (lib/bulk.ts groupFixes decides compatibility again here; the client's grouping is not trusted).
// Every group passes the same checks as a single approval (owner, not demo, changes allowed, App write permission, the
// user's own GitHub push permission) and gets its own approval grant bound to repository, base commit, exact combined
// patch hash and destination (lib/write-auth.ts). Groups are independent: one failure never blocks the others.
// Nothing is merged.
import { randomBytes } from "node:crypto";
import { assertUserCanWrite } from "@/lib/access";
import { ownFix } from "@/lib/authz";
import { groupFixes } from "@/lib/bulk";
import { env, hasGitHubApp } from "@/lib/env";
import { applyFix } from "@/lib/fix-apply";
import { installationPermissions } from "@/lib/github-app";
import { notifyFix } from "@/lib/notify";
import { patchVersion } from "@/lib/remediation-control";
import { writeModeFor } from "@/lib/remediation-mode";
import { event } from "@/lib/runner-gates";
import type { Fix } from "@/lib/schema";
import { currentUser, githubUserToken, isSystemRepo } from "@/lib/session";
import { store } from "@/lib/store";
import { recordApproval, revoke, WriteAuthError } from "@/lib/write-auth";

export const maxDuration = 300;
type GroupIn = { fix_ids?: unknown; patch_versions?: unknown };
type GroupOut = { fix_ids: string[]; ok: boolean; url?: string | null; branch?: string | null; error?: string };

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!env.FIX_ENABLED) return Response.json({ error: "Automated fixes are turned off on this deployment." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { groups?: GroupIn[]; mode?: unknown };
  const wm = writeModeFor(body.mode);
  if (!wm.ok) return Response.json({ error: wm.error }, { status: 409 });
  const mode = wm.mode as "pr" | "branch";
  const token = await githubUserToken();
  const results: GroupOut[] = [];
  for (const g of (body.groups ?? []).slice(0, 20)) {
    const ids = Array.isArray(g.fix_ids) ? g.fix_ids.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    const versions = Array.isArray(g.patch_versions) ? g.patch_versions : [];
    try { results.push({ fix_ids: ids, ...(await approveGroup(user, ids, versions, mode, token)) }); }
    catch (e) { results.push({ fix_ids: ids, ok: false, error: (e as Error).message }); }
  }
  return Response.json({ results });
}

async function approveGroup(user: { id: string; login: string }, ids: string[], versions: unknown[], mode: "pr" | "branch", token: string | null): Promise<Omit<GroupOut, "fix_ids">> {
  if (!ids.length) throw new WriteAuthError("empty group", 400);
  const fixes: Fix[] = [];
  for (const [i, id] of ids.entries()) {
    const f = await ownFix(user.id, id); // never another user's fix
    if (!f) throw new WriteAuthError("A fix in this group was not found.", 404);
    if (f.status !== "validated" && f.status !== "drafted") throw new WriteAuthError(`A fix in this group is ${f.status}; review it again.`, 409);
    if (!f.patch_version || versions[i] !== f.patch_version || patchVersion(f.files) !== f.patch_version) throw new WriteAuthError("A patch changed since you reviewed it; review again.", 409);
    fixes.push(f);
  }
  const groups = groupFixes(fixes);
  if (groups.length !== 1) throw new WriteAuthError("These fixes can't be combined safely (same files or different commits); approve them separately.", 409);
  const repoKey = fixes[0].repo_key;
  if (await isSystemRepo(repoKey)) throw new WriteAuthError("Shared demo repositories never receive changes.");
  const ur = await store.getUserRepo(user.id, repoKey);
  if (!ur?.allow_pr) throw new WriteAuthError("Changes are not enabled for this repository (Settings → Repositories).");
  const w = await store.getRepo(repoKey);
  const inst = w?.installation_id ?? ur.installation_id;
  if (!hasGitHubApp() || !inst) throw new WriteAuthError("This repository is not connected through the GitHub App.");
  const p = await installationPermissions(inst).catch(() => ({} as Record<string, string>));
  if (p.contents !== "write" || (mode === "pr" && p.pull_requests !== "write")) throw new WriteAuthError("The GitHub App installation lacks write permission.");
  await assertUserCanWrite(token, repoKey);
  const a = await store.getAssessment(fixes[0].assessment_id);
  if (!a) throw new WriteAuthError("Finding missing.", 404);
  const f = await store.getFinding(a.finding_id);
  const defaultBranch = w?.default_branch ?? "main";
  const okStatus = (x: Fix, v: string) => {
    if (x.status !== "validated" && x.status !== "drafted") throw new WriteAuthError(`fix is ${x.status}`, 409);
    if (!x.patch_version || v !== x.patch_version || patchVersion(x.files) !== x.patch_version) throw new WriteAuthError("the patch changed since you reviewed it", 409);
  };

  // One fix: approve and write it directly. Several compatible fixes: one combined record, approved and written once.
  let target = fixes[0];
  if (fixes.length > 1) {
    const files = fixes.flatMap((x) => x.files);
    target = { ...fixes[0], id: randomBytes(12).toString("hex"), status: "validated", files, patch_version: patchVersion(files), grant: null, events: [], pr_url: null, pr_number: null, branch: null, error: null,
      summary: `Combined fix for ${fixes.length} findings in one repository: ${fixes.map((x) => x.summary.split(/[.\n]/)[0]).join("; ").slice(0, 600)}`, created_at: new Date().toISOString() };
    target = event(target, user.login, "bundled", `combined from fixes ${fixes.map((x) => x.id.slice(0, 8)).join(", ")}`);
    await store.putFix(target, true);
  }
  const approved = await recordApproval(target.id, { userId: user.id, userLogin: user.login, reviewedVersion: target.patch_version!, action: mode, defaultBranch, check: okStatus, event, detail: fixes.length > 1 ? `approved a combined patch for ${fixes.length} findings` : "approved in a bulk fix" });
  try {
    const done = await applyFix({ ...approved, mode }, a, f, inst, { openPr: mode !== "branch" });
    for (const m of fixes.length > 1 ? fixes : []) {
      await store.putFix(event({ ...m, status: done.status, pr_url: done.pr_url, pr_number: done.pr_number, pr_draft: done.pr_draft, branch: done.branch, commit_url: done.commit_url, mode }, "argus", "included", `included in ${done.pr_url ? `pull request #${done.pr_number}` : `branch ${done.branch}`}`, done.pr_url ?? done.commit_url));
    }
    if (done.pr_number) await notifyFix(user.id, "fix_pr_created", a, f, `${done.repo}#${done.pr_number}`).catch(() => {});
    return { ok: true, url: done.pr_url ?? done.commit_url, branch: done.branch };
  } catch (e) {
    const fresh = (await store.getFix(target.id)) ?? approved;
    await store.putFix(event({ ...fresh, status: fresh.status === "cancelled" ? "cancelled" : "failed", error: String((e as Error).message).slice(0, 300), grant: revoke(fresh.grant) }, "argus", "write_failed", String((e as Error).message).slice(0, 200)));
    throw e;
  }
}
