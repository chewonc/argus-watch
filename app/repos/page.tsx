// Repository onboarding and management: connect the GitHub App, pick repositories, see sync status, rescan,
// opt in to draft PRs, set a local checkout path for IDE links, remove. Permissions are explained in plain words.
import Link from "next/link";
import { RepoPicker, type PickRepo } from "@/components/repo-picker";
import { fmtTime } from "@/components/ui";
import { env, hasGitHubApp } from "@/lib/env";
import { listInstallationRepos } from "@/lib/github-app";
import { getDict, getLocale } from "@/lib/i18n";
import { githubUserToken, requireUser } from "@/lib/session";
import { SYSTEM_USER, store } from "@/lib/store";
import { addRepos, beginConnect, removeRepo, rescan, setAllowPr, setLocalRoot } from "./actions";

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

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8 grid gap-10">
      <div>
        <h1 className="serif text-[36px]">{d.repos_title}</h1>
        <p className="text-ink2">{d.repos_intro}</p>
        {sp.error && <p className="mt-2 text-[13px]" style={{ color: "var(--contradicted)" }}>{decodeURIComponent(sp.error)}</p>}
        {sp.added && <p className="mt-2 text-[13px]" style={{ color: "var(--observed)" }}>Repositories added. Existing findings are matched against them from the next pipeline run; use Rescan to refresh the stack summary now.</p>}
        {sp.rescanned && <p className="mt-2 text-[13px]" style={{ color: "var(--observed)" }}>Rescanned.</p>}
      </div>

      <section className="grid md:grid-cols-[1fr_360px] gap-8">
        <div className="grid gap-4">
          <h2 className="label">{d.step_connect}</h2>
          {!hasGitHubApp() || !env.GITHUB_APP_SLUG ? (
            <p className="text-[13px]" style={{ color: "var(--contradicted)" }}>{d.app_not_configured}</p>
          ) : (
            <form action={beginConnect}><button className="btn" type="submit">{insts.length ? d.add_installation : d.connect_github}</button></form>
          )}
          {insts.length > 0 && <ul className="text-[13px] grid gap-1">{insts.map((i) => <li key={i.id} className="mono">installation {i.id} · {i.account} ({i.account_type}){i.suspended ? " · suspended" : ""} · <a href={`https://github.com/settings/installations/${i.id}`} target="_blank" rel="noreferrer">manage on GitHub ↗</a></li>)}</ul>}
        </div>
        <aside className="border hair rounded-[6px] p-4 text-[13px] grid gap-2">
          <div className="label">{d.access_title}</div>
          <p><b>Read (always):</b> repository metadata, the file tree and file contents at one commit, lockfiles (package-lock, pnpm, yarn, requirements.txt). Used to list your packages and to cite the exact lines that make a condition true or false.</p>
          <p><b>Stored:</b> package names and versions, technology tags, and the cited line excerpts of an assessment. Full source is fetched at the assessed commit and cached per commit; repositories are never cloned.</p>
          <p><b>Write (only after you opt in per repository and approve a specific fix):</b> a new branch and a <i>draft</i> pull request. The default branch is never modified and nothing is merged.</p>
          <p><b>Private repositories:</b> supported through the App installation. <b>Revoke:</b> uninstall the App on GitHub (Settings → Applications) or remove the repository here.</p>
          <p><b>Sync:</b> a push to the default branch refreshes the stack summary via webhook; Rescan does it now.</p>
        </aside>
      </section>

      {pickers.length > 0 && (
        <section className="grid gap-4">
          <h2 className="label">{d.step_choose}</h2>
          {pickers.map((p) => (
            <div key={p.inst.id} className="border hair rounded-[6px] p-4">
              <div className="font-medium text-[14px] mb-2">{p.inst.account} <span className="label">installation {p.inst.id}</span></div>
              {p.error ? <p className="text-[13px]" style={{ color: "var(--contradicted)" }}>{p.error}</p> : <RepoPicker installationId={p.inst.id} repos={p.repos} action={addRepos} />}
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-4">
        <h2 className="label">{d.step_watched}</h2>
        {watched.length === 0 && demo.length === 0 && <p className="text-ink2 text-[13px]">{d.nothing_watched}</p>}
        <ul className="grid gap-3">
          {watched.map(({ ur, w }) => (
            <li key={ur.repo_key} className="border hair rounded-[6px] p-4 grid gap-3 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div><span className="mono text-[14px]">{ur.repo_key}</span>{w?.private && <span className="label ml-2">private</span>}{!w && <span className="label ml-2" style={{ color: "var(--contradicted)" }}>missing stack summary</span>}</div>
                <div className="mono text-[12px] text-ink2">{w ? <>@{w.sha?.slice(0, 7) ?? "?"} · {w.packages.length} pkgs · {w.tech_tags.join(", ") || "no tags"} · {w.refreshed_at ? `synced ${fmtTime(w.refreshed_at)}` : "never synced"}</> : "—"}</div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <form action={rescan}><input type="hidden" name="repo_key" value={ur.repo_key} /><button className="btn-ghost" type="submit">{d.rescan}</button></form>
                <form action={setAllowPr} className="flex items-center gap-2">
                  <input type="hidden" name="repo_key" value={ur.repo_key} />
                  <label className="flex items-center gap-2"><input type="checkbox" name="allow_pr" defaultChecked={ur.allow_pr} /> {d.allow_pr}</label>
                  <button className="btn-ghost" type="submit">{d.save}</button>
                </form>
                <form action={setLocalRoot} className="flex items-center gap-2">
                  <input type="hidden" name="repo_key" value={ur.repo_key} />
                  <input name="local_root" defaultValue={ur.local_root ?? ""} placeholder={d.local_root_placeholder} className="border hair rounded-[4px] px-2 py-1 bg-transparent w-[280px]" />
                  <button className="btn-ghost" type="submit">{d.save}</button>
                </form>
                <form action={removeRepo}><input type="hidden" name="repo_key" value={ur.repo_key} /><button className="btn-ghost" type="submit">{d.remove}</button></form>
              </div>
              {ur.allow_pr && <p className="text-[12px] text-ink2">{d.pr_enabled_note}</p>}
            </li>
          ))}
          {demo.filter((d): d is NonNullable<typeof d> => !!d).map((w) => (
            <li key={store.repoKey(w)} className="border hair rounded-[6px] p-4 text-[13px] flex flex-wrap items-baseline justify-between gap-2">
              <div><span className="mono text-[14px]">{store.repoKey(w)}</span><span className="label ml-2">{d.demo_shared}</span></div>
              <div className="mono text-[12px] text-ink2">@{w.sha?.slice(0, 7) ?? "?"} · {w.packages.length} pkgs · {w.refreshed_at ? `synced ${fmtTime(w.refreshed_at)}` : "never synced"}</div>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-ink2">{d.alerts_appear} <Link href="/">{d.nav_watch}</Link>.</p>
      </section>
    </div>
  );
}
