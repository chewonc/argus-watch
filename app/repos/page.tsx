// Repositories: three steps (connect GitHub, choose repositories, monitoring). Access details sit behind one
// disclosure; per-repository options (refresh, draft PRs, stop) behind a "•••" menu.
import Link from "next/link";
import { RepoPicker, type PickRepo } from "@/components/repo-picker";
import { env, hasGitHubApp } from "@/lib/env";
import { listInstallationRepos } from "@/lib/github-app";
import { getDict, getLocale } from "@/lib/i18n";
import { repoStatus } from "@/lib/labels";
import { githubUserToken, requireUser } from "@/lib/session";
import { SYSTEM_USER, store } from "@/lib/store";
import { addRepos, beginConnect, removeRepo, rescan, setAllowPr } from "./actions";

export const dynamic = "force-dynamic";

export default async function Repos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/repos");
  const sp = await searchParams;
  const d = await getDict(await getLocale());
  const [insts, mine, token] = await Promise.all([store.listUserInstallations(user.id), store.listUserRepos(user.id), githubUserToken()]);
  const watched = await Promise.all(mine.map(async (ur) => ({ ur, w: await store.getRepo(ur.repo_key) })));
  const demo = env.DEMO_SHARED_REPOS ? await Promise.all((await store.listUserRepoKeys(SYSTEM_USER)).map((k) => store.getRepo(k))) : [];
  const pickers = token ? await Promise.all(insts.filter((i) => !i.suspended).map(async (i) => {
    try { const repos = await listInstallationRepos(token, i.id); return { inst: i, repos: repos.map((r): PickRepo => ({ ...r, watched: mine.some((m) => m.repo_key === r.full_name) })), error: null }; }
    catch (e) { return { inst: i, repos: [] as PickRepo[], error: String(e).slice(0, 160) }; }
  })) : [];

  const watching = [...watched.map(({ ur, w }) => ({ key: ur.repo_key, ur, w, demo: false })), ...demo.filter((x): x is NonNullable<typeof x> => !!x).map((w) => ({ key: store.repoKey(w), ur: null, w, demo: true }))];

  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-10 grid gap-10">
      <div className="grid gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{d.repos_title}</h1>
        <p className="text-[15px] text-ink2">Choose which GitHub repositories Argus Watch should protect.</p>
        {sp.error && <p role="alert" className="mt-2 text-[14px] tone-bad">{decodeURIComponent(sp.error)}</p>}
        {sp.added && <p role="status" className="mt-2 text-[14px] tone-ok">Repositories added. We&apos;ll check them against new threats from now on.</p>}
        {sp.rescanned && <p role="status" className="mt-2 text-[14px] tone-ok">Repository refreshed.</p>}
      </div>

      <Step n={1} done={insts.length > 0} title="Connect GitHub">
        <div className="border hair rounded-[10px] bg-raised p-4 sm:p-5 grid gap-4">
          <div className="flex items-center gap-3">
            {user.avatar ? <img src={user.avatar} alt="" width={40} height={40} className="rounded-full" /> /* eslint-disable-line @next/next/no-img-element -- GitHub avatar */ : <span aria-hidden className="w-10 h-10 rounded-full bg-[var(--sunken)] grid place-items-center font-semibold">{user.login.slice(0, 1).toUpperCase()}</span>}
            <div className="grid">
              <span className="text-[15px] font-semibold">{user.login}</span>
              <span className={`text-[13px] ${insts.length ? "tone-ok" : "text-ink2"}`}>{insts.length ? "✓ Connected to GitHub" : "Not connected yet"}</span>
            </div>
          </div>
          {insts.length > 0 && (
            <ul className="grid border-t hair">
              {insts.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3 border-b hair last:border-0 text-[14px]">
                  <span><span className="font-medium">{i.account}</span> <span className="text-ink2">· {i.account_type === "Organization" ? "organization" : "personal account"}{i.suspended ? " · suspended" : ""}</span></span>
                  <a href={`https://github.com/settings/installations/${i.id}`} target="_blank" rel="noreferrer" className="text-[13px] text-ink2 hover:text-ink">Manage on GitHub ↗</a>
                </li>
              ))}
            </ul>
          )}
          {!hasGitHubApp() || !env.GITHUB_APP_SLUG ? <p className="text-[13px] tone-bad">{d.app_not_configured}</p>
            : <form action={beginConnect}><button className={insts.length ? "btn-ghost" : "btn"} type="submit">{insts.length ? "+ Add another account or organization" : d.connect_github}</button></form>}
        </div>
        <div className="text-[14px] grid gap-2">
          <p className="text-ink2">Argus Watch only reads your code. Changes happen only as draft pull requests you approve.</p>
          <details className="disclose">
            <summary>What Argus Watch reads, stores and writes</summary>
            <dl className="grid gap-3 mt-3 text-[13px] [&_dt]:font-semibold [&_dd]:text-ink2">
              <div><dt>Reads</dt><dd>Your file list, lockfiles (package-lock, pnpm, yarn, requirements.txt) and the specific files it cites, at one commit. Repositories are never cloned.</dd></div>
              <div><dt>Stores</dt><dd>Package names and versions, technology tags, and the short code excerpts cited in an alert.</dd></div>
              <div><dt>Writes</dt><dd>Nothing by default. Only if you turn on draft pull requests for a repository and approve a specific fix: a new branch and a draft pull request. Your main branch is never changed and nothing is merged.</dd></div>
              <div><dt>Stays in sync</dt><dd>Pushes to your default branch refresh the repository automatically.</dd></div>
              <div><dt>Revoking access</dt><dd>Uninstall the app on GitHub (Settings → Applications), or stop monitoring a repository below.</dd></div>
            </dl>
          </details>
        </div>
      </Step>

      <Step n={2} done={watched.length > 0} title="Choose repositories">
        {pickers.length === 0 ? <p className="text-[14px] text-ink2">{insts.length ? "Sign out and in again to load your repositories from GitHub." : "Connect GitHub first."}</p> : pickers.map((p) => (
          <div key={p.inst.id} className="grid gap-2">
            {pickers.length > 1 && <div className="text-[13px] font-medium">{p.inst.account}</div>}
            {p.error ? <p className="text-[13px] tone-bad">Couldn&apos;t load repositories from GitHub. Try again in a moment.</p> : <RepoPicker installationId={p.inst.id} repos={p.repos} action={addRepos} />}
          </div>
        ))}
      </Step>

      <Step n={3} done={watching.length > 0} title="Monitoring">
        {watching.length === 0 ? <p className="text-[14px] text-ink2">{d.nothing_watched}</p> : (
          <ul className="border hair rounded-[10px] bg-raised">
            {watching.map(({ key, ur, w, demo: isDemo }) => { const st = repoStatus(w, { connected: !ur || !!ur.installation_id || !hasGitHubApp() }); return (
              <li key={key} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b hair last:border-0">
                <div className="grid min-w-0">
                  <span className="text-[14px] font-medium truncate">{key}{isDemo && <span className="text-ink2 font-normal text-[12px] ml-2">shared demo</span>}</span>
                  <span className={`text-[13px] tone-${st.tone}`}><span aria-hidden>{st.glyph}</span> {st.label}</span>
                </div>
                {ur && (
                  <details className="relative">
                    <summary className="btn-ghost list-none cursor-pointer" aria-label={`Options for ${key}`}>•••</summary>
                    <div className="menu grid gap-1 !p-2 w-[290px] text-[13px]">
                      <form action={rescan}><input type="hidden" name="repo_key" value={ur.repo_key} /><button role="menuitem" type="submit">{d.rescan}</button></form>
                      <form action={setAllowPr} className="grid gap-2 px-[10px] py-2">
                        <input type="hidden" name="repo_key" value={ur.repo_key} />
                        <label className="flex items-start gap-2"><input type="checkbox" name="allow_pr" defaultChecked={ur.allow_pr} className="mt-1" /> <span>Allow draft pull requests<span className="block text-[12px] text-ink2">Needed before Argus can propose a fix. Each fix still needs your approval.</span></span></label>
                        <button className="btn-ghost w-fit" type="submit">{d.save}</button>
                      </form>
                      <form action={removeRepo}><input type="hidden" name="repo_key" value={ur.repo_key} /><button role="menuitem" type="submit" className="tone-bad">Stop monitoring</button></form>
                    </div>
                  </details>
                )}
              </li>); })}
          </ul>
        )}
        {watching.length > 0 && <p className="text-[13px] text-ink2">Alerts appear on the <Link href="/">Alerts</Link> page.</p>}
      </Step>
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[28px_1fr] gap-x-4">
      <span aria-hidden className={`w-7 h-7 rounded-full grid place-items-center text-[12px] font-semibold border ${done ? "border-transparent bg-[var(--sunken)] tone-ok" : "hair"}`}>{done ? "✓" : n}</span>
      <div className="grid gap-4 min-w-0"><h2 className="text-[16px] font-semibold leading-7">{title}</h2>{children}</div>
    </section>
  );
}
