// Alerts dashboard (/alerts). Answers only: do I need to do anything, which issues, which repository is watched.
// Technical monitoring detail lives on /monitoring; the product landing page is /.
import { withAgentFor } from "@/lib/authz";
import { fixesFor } from "@/lib/authz";
import Link from "next/link";
import { AlertCard, type CardData } from "@/components/alerts";
import { RememberThreatsView, RepoFilter } from "@/components/repo-filter";
import { BulkFix } from "@/components/bulk-fix";
import { StartNowForm } from "@/components/window-forms";
import { startWindowNow } from "@/app/settings/window-actions";
import { activeRunFor } from "@/lib/window-run";
import { fmtLocal } from "@/lib/window-schedule";
import { findingAction, latestFix } from "@/lib/actions";
import { modeOf } from "@/lib/remediation-mode";
import { actionLabels } from "@/lib/action-labels";
import type { Fix } from "@/lib/schema";
import { redirect } from "next/navigation";
import { env, hasGitHubApp } from "@/lib/env";
import { installationPermissions } from "@/lib/github-app";
import { getDict, getLocale, tr } from "@/lib/i18n";
import { caseHref, discoveredAt, location, plainTitle, repoStatus, statusOf, localized, whereLine } from "@/lib/labels";
import { deriveSeverity } from "@/lib/severity";
import { currentUser, visibleRepoKeys } from "@/lib/session";
import { ALERT_HISTORY, store } from "@/lib/store";

export const dynamic = "force-dynamic";
const FILTERS = ["all", "urgent", "resolved"] as const;
type Filter = (typeof FILTERS)[number];
// Older links (?f=needs_action etc.) keep working.
const LEGACY: Record<string, Filter> = { needs_action: "urgent", new: "all", not_affected: "all" };

