// Alerts dashboard. Answers only: do I need to do anything, which issues, which repository is watched.
// Signed out: one sentence, a sample alert, sign in. Technical monitoring detail lives on /monitoring.
import Link from "next/link";
import { AlertCard, type CardData } from "@/components/alerts";
import { Landing } from "@/components/landing";
import { env, hasAuth, hasGitHubApp } from "@/lib/env";
import { canFix } from "@/lib/fixgate";
import { installationPermissions } from "@/lib/github-app";
import { getDict, getLocale, tr } from "@/lib/i18n";
import { caseHref, discoveredAt, location, plainTitle, repoStatus, statusOf, whereLine } from "@/lib/labels";
import { deriveSeverity } from "@/lib/severity";
import { currentUser, visibleRepoKeys } from "@/lib/session";
import { store } from "@/lib/store";

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
  if (!user) return <Landing signin={sp.signin === "1"} next={sp.next} authReady={hasAuth()} />;

  const keys = await visibleRepoKeys(user.id);
  const [assessmentsAll, findings, reposAll, resolvedSet, mine] = await Promise.all([
    store.listAssessments(400), store.listFindings(), store.listRepos(), store.resolvedSet(user.id), store.listUserRepos(user.id),
  ]);
  const repos = reposAll.filter((r) => keys.has(store.repoKey(r)));
  const fmap = new Map(findings.map((f) => [f.id, f]));
  const rmap = new Map(repos.map((r) => [store.repoKey(r), r]));
  // latest assessment per (finding, repo): re-assessments supersede older ones
  const latest = new Map<string, (typeof assessmentsAll)[number]>();
  for (const a of assessmentsAll) { if (!keys.has(a.repo)) continue; const k = `${a.finding_id}|${a.repo}`; if (!latest.has(k) || latest.get(k)!.timestamps.processed_at < a.timestamps.processed_at) latest.set(k, a); }
  const resolved = new Set(resolvedSet);
  const fixStates = new Map<string, "none" | "pr_created" | "failed" | "drafted">();
  await Promise.all([...latest.values()].filter((a) => a.verdict !== "Not Affected").map(async (a) => { const fx = await store.listFixes(a.id); fixStates.set(a.id, fx.some((x) => x.status === "pr_created") ? "pr_created" : fx.some((x) => x.status === "drafted" || x.status === "approved") ? "drafted" : fx.some((x) => x.status === "failed") ? "failed" : "none"); }));
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
    const fs = fixStates.get(a.id) ?? "none";
    const loc = location(a);
    const status = statusOf(a, sev, { resolved: resolved.has(a.id), prOpen: fs === "pr_created" });
    const fix = status.kind !== "fix_ready" && status.kind !== "resolved" && canFix(a, { allowPr: !!ur?.allow_pr, isDemo: !ur, hasInstallation: !!ur?.installation_id, writePermission: ur?.installation_id ? perms.get(ur.installation_id) ?? null : null, loc, priorFailed: fs === "failed" });
    return { a, f, sev, status, title: plainTitle(a, f, loc, r?.tech_tags, r?.packages.map((p) => p.name)), where: whereLine(a, loc), fix, caseHref: caseHref(a.id) };
  });
  if (locale !== "en") {
    const top = cards.slice(0, 40);
    const out = await tr(locale, top.map((c) => c.title), [...new Set(cards.flatMap((c) => c.f?.claim?.packages.map((p) => p.name) ?? []))]);
    top.forEach((c, i) => { c.title = out[i] || c.title; });
  }
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as Filter) : LEGACY[sp.f ?? ""] ?? "all";
  const isOpen = (c: CardData) => c.status.kind !== "not_affected" && c.status.kind !== "resolved" && c.status.kind !== "fix_ready";
  const relevant = cards.filter((c) => c.status.kind !== "not_affected");
  const shown = filter === "urgent" ? relevant.filter(isOpen) : filter === "resolved" ? relevant.filter((c) => !isOpen(c)) : relevant;
  const openCount = relevant.filter(isOpen).length;
  // One line per GitHub repository (fixture subfolders of the same repository collapse into it); worst status wins.
  const RANK = { bad: 0, warn: 1, ok: 2 } as const;
  const byRepo = new Map<string, ReturnType<typeof repoStatus>>();
  for (const r of repos) { const k = store.repoKey(r); const ur = mine.find((m) => m.repo_key === k); const st = repoStatus(r, { connected: !ur || !!ur.installation_id || !hasGitHubApp() }); const prev = byRepo.get(r.repo); if (!prev || RANK[st.tone] < RANK[prev.tone]) byRepo.set(r.repo, st); }
  const repoLines = [...byRepo.entries()].map(([k, s]) => ({ k, s }));

  return (
    <div className="mx-auto max-w-[1080px] px-4 sm:px-6 py-8 sm:py-10 grid gap-6">
      <header className="grid gap-3">
        <div className="grid gap-1">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight">{d.nav_alerts}</h1>
          <p className="text-[15px] text-ink2" aria-live="polite">{repos.length === 0 ? d.no_repos_short : openCount === 0 ? d.nothing_needs_you : openCount === 1 ? d.one_needs_you : d.n_need_you.replace("{n}", String(openCount))}</p>
        </div>
        {repoLines.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]" aria-label={d.repositories}>
            {repoLines.slice(0, 3).map(({ k, s }) => <li key={k} className="flex items-center gap-2"><span className="font-medium">{k}</span><span className={`tone-${s.tone}`}><span aria-hidden className="text-[9px] align-[1px]">{s.glyph}</span> {s.label}</span></li>)}
            {repoLines.length > 3 && <li className="text-ink2">+{repoLines.length - 3} more</li>}
            <li><Link href="/repos" className="text-ink2 hover:text-ink underline">{d.manage}</Link></li>
          </ul>
        )}
      </header>

      {repos.length === 0 ? (
        <Empty title={d.empty_connect_title} body={d.empty_connect_body} action={<Link href="/repos" className="btn">{d.connect_github}</Link>} />
      ) : (
        <>
          <nav className="seg w-fit" aria-label="Filter alerts">
            {FILTERS.map((f) => <Link key={f} href={f === "all" ? "/" : `/?f=${f}`} aria-current={f === filter ? "page" : undefined}>{d[`filter_${f}` as keyof typeof d]}</Link>)}
          </nav>
          {shown.length === 0 ? (
            filter === "resolved" ? <Empty title={d.empty_resolved_title} body={d.empty_resolved_body} />
              : <Empty title={d.empty_clear_title} body={d.empty_clear_body} />
          ) : (
            <ul className="border hair rounded-[10px] bg-raised overflow-hidden">{shown.map((c) => <AlertCard key={c.a.id} c={c} labels={{ view: d.view, fix: d.fix }} />)}</ul>
          )}
        </>
      )}
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="border hair rounded-[10px] bg-raised px-6 py-12 grid justify-items-center text-center gap-2">
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="text-[14px] text-ink2 max-w-[440px]">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
