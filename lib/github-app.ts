// GitHub App authentication: installation tokens for repository reads (and, only after per-repo opt-in and
// per-fix approval, draft-PR writes). Tokens are cached in the store and refreshed 5 minutes before expiry.
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { env, hasGitHubApp } from "./env";
import { store } from "./store";
import { USER_AGENT } from "./ua";

let app: App | null = null;
export function githubApp(): App {
  if (!hasGitHubApp()) throw new Error("GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)");
  return (app ??= new App({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY, oauth: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }));
}

const memo = new Map<number, { token: string; exp: number }>();
export async function installationToken(installationId: number): Promise<string> {
  const m = memo.get(installationId);
  if (m && m.exp - Date.now() > 5 * 60e3) return m.token;
  const c = await store.getToken(installationId);
  if (c && Date.parse(c.exp) - Date.now() > 5 * 60e3) { memo.set(installationId, { token: c.token, exp: Date.parse(c.exp) }); return c.token; }
  const r = await githubApp().octokit.request("POST /app/installations/{installation_id}/access_tokens", { installation_id: installationId });
  const token = r.data.token, exp = r.data.expires_at;
  memo.set(installationId, { token, exp: Date.parse(exp) });
  await store.setToken(installationId, { token, exp });
  return token;
}

/**
 * Least privilege: a short-lived installation token limited to ONE repository and the named permissions (never cached,
 * never more than the installation itself grants). Used for the isolated runner's clone (contents:read) and for each
 * approved write (only what that write needs), so no general write-capable token leaves the write boundary.
 */
export async function scopedRepoToken(installationId: number, repoName: string, permissions: Record<string, "read" | "write">): Promise<string> {
  // Request only what the installation holds (GitHub refuses the whole token otherwise); a missing *write* permission is an error.
  const held = await installationPermissions(installationId);
  const want: Record<string, "read" | "write"> = {};
  for (const [k, v] of Object.entries(permissions)) {
    if (held[k] === "write" || (v === "read" && held[k] === "read")) want[k] = v;
    else if (v === "write") throw Object.assign(new Error(`the GitHub App installation lacks ${k}:write`), { status: 403 });
  }
  const r = await githubApp().octokit.request("POST /app/installations/{installation_id}/access_tokens", { installation_id: installationId, repositories: [repoName], permissions: want });
  return r.data.token;
}
export const scopedRepoOctokit = async (installationId: number, repoName: string, permissions: Record<string, "read" | "write">) =>
  new Octokit({ auth: await scopedRepoToken(installationId, repoName, permissions), userAgent: USER_AGENT });

export const installationOctokit = async (installationId: number) => new Octokit({ auth: await installationToken(installationId), userAgent: USER_AGENT });
export const userOctokit = (token: string) => new Octokit({ auth: token, userAgent: USER_AGENT });

export type UserInstallation = { id: number; account: string; account_type: "User" | "Organization"; repository_selection: "all" | "selected"; permissions: Record<string, string> };
/** Installations of this App that the signed-in user can see (GET /user/installations with the user token). */
/** Repositories of one installation that THIS user can access (GitHub intersects the installation with the user's own permissions). */
export async function listUserInstallationRepos(userToken: string, installationId: number): Promise<{ full_name: string; permissions: Record<string, boolean> }[]> {
  const out: { full_name: string; permissions: Record<string, boolean> }[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await userOctokit(userToken).request("GET /user/installations/{installation_id}/repositories", { installation_id: installationId, per_page: 100, page });
    out.push(...r.data.repositories.map((x) => ({ full_name: x.full_name, permissions: (x.permissions ?? {}) as Record<string, boolean> })));
    if (r.data.repositories.length < 100) break;
  }
  return out;
}

/** The signed-in user's own permission on a repository (null when GitHub does not let them see it). */
export async function userRepoPermission(userToken: string, full: string): Promise<{ pull: boolean; push: boolean } | null> {
  const [owner, repo] = full.split("/");
  try { const r = await userOctokit(userToken).rest.repos.get({ owner, repo }); return { pull: !!r.data.permissions?.pull, push: !!r.data.permissions?.push }; }
  catch (e) { if ((e as { status?: number }).status === 404 || (e as { status?: number }).status === 403) return null; throw e; }
}

