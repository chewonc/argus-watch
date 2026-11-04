// Apply an approved fix: new branch + commit via the Git Data API (no clone) and a DRAFT pull request.
// Preconditions are enforced by the route: session, fix owner, per-repo allow_pr, App installation present.
// The default branch is never written; nothing is merged; CI results are read, never triggered.
import { env, hasQStash } from "./env";
import { installationOctokit } from "./github-app";
import { prText } from "./fix";
import type { Assessment, Finding, Fix } from "./schema";
import { store } from "./store";

export type ApplyOpts = { draft?: boolean; author?: string; testsNote?: string };
export async function applyFix(fix: Fix, a: Assessment, f: Finding | null, installationId: number, opts: ApplyOpts = {}): Promise<Fix> {
  const draft = opts.draft ?? true;
  const [owner, repo] = fix.repo.split("/");
  const ok = await installationOctokit(installationId);
  const w = await store.getRepo(fix.repo_key);
  const base = w?.default_branch ?? "main";
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
  let branch = `argus/fix-${fix.id.slice(0, 8)}`;
  try { await ok.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha }); }
  catch (e) { if ((e as { status?: number }).status === 422) { branch = `${branch}-${Date.now().toString(36).slice(-4)}`; await ok.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha }); } else throw e; }
  // 3. draft PR (non-draft fallback on plans that do not allow drafts on private repos)
  let pr: { html_url: string; number: number; draft: boolean };
  try { const r = await ok.rest.pulls.create({ owner, repo, head: branch, base, title, body, draft }); pr = { html_url: r.data.html_url, number: r.data.number, draft }; }
  catch (e) {
    const msg = String((e as { message?: string }).message ?? e);
    if (draft && (e as { status?: number }).status === 422 && /draft/i.test(msg)) { const r = await ok.rest.pulls.create({ owner, repo, head: branch, base, title: `[DRAFT – do not merge] ${title}`, body: `> Draft pull requests are not available on this repository's plan; treat this as a draft.\n\n${body}`, draft: false }); pr = { html_url: r.data.html_url, number: r.data.number, draft: false }; }
    else throw e;
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
  const ok = await installationOctokit(installationId);
  const { data } = await ok.rest.checks.listForRef({ owner, repo, ref: fix.branch, per_page: 50, filter: "latest" });
  const runs = data.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion ?? null, url: r.html_url ?? null }));
  const out: Fix = { ...fix, check_runs: runs, checks_at: new Date().toISOString() };
  await store.putFix(out);
  return out;
}
