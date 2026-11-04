// Repository management: three steps (connect GitHub, choose repositories, monitoring). Rendered on /repos for
// onboarding (no repositories yet) and in Settings → Repositories for everyone else. Per-repository options (stop/resume
// monitoring, refresh, draft PRs, remove) behind a "•••" menu. GitHub App access, monitoring status and Threats
// filtering are separate: stopping monitoring here never uninstalls the App or changes filters.
import Link from "next/link";
import { RepoPicker, type PickRepo } from "@/components/repo-picker";
import { env, hasGitHubApp } from "@/lib/env";
import { explainGitHubError, listInstallationReposApp } from "@/lib/github-app";
import { getDict, getLocale } from "@/lib/i18n";
import { repoStatus } from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { SYSTEM_USER, store } from "@/lib/store";
import { addRepos, beginConnect, removeRepo, rescan, setAllowPr, setPaused } from "./actions";

export async function RepositoriesPanel({ sp, embedded = false }: { sp: Record<string, string | undefined>; embedded?: boolean }) {
  const user = await requireUser(embedded ? "/settings" : "/repos");
  const back = embedded ? <input type="hidden" name="back" value="settings" /> : null;
  const d = await getDict(await getLocale());
  const [insts, mine] = await Promise.all([store.listUserInstallations(user.id), store.listUserRepos(user.id)]);
  const watched = await Promise.all(mine.map(async (ur) => ({ ur, w: await store.getRepo(ur.repo_key) })));
  const demo = env.DEMO_SHARED_REPOS ? await Promise.all((await store.listUserRepoKeys(SYSTEM_USER)).map((k) => store.getRepo(k))) : [];
  // Listed with each installation's own token (refreshed automatically); the user's sign-in token is not needed here.
  const pickers = await Promise.all(insts.filter((i) => !i.suspended).map(async (i) => {
    try { const repos = await listInstallationReposApp(i.id); return { inst: i, repos: repos.map((r): PickRepo => ({ ...r, watched: mine.some((m) => m.repo_key === r.full_name && !m.paused) })), error: null }; }
    catch (e) { await store.log({ kind: "error", source: "repos", detail: `list repositories for installation ${i.id}: ${String((e as { status?: number }).status ?? "")} ${String(e).slice(0, 120)}` }); return { inst: i, repos: [] as PickRepo[], error: explainGitHubError(e, i.account) }; }
  }));
  const listFailed = pickers.some((p) => p.error);

  const watching = [...watched.map(({ ur, w }) => ({ key: ur.repo_key, ur, w, demo: false })), ...demo.filter((x): x is NonNullable<typeof x> => !!x).map((w) => ({ key: store.repoKey(w), ur: null, w, demo: true }))];

  return (
    <div className={embedded ? "grid gap-8" : "mx-auto max-w-[calc(760px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid gap-10"}>
      {(!embedded || sp.error || sp.added || sp.rescanned || sp.paused || sp.resumed) && <div className="grid gap-1">
        {!embedded && <h1 className="text-[calc(28px*var(--ui))] font-semibold tracking-[-0.02em]">{d.repos_title}</h1>}
        {!embedded && <p className="text-[calc(15px*var(--ui))] text-ink2">Choose which GitHub repositories Argus Watch should protect.</p>}
        {sp.error && <p role="alert" className="mt-2 text-[calc(14px*var(--ui))] tone-bad">{decodeURIComponent(sp.error)}</p>}
        {sp.added && <p role="status" className="mt-2 text-[calc(14px*var(--ui))] tone-ok">Repositories added. {Number(sp.checking ?? 0) > 0 ? `Checking them now against ${sp.checking} recent threat(s) that match their dependencies; results appear in Alerts within a few minutes.` : "No recent threat matches their dependencies. We’ll check every new threat from now on."}</p>}
        {sp.rescanned && <p role="status" className="mt-2 text-[calc(14px*var(--ui))] tone-ok">Repository refreshed.</p>}
        {sp.paused && <p role="status" className="mt-2 text-[calc(14px*var(--ui))] tone-ok">Stopped monitoring {sp.paused}. Existing alerts and history stay; resume any time.</p>}
        {sp.resumed && <p role="status" className="mt-2 text-[calc(14px*var(--ui))] tone-ok">Monitoring resumed for {sp.resumed}.</p>}
      </div>}

      <Step n={1} done={insts.length > 0} title="Connect GitHub">
        <div className="border hair rounded-[10px] bg-raised p-4 sm:p-5 grid gap-4">
          <div className="flex items-center gap-3">
            {user.avatar ? <img src={user.avatar} alt="" width={40} height={40} className="rounded-full" /> /* eslint-disable-line @next/next/no-img-element -- GitHub avatar */ : <span aria-hidden className="w-10 h-10 rounded-full bg-[var(--sunken)] grid place-items-center font-semibold">{user.login.slice(0, 1).toUpperCase()}</span>}
            <div className="grid">
              <span className="text-[calc(15px*var(--ui))] font-semibold">{user.login}</span>
              <span className={`text-[calc(13px*var(--ui))] ${insts.length ? "tone-ok" : "text-ink2"}`}>{insts.length ? "✓ Connected to GitHub" : "Not connected yet"}</span>
            </div>
          </div>
          {insts.length > 0 && (
            <ul className="grid border-t hair">
              {insts.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3 border-b hair last:border-0 text-[calc(14px*var(--ui))]">
                  <span><span className="font-medium">{i.account}</span> <span className="text-ink2">· {i.account_type === "Organization" ? "organization" : "personal account"}{i.suspended ? " · suspended" : ""}</span></span>
                  <a href={`https://github.com/settings/installations/${i.id}`} target="_blank" rel="noreferrer" className="text-[calc(13px*var(--ui))] text-ink2 hover:text-ink">Manage GitHub access</a>
                </li>
              ))}
            </ul>
          )}
          {!hasGitHubApp() || !env.GITHUB_APP_SLUG ? <p className="text-[calc(13px*var(--ui))] tone-bad">{d.app_not_configured}</p>
            : <form action={beginConnect}>{back}<button className={insts.length ? "btn-ghost" : "btn"} type="submit">{insts.length ? "+ Add another account or organization" : d.connect_github}</button></form>}
        </div>
        <div className="text-[calc(14px*var(--ui))] grid gap-2">
          <p className="text-ink2">Nothing in your repository changes without your approval.</p>
          <details className="disclose">
            <summary>What Argus Watch reads, stores and writes</summary>
            <dl className="grid gap-3 mt-3 text-[calc(13px*var(--ui))] [&_dt]:font-semibold [&_dd]:text-ink2">
              <div><dt>Reads</dt><dd>Your file list, lockfiles (package-lock, pnpm, yarn, requirements.txt) and the specific files it cites, at one commit. Repositories are never cloned.</dd></div>
              <div><dt>Stores</dt><dd>Package names and versions, technology tags, and the short code excerpts cited in an alert.</dd></div>
              <div><dt>Writes</dt><dd>Nothing by default. Only if you turn on changes for a repository and approve a specific fix: a new branch, and a draft pull request unless you chose a branch only. Your default branch is not changed, and nothing is merged unless you separately approve an automatic merge.</dd></div>
              <div><dt>Stays in sync</dt><dd>Pushes to your default branch refresh the repository automatically.</dd></div>
              <div><dt>Revoking access</dt><dd>Uninstall the app on GitHub (Settings → Applications), or stop monitoring a repository below.</dd></div>
            </dl>
          </details>
        </div>
      </Step>

      <Step n={2} done={watched.length > 0 && !listFailed} title="Choose repositories">
        {pickers.length === 0 ? <p className="text-[calc(14px*var(--ui))] text-ink2">{insts.length ? "Your GitHub installations are suspended. Review them on GitHub." : "Connect GitHub first."}</p> : (
          <details className="disclose" open={watched.length === 0 || listFailed}>
            <summary>Add repositories</summary>
            <div className="grid gap-4 mt-3">
              {pickers.map((p) => (
                <div key={p.inst.id} className="grid gap-2">
                  {pickers.length > 1 && <div className="text-[calc(13px*var(--ui))] font-medium">{p.inst.account}</div>}
                  {p.error
                    ? <div role="alert" className="grid gap-1 text-[calc(13px*var(--ui))]"><p className="tone-bad">{p.error}</p><a href={`https://github.com/settings/installations/${p.inst.id}`} target="_blank" rel="noreferrer" className="w-fit">Manage GitHub access</a></div>
                    : <RepoPicker installationId={p.inst.id} repos={p.repos} action={addRepos} back={embedded ? "settings" : undefined} manageHref={`https://github.com/settings/installations/${p.inst.id}`} />}
                </div>
              ))}
            </div>
          </details>
        )}
      </Step>

      <Step n={3} done={watching.length > 0} title="Monitoring">
        {watching.length === 0 ? <p className="text-[calc(14px*var(--ui))] text-ink2">{d.nothing_watched}</p> : (
          <ul className="border hair rounded-[10px] bg-raised">
            {watching.map(({ key, ur, w, demo: isDemo }) => { const st = ur?.access_lost ? { label: "GitHub access lost", glyph: "!", tone: "bad" as const } : ur?.paused ? { label: "Not monitored (stopped by you)", glyph: "○", tone: "muted" as const } : repoStatus(w, { connected: !ur || !!ur.installation_id || !hasGitHubApp() }); return (
              <li key={key} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b hair last:border-0">
                <div className="grid min-w-0">
                  {/* Monorepo folders: lead with the folder name so rows stay distinguishable on narrow screens; the full path wraps below. */}
                  <span className="text-[calc(14px*var(--ui))] font-medium [overflow-wrap:anywhere]" title={key}>{key.split("/").length > 2 ? key.split("/").pop() : key}</span>
                  {key.split("/").length > 2 && <span className="text-[calc(12px*var(--ui))] text-ink2 mono [overflow-wrap:anywhere]">{key}</span>}
                  {isDemo && <span className="text-ink2 text-[calc(12px*var(--ui))]">Shared demo</span>}
                  <span className={`text-[calc(13px*var(--ui))] tone-${st.tone}`}><span aria-hidden>{st.glyph}</span> {st.label}</span>
                </div>
                {ur && (
                  <details className="relative">
                    <summary className="btn-ghost list-none cursor-pointer" aria-label={`Options for ${key}`}>•••</summary>
                    <div className="menu grid gap-1 !p-2 w-[calc(290px*var(--ui))] text-[calc(13px*var(--ui))]">
                      <a role="menuitem" href={`https://github.com/${ur.repo_key.split("/").slice(0, 2).join("/")}`} target="_blank" rel="noreferrer">View repository on GitHub ↗</a>
                      <form action={setPaused}>{back}<input type="hidden" name="repo_key" value={ur.repo_key} /><input type="hidden" name="paused" value={ur.paused ? "0" : "1"} /><button role="menuitem" type="submit">{ur.paused ? "Resume monitoring" : "Stop monitoring"}</button></form>
                      <form action={rescan}>{back}<input type="hidden" name="repo_key" value={ur.repo_key} /><button role="menuitem" type="submit">{d.rescan}</button></form>
                      <form action={setAllowPr} className="grid gap-2 px-[calc(10px*var(--ui))] py-2">{back}
                        <input type="hidden" name="repo_key" value={ur.repo_key} />
                        <label className="flex items-start gap-2"><input type="checkbox" name="allow_pr" defaultChecked={ur.allow_pr} className="mt-1" /> <span>Allow draft pull requests<span className="block text-[calc(12px*var(--ui))] text-ink2">Needed before Argus can propose a fix. Each fix still needs your approval.</span></span></label>
                        <button className="btn-ghost w-fit" type="submit">{d.save}</button>
                      </form>
                      <form action={removeRepo} className="border-t hair pt-1">{back}<input type="hidden" name="repo_key" value={ur.repo_key} /><button role="menuitem" type="submit" className="tone-bad">Remove from Argus Watch</button><p className="px-[calc(10px*var(--ui))] pb-1 text-[calc(12px*var(--ui))] text-ink2">Stops monitoring. Your GitHub repository is not changed or deleted; past alerts stay in history. Add it again any time.</p></form>
                    </div>
                  </details>
                )}
              </li>); })}
          </ul>
        )}
        {watching.length > 0 && <p className="text-[calc(13px*var(--ui))] text-ink2">Findings appear on the <Link href="/alerts">Threats</Link> page.</p>}
        <details className="disclose">
          <summary>What Argus Watch monitors</summary>
          <div className="grid gap-3 mt-3 text-[calc(13px*var(--ui))]">
            <p>Argus Watch tracks newly published security threats and checks whether they may affect your connected repositories.</p>
            <dl className="grid gap-3 [&_dt]:font-semibold [&_dd]:text-ink2">
              <div><dt>Sources</dt><dd>GitHub-reviewed security advisories (pushed to Argus as they are published, and polled every 5 minutes), the National Vulnerability Database, OSV.dev for the exact package versions in your lockfiles, CISA&apos;s Known Exploited Vulnerabilities catalog, and security research feeds including AI-security write-ups, arXiv and Hacker News. Live intervals are on the <Link href="/sources">Sources</Link> page.</dd></div>
              <div><dt>What is checked</dt><dd>Whether a threat names a package or technology your repository uses, then whether the code conditions it needs are present in your files, cited to the line. A report&apos;s credibility is checked separately.</dd></div>
              <div><dt>When</dt><dd>Continuously, on a schedule (most sources every 5 to 60 minutes). A new or updated report about a threat triggers a new assessment; adding a repository checks it against the last 30 days of threats. Pushes to your default branch refresh its package list.</dd></div>
              <div><dt>Your code</dt><dd>Read at one commit through the GitHub App; never cloned or run on the Argus server. Only package names and versions and short cited excerpts are stored.</dd></div>
              <div><dt>Changes</dt><dd>Never automatic. A fix is written only after you enable changes for a repository and approve that specific fix.</dd></div>
            </dl>
          </div>
        </details>
      </Step>
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[28px_1fr] gap-x-4">
      <span aria-hidden className={`w-7 h-7 rounded-full grid place-items-center text-[calc(12px*var(--ui))] font-semibold border ${done ? "border-transparent bg-[var(--sunken)] tone-ok" : "hair"}`}>{done ? "✓" : n}</span>
      <div className="grid gap-4 min-w-0"><h2 className="text-[calc(15px*var(--ui))] font-semibold leading-7">{title}</h2>{children}</div>
    </section>
  );
}
