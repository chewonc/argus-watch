// Apply an approved fix: new branch + commit via the Git Data API (no clone) and a DRAFT pull request.
// Routes check session, fix owner, per-repo allow_pr and the App installation; this function additionally refuses to
// write unless the stored fix carries the user's live approval grant for exactly this patch and destination
// (lib/write-auth.ts), checked right before the branch is created and again before the pull request is opened.
// The default branch is never written; nothing is merged here; CI results are read, never triggered.
import { env, hasQStash } from "./env";
import { scopedRepoOctokit } from "./github-app";
import { prText } from "./fix";
import { assertWrite, fixBranch, stillAllowed } from "./write-auth";
import type { Assessment, Finding, Fix } from "./schema";
import { store } from "./store";

export type ApplyOpts = { draft?: boolean; author?: string; testsNote?: string; openPr?: boolean };
export async function applyFix(fix: Fix, a: Assessment, f: Finding | null, installationId: number, opts: ApplyOpts = {}): Promise<Fix> {
  const draft = opts.draft ?? true;
  const [owner, repo] = fix.repo.split("/");
  const w = await store.getRepo(fix.repo_key);
  const base = w?.default_branch ?? "main";
  const branch = fixBranch(fix.id);
  const files = fix.files.map((x) => ({ path: x.path, after: x.after }));
  const target = { repo: fix.repo, branch, baseBranch: base, files };
  // 0. approval must be live before any write-capable token is even requested
  await stillAllowed(fix.id, { kind: "create_branch", ...target });
  // Token limited to this repository and to what this write needs (no pull_requests permission for a branch push).
  const ok = await scopedRepoOctokit(installationId, repo, opts.openPr === false ? { contents: "write", metadata: "read" } : { contents: "write", pull_requests: "write", metadata: "read" });
  // 1. head of the default branch; refuse if any cited file changed since the analysis
  const { data: ref } = await ok.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
  const headSha = ref.object.sha;
  if (headSha !== fix.base_sha) {
    for (const file of fix.files) {
      const { data } = await ok.rest.repos.getContent({ owner, repo, path: file.path, ref: headSha });
      const sha = (data as { sha?: string }).sha;
      if (sha !== file.before_sha) throw Object.assign(new Error(`${file.path} changed on ${base} since the analysis (${fix.base_sha.slice(0, 7)} → ${headSha.slice(0, 7)}); re-run the analysis before applying`), { status: 409 });
    }
  }
  const { data: headCommit } = await ok.rest.git.getCommit({ owner, repo, commit_sha: headSha });
  // 2. blobs → tree → commit → ref
  const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  for (const file of fix.files) { const { data: blob } = await ok.rest.git.createBlob({ owner, repo, content: file.after, encoding: "utf-8" }); tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha }); }
  const { data: newTree } = await ok.rest.git.createTree({ owner, repo, base_tree: headCommit.tree.sha, tree });
  const pt = prText(fix, a, f, env.APP_URL);
  const title = pt.title;
  const body = opts.author ? `> Changes made by **${opts.author}** in an isolated runner and validated by Argus Watch before this write.
> ${opts.testsNote ?? ""}
> Audit trail: ${(fix.events ?? []).map((e) => `${e.at} ${e.actor} ${e.action}`).join(" · ")}

${pt.body}` : pt.body;
  const { data: commit } = await ok.rest.git.createCommit({ owner, repo, message: `${title}\n\n${fix.summary}\n\n${opts.testsNote ?? "Syntax-checked only; not executed."} Remediation not verified. ${opts.author ? `Edited by ${opts.author}; ` : "Drafted by "}Argus Watch, assessment ${a.id}.`, tree: newTree.sha, parents: [headSha] });
  // Blobs, tree and commit above are unreferenced objects; creating the branch is the first visible write.
  await assertWrite(fix.id, { kind: "create_branch", ...target });
  let createdBranch = false;
  try { await ok.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha }); createdBranch = true; }
  catch (e) {
    if ((e as { status?: number }).status !== 422) throw e;
    // The branch exists (an earlier approved attempt). Reuse it only if it already holds exactly this patch; never force-update.
    const { data: cur } = await ok.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const { data: curCommit } = await ok.rest.git.getCommit({ owner, repo, commit_sha: cur.object.sha });
    if (curCommit.tree.sha !== newTree.sha) throw Object.assign(new Error(`branch ${branch} already exists with different content; delete it on GitHub or start a new fix`), { status: 409 });
  }
  // Branch preference: the commit lives on a new branch only; no pull request, nothing merged, default branch untouched.
  if (opts.openPr === false) {
    const pushed: Fix = { ...fix, status: "branch_pushed", branch, pr_url: null, pr_number: null, pr_draft: null, commit_url: `https://github.com/${fix.repo}/commit/${commit.sha}`, approved_at: new Date().toISOString(), error: null };
    await store.putFix(pushed);
    await store.log({ kind: "fix", source: "apply", detail: `pushed ${branch} on ${fix.repo} (no pull request, by preference)`, ref: a.id });
    return pushed;
  }
  // 3. draft PR (non-draft fallback on plans that do not allow drafts on private repos)
  await assertWrite(fix.id, { kind: "create_pr", ...target });
  let pr: { html_url: string; number: number; draft: boolean };
  try {
    try { const r = await ok.rest.pulls.create({ owner, repo, head: branch, base, title, body, draft }); pr = { html_url: r.data.html_url, number: r.data.number, draft }; }
    catch (e) {
      const msg = String((e as { message?: string }).message ?? e);
      if (draft && (e as { status?: number }).status === 422 && /draft/i.test(msg)) { const r = await ok.rest.pulls.create({ owner, repo, head: branch, base, title: `[DRAFT – do not merge] ${title}`, body: `> Draft pull requests are not available on this repository's plan; treat this as a draft.\n\n${body}`, draft: false }); pr = { html_url: r.data.html_url, number: r.data.number, draft: false }; }
      else throw e;
    }
  } catch (e) {
    // The pull request could not be opened: remove the branch this attempt just created so no orphan branch is left.
    // Only a branch created in this call is deleted (never a pre-existing one, never the default branch).
    if (createdBranch && branch !== base) {
      await ok.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` })
        .then(() => store.log({ kind: "fix", source: "apply", detail: `pull request failed; removed branch ${branch} created by this attempt`, ref: a.id }))
        .catch((d) => store.log({ kind: "error", source: "apply", detail: `pull request failed and branch ${branch} could not be removed: ${String(d).slice(0, 120)}`, ref: a.id }));
    }
    throw e;
  }
  const done: Fix = { ...fix, status: "pr_created", branch, pr_url: pr.html_url, pr_number: pr.number, pr_draft: pr.draft, approved_at: new Date().toISOString(), error: null };
  await store.putFix(done);
  // An opened pull request is a proposal, not a resolution: the alert stays open (shown as "fix ready to review").
  await store.log({ kind: "fix", source: "apply", detail: `${pr.draft ? "draft " : ""}PR #${pr.number} on ${fix.repo} (${branch})${!draft || pr.draft ? "" : " [non-draft fallback]"}`, ref: a.id });
  // 4. read CI check-runs later (never triggered by us)
  if (hasQStash()) {
    const { Client } = await import("@upstash/qstash");
    const client = new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}) });
    for (const delay of ["90s", "6m"] as const) await client.publishJSON({ url: `${env.APP_URL}/api/fix/${fix.id}/checks`, body: {}, delay, retries: 1 }).catch(() => {});
    await store.countMessage(); await store.countMessage();
  }
  return done;
}

export async function refreshChecks(fix: Fix, installationId: number): Promise<Fix> {
  if (!fix.branch) return fix;
  const [owner, repo] = fix.repo.split("/");
  const ok = await scopedRepoOctokit(installationId, repo, { checks: "read", metadata: "read" }); // read-only
  const { data } = await ok.rest.checks.listForRef({ owner, repo, ref: fix.branch, per_page: 50, filter: "latest" });
  const runs = data.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion ?? null, url: r.html_url ?? null }));
  const out: Fix = { ...fix, check_runs: runs, checks_at: new Date().toISOString() };
  await store.putFix(out);
  return out;
}