export async function listUserInstallations(userToken: string): Promise<UserInstallation[]> {
  const r = await userOctokit(userToken).request("GET /user/installations", { per_page: 100 });
  return r.data.installations.map((i) => ({ id: i.id, account: (i.account as { login?: string; slug?: string } | null)?.login ?? (i.account as { slug?: string } | null)?.slug ?? "?", account_type: ((i.account as { type?: string } | null)?.type === "Organization" ? "Organization" : "User"), repository_selection: i.repository_selection as "all" | "selected", permissions: (i.permissions ?? {}) as Record<string, string> }));
}

export type RepoSummary = { full_name: string; private: boolean; default_branch: string; pushed_at: string | null; language: string | null };
export async function listInstallationRepos(userToken: string, installationId: number): Promise<RepoSummary[]> {
  const ok = userOctokit(userToken);
  const out: RepoSummary[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await ok.request("GET /user/installations/{installation_id}/repositories", { installation_id: installationId, per_page: 100, page });
    out.push(...r.data.repositories.map((x) => ({ full_name: x.full_name, private: x.private, default_branch: x.default_branch, pushed_at: x.pushed_at ?? null, language: x.language ?? null })));
    if (r.data.repositories.length < 100) break;
  }
  return out.sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
}

/**
 * Repositories an installation grants, read with the App's installation token (refreshed automatically). Used after
 * the installation was verified as the user's at connect time (/api/github/setup), so the listing no longer depends
 * on the user's sign-in token, which expires and used to make the Repositories page fail.
 */
export async function listInstallationReposApp(installationId: number): Promise<RepoSummary[]> {
  const ok = await installationOctokit(installationId);
  const out: RepoSummary[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await ok.request("GET /installation/repositories", { per_page: 100, page });
    out.push(...r.data.repositories.map((x) => ({ full_name: x.full_name, private: x.private, default_branch: x.default_branch, pushed_at: x.pushed_at ?? null, language: x.language ?? null })));
    if (r.data.repositories.length < 100) break;
  }
  return out.sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
}

/** A GitHub error as an actionable sentence for the Repositories page (never a raw stack). */
export function explainGitHubError(e: unknown, account: string): string {
  const status = (e as { status?: number }).status;
  if (status === 401) return `GitHub rejected SaveBell's credentials for ${account}. Reinstall or re-authorize the SaveBell app on GitHub.`;
  if (status === 403) return `The SaveBell app no longer has access to ${account}'s repositories (permissions changed or the installation is suspended). Review its access on GitHub.`;
  if (status === 404) return `The SaveBell app installation for ${account} was not found; it may have been uninstalled. Connect the account again.`;
  return `GitHub did not answer for ${account} (${status ?? "network error"}). Try again in a moment.`;
}

/** Which permissions this installation currently has (after the owner accepted an upgrade, write perms appear here). */
export { installationCanWrite } from "./pull-state";

export async function installationPermissions(installationId: number): Promise<Record<string, string>> {
  const r = await githubApp().octokit.request("GET /app/installations/{installation_id}", { installation_id: installationId });
  return (r.data.permissions ?? {}) as Record<string, string>;
}

/**
 * A user's CURRENT permission on a repository, read with the installation token (Metadata: read), so it can be checked
 * when the user is not signed in. GitHub returns the highest role from every grant source; "maintain" maps to write.
 * Throws on any API error: callers must treat an unknown answer as "not allowed".
 */
export async function liveUserPermission(installationId: number, full: string, login: string): Promise<{ permission: string; user_id: number | null }> {
  const [owner, repo] = full.split("/");
  const ok = await scopedRepoOctokit(installationId, repo, { metadata: "read" });
  const r = await ok.request("GET /repos/{owner}/{repo}/collaborators/{username}/permission", { owner, repo, username: login });
  return { permission: String(r.data.permission ?? "none"), user_id: (r.data.user as { id?: number } | null)?.id ?? null };
}

/** Current head commit of a branch, read with the installation token. */
export async function liveBranchHead(installationId: number, full: string, branch: string): Promise<string> {
  const [owner, repo] = full.split("/");
  const ok = await scopedRepoOctokit(installationId, repo, { contents: "read", metadata: "read" });
  return (await ok.rest.repos.getBranch({ owner, repo, branch })).data.commit.sha;
}