export default async function Watch({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await currentUser();
  const sp = await searchParams;
  const locale = await getLocale();
  const d = await getDict(locale);
  if (!user) redirect("/?signin=1&next=/alerts");

  const keys = await visibleRepoKeys(user.id);
  const [assessmentsAll, findings, reposAll, resolvedSet, mine] = await Promise.all([
    store.listAssessments(ALERT_HISTORY), store.listFindings(), store.listRepos(), store.resolvedSet(user.id), store.listUserRepos(user.id),
  ]);
  const repos = reposAll.filter((r) => keys.has(store.repoKey(r)));
  const fmap = new Map(findings.map((f) => [f.id, f]));
  const rmap = new Map(repos.map((r) => [store.repoKey(r), r]));
  // latest assessment per (finding, repo): re-assessments supersede older ones
  const latest = new Map<string, (typeof assessmentsAll)[number]>();
  for (const a of assessmentsAll) { if (!keys.has(a.repo)) continue; const k = `${a.finding_id}|${a.repo}`; if (!latest.has(k) || latest.get(k)!.timestamps.processed_at < a.timestamps.processed_at) latest.set(k, a); }
  // Each user sees only their own AI-agent report on a shared assessment (V4).
  for (const p of await withAgentFor(user.id, [...latest.values()])) latest.set(`${p.finding_id}|${p.repo}`, p);
  const resolved = new Set(resolvedSet);
  const fixesBy = new Map<string, Fix[]>();
  await Promise.all([...latest.values()].filter((a) => a.verdict !== "Not Affected").map(async (a) => { fixesBy.set(a.id, await fixesFor(user.id, a.id)); }));
  // Write permission is only looked up when web Fix is switched on (one cached-per-request call per installation).
  const perms = new Map<number, boolean>();
  if (env.FIX_ENABLED && hasGitHubApp()) for (const id of new Set(mine.map((m) => m.installation_id).filter((x): x is number => !!x))) {
    perms.set(id, await installationPermissions(id).then((p) => p.contents === "write" && p.pull_requests === "write").catch(() => false));
  }

  const cards: CardData[] = [...latest.values()].sort((x, y) => discoveredAt(y).localeCompare(discoveredAt(x))).map((a) => {
    const f = fmap.get(a.finding_id) ?? null;
    const r = rmap.get(a.repo);
    const ur = mine.find((m) => m.repo_key === a.repo);
    const sev = a.severity ?? deriveSeverity(a, []);
    const fixes = fixesBy.get(a.id) ?? [];
    const lf = latestFix(fixes);
    const loc = location(a);
    // An open (or merged) pull request shows as "fix ready to review"; it is never marked resolved by SaveBell itself.
    const status = localized(statusOf(a, sev, { resolved: resolved.has(a.id), prOpen: !!lf && ["pr_created", "blocked_by_protection", "merging"].includes(lf.status), merged: lf?.status === "merged" }), d);
    const href = caseHref(a.id);
    const act = findingAction(a, fixes, { fixEnabled: env.FIX_ENABLED, allowPr: !!ur?.allow_pr, isDemo: !ur, hasInstallation: !!ur?.installation_id, writePermission: ur?.installation_id ? perms.get(ur.installation_id) ?? null : null, mode: modeOf(user?.settings) }, href);
    return { a, f, sev, status, title: plainTitle(a, f, loc, r?.tech_tags, r?.packages.map((p) => p.name)), where: whereLine(a, loc), act, caseHref: href };
  });
  if (locale !== "en") {
    const top = cards.slice(0, 40);
    const out = await tr(locale, top.map((c) => c.title), [...new Set(cards.flatMap((c) => c.f?.claim?.packages.map((p) => p.name) ?? []))]);
    top.forEach((c, i) => { c.title = out[i] || c.title; });
    for (const c of cards) if (c.where.kind === "unverified" || c.where.kind === "none") c.where = { ...c.where, text: c.where.kind === "unverified" ? d.not_yet_confirmed : c.where.text };
  }
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as Filter) : LEGACY[sp.f ?? ""] ?? "all";
  const isOpen = (c: CardData) => c.status.kind !== "not_affected" && c.status.kind !== "resolved" && c.status.kind !== "fix_ready" && c.status.kind !== "fix_merged" && c.status.kind !== "withdrawn";
  // Repository filter (server-side): GitHub repositories as owner/name; fixture folders inside a repository belong to it.
  const ghRepo = (c: CardData) => c.a.repo.split("/").slice(0, 2).join("/");
  const allRelevant = cards.filter((c) => c.status.kind !== "not_affected");
  const repoCounts = new Map<string, number>();
  for (const c of allRelevant) repoCounts.set(ghRepo(c), (repoCounts.get(ghRepo(c)) ?? 0) + 1);
  for (const r of repos) if (!repoCounts.has(r.repo)) repoCounts.set(r.repo, 0);
  const selectedRepos = (sp.repo ?? "").split(",").map((x) => x.trim()).filter((x) => repoCounts.has(x));
  // ?repo=none: the user deselected every repository; show nothing (never silently fall back to all). Filtering changes
  // only what is displayed, never which repositories are monitored.
  const noneSelected = sp.repo === "none";
  const relevant = noneSelected ? [] : selectedRepos.length ? allRelevant.filter((c) => selectedRepos.includes(ghRepo(c))) : allRelevant;
  const shown = filter === "urgent" ? relevant.filter(isOpen) : filter === "resolved" ? relevant.filter((c) => !isOpen(c)) : relevant;
  const openCount = relevant.filter(isOpen).length;
  // One line per GitHub repository (fixture subfolders of the same repository collapse into it); worst status wins.
  const RANK = { bad: 0, warn: 1, ok: 2 } as const;
  const byRepo = new Map<string, ReturnType<typeof repoStatus>>();
  for (const r of repos) { const k = store.repoKey(r); const ur = mine.find((m) => m.repo_key === k); const st = repoStatus(r, { connected: !ur || !!ur.installation_id || !hasGitHubApp() }); const prev = byRepo.get(r.repo); if (!prev || RANK[st.tone] < RANK[prev.tone]) byRepo.set(r.repo, st); }
  const activeRun = await activeRunFor(user.id);
  const repoLines = [...byRepo.entries()].map(([k, s]) => ({ k, s: { ...s, label: s.label === "Monitoring active" ? d.monitoring_active : s.label === "Monitoring paused" ? d.monitoring_paused : s.label } }));

  return (
    <div className="mx-auto max-w-[calc(1080px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid gap-6">
      <header className="grid gap-3">
        <div className="grid gap-1">
          <h1 className="text-[calc(28px*var(--ui))] font-semibold tracking-[-0.02em] leading-tight">{d.nav_threats}</h1>
          <p className="text-[calc(15px*var(--ui))] text-ink2" aria-live="polite">{repos.length === 0 ? d.no_repos_short : openCount === 0 ? d.nothing_needs_you : openCount === 1 ? d.one_needs_you : d.n_need_you.replace("{n}", String(openCount))}</p>
        </div>
        {repoLines.length > 0 && (
          <div className="grid gap-1 text-[calc(13px*var(--ui))]">
            <div className="label">{d.monitored_repos}</div>
            <ul className="grid gap-0.5 max-h-[calc(180px*var(--ui))] overflow-auto" aria-label={d.repositories}>
              {repoLines.map(({ k, s }) => <li key={k} className="flex items-center gap-2 min-w-0"><span aria-hidden className={`tone-${s.tone} text-[calc(9px*var(--ui))] w-[calc(10px*var(--ui))] shrink-0 text-center`}>●</span><span className="font-medium truncate" title={k}>{k}</span>{s.label !== d.monitoring_active && <span className={`tone-${s.tone} shrink-0`}>{s.label}</span>}</li>)}
            </ul>
            {/* Indented by the status dot's width plus the row gap, so the link lines up with the repository names. */}
            <Link href="/settings#repositories" className="text-ink2 hover:text-ink underline w-fit ml-[calc(10px*var(--ui)_+_0.5rem*var(--ui))]">{d.manage_repos}</Link>
          </div>
        )}
      </header>

      {repos.length > 0 && (activeRun ? (
        <Link href={`/runs/${encodeURIComponent(activeRun.id)}`} className="border hair rounded-[10px] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[calc(14px*var(--ui))] hover:bg-raised">
          <span><b>Fix run {activeRun.status === "paused" ? "paused" : "in progress"}</b> <span className="text-ink2">until {fmtLocal(activeRun.tz, activeRun.end_ms)} · {activeRun.items.length} finding(s) so far</span></span>
          <span className="underline">View run</span>
        </Link>
      ) : (
        <details className="disclose border hair rounded-[10px] px-4 py-3 text-[calc(14px*var(--ui))]">
          <summary className="font-medium">Let SaveBell work while you&apos;re away</summary>
          <p className="mt-2 mb-3 text-[calc(13px*var(--ui))] text-ink2">SaveBell checks issues and prepares fixes while you&apos;re away. <Link href="/settings#runs" className="underline">Schedules and history</Link></p>
          <StartNowForm action={startWindowNow} repos={mine.filter((m) => !m.paused && !m.access_lost).map((m) => m.repo_key)} />
        </details>
      ))}

      {repos.length === 0 ? (
        <Empty title={d.empty_connect_title} body={d.empty_connect_body} action={<Link href="/repos" className="btn">{d.connect_github}</Link>} />
      ) : (
        <>
          <RememberThreatsView />
          <div className="flex flex-wrap items-center gap-3">
            {repoCounts.size > 1 && <RepoFilter repos={[...repoCounts.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([key, count]) => ({ key, count }))} selected={selectedRepos} none={noneSelected} />}
            <nav className="seg w-fit" aria-label="Filter threats by status">
              {FILTERS.map((f) => { const q = new URLSearchParams(); if (f !== "all") q.set("f", f); if (noneSelected) q.set("repo", "none"); else if (selectedRepos.length) q.set("repo", selectedRepos.join(",")); return <Link key={f} href={`/alerts${q.toString() ? `?${q}` : ""}`} aria-current={f === filter ? "page" : undefined}>{d[`filter_${f}` as keyof typeof d]}</Link>; })}
            </nav>
          </div>
          {noneSelected ? <Empty title={d.no_repos_selected} body={d.no_repos_selected_body} action={<Link href="/alerts" className="btn">{d.show_all_repos}</Link>} />
          : shown.length === 0 ? (
            filter === "resolved" ? <Empty title={d.empty_resolved_title} body={d.empty_resolved_body} />
              : <Empty title={d.empty_clear_title} body={d.empty_clear_body} />
          ) : (
            <BulkFix ids={shown.map((c) => c.a.id)} mode={modeOf(user?.settings)}><ul className="border hair rounded-[10px] bg-raised overflow-hidden">{shown.map((c) => <AlertCard key={c.a.id} c={c} labels={actionLabels(d)} />)}</ul></BulkFix>
          )}
        </>
      )}
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="border hair rounded-[10px] bg-raised px-6 py-12 grid justify-items-center text-center gap-2">
      <div className="text-[calc(15px*var(--ui))] font-semibold">{title}</div>
      <p className="text-[calc(14px*var(--ui))] text-ink2 max-w-[calc(440px*var(--ui))]">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
