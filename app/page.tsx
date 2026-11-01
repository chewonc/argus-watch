// Watch dashboard. Signed out: what this is and the sign-in. Signed in: per-repo status, counts by severity,
// actionable alert cards (newest first), coverage and watched repos in the aside.
import Link from "next/link";
import { AlertCard, Counts, type CardData } from "@/components/alerts";
import { SignInButton } from "@/components/sign-in-button";
import { fmtTime, human } from "@/components/ui";
import { env, hasAuth } from "@/lib/env";
import { computeLatency } from "@/lib/latency";
import { FEEDS } from "@/lib/sources/rss";
import { deriveSeverity } from "@/lib/severity";
import { currentUser, visibleRepoKeys } from "@/lib/session";
import { SYSTEM_USER, store } from "@/lib/store";

export const dynamic = "force-dynamic";
const FILTERS = ["needs_action", "new", "all", "resolved", "not_affected"] as const;

export default async function Watch({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await currentUser();
  const sp = await searchParams;
  if (!user) return <Landing signin={sp.signin === "1"} next={sp.next} />;

  const keys = await visibleRepoKeys(user.id);
  const [assessmentsAll, findings, log, reposAll, readSet, resolvedSet, mine] = await Promise.all([
    store.listAssessments(400), store.listFindings(), store.recentLog(60), store.listRepos(), store.readSet(user.id), store.resolvedSet(user.id), store.listUserRepos(user.id),
  ]);
  const repos = reposAll.filter((r) => keys.has(store.repoKey(r)));
  const fmap = new Map(findings.map((f) => [f.id, f]));
  // latest assessment per (finding, repo): re-assessments supersede older ones
  const latest = new Map<string, (typeof assessmentsAll)[number]>();
  for (const a of assessmentsAll) { if (!keys.has(a.repo)) continue; const k = `${a.finding_id}|${a.repo}`; if (!latest.has(k) || latest.get(k)!.timestamps.processed_at < a.timestamps.processed_at) latest.set(k, a); }
  const read = new Set(readSet), resolved = new Set(resolvedSet);
  const fixStates = new Map<string, CardData["fixState"]>();
  await Promise.all([...latest.values()].filter((a) => a.verdict !== "Not Affected").map(async (a) => { const fx = await store.listFixes(a.id); fixStates.set(a.id, fx.some((x) => x.status === "pr_created") ? "pr_created" : fx.some((x) => x.status === "drafted" || x.status === "approved") ? "drafted" : fx.some((x) => x.status === "failed") ? "failed" : "none"); }));
  const cards: CardData[] = [...latest.values()].sort((x, y) => y.timestamps.processed_at.localeCompare(x.timestamps.processed_at)).map((a) => {
    const f = fmap.get(a.finding_id) ?? null;
    const ur = mine.find((m) => m.repo_key === a.repo);
    return { a, f, sev: a.severity ?? deriveSeverity(a, []), read: read.has(a.id), resolved: resolved.has(a.id) || fixStates.get(a.id) === "pr_created", fixState: fixStates.get(a.id) ?? "none", allowPr: !!ur?.allow_pr, localRoot: ur?.local_root ?? null, caseHref: `/case/${a.id.split("/").map(encodeURIComponent).join("/")}` };
  });
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as (typeof FILTERS)[number]) : "needs_action";
  const shown = cards.filter((c) => filter === "all" ? true : filter === "needs_action" ? c.a.verdict !== "Not Affected" && !c.resolved : filter === "new" ? !c.read && c.a.verdict !== "Not Affected" : filter === "resolved" ? c.resolved : c.a.verdict === "Not Affected");
  const lat = await computeLatency(assessmentsAll, findings);
  const lastDelivery = log.find((l) => l.kind === "webhook" && /security_advisory/.test(l.detail))?.at ?? null;
  const health = repos.map((r) => { const k = store.repoKey(r); const open = cards.filter((c) => c.a.repo === k && c.a.verdict !== "Not Affected" && !c.resolved); const sys = !mine.some((m) => m.repo_key === k); return { k, r, open: open.length, worst: open[0]?.sev.level, sys }; });

  return (
    <div className="mx-auto max-w-[1480px] px-6 py-8 grid gap-10 lg:grid-cols-[1fr_340px]">
      <section className="grid gap-8 content-start">
        <div>
          <h1 className="serif text-[40px] leading-tight">What touched your code.</h1>
          <p className="text-ink2 mt-1">Advisories and research signals checked against {repos.length} watched {repos.length === 1 ? "repository" : "repositories"}, continuously, read-only. Absence of alerts is evidence from inspected files only, never proof of safety.</p>
        </div>

        <div>
          <h2 className="label mb-3">Repositories</h2>
          {health.length === 0 && <p className="text-[13px]">No repositories watched yet. <Link href="/repos">Connect GitHub and pick repositories →</Link></p>}
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {health.map((h) => (
              <li key={h.k} className="border hair rounded-[6px] p-3 text-[13px]">
                <div className="mono truncate">{h.k}{h.sys && <span className="label ml-2">demo</span>}</div>
                <div className={h.open ? `chip-sev-${h.worst ?? "moderate"}` : "text-ink2"}>{h.open ? `${h.open} need${h.open === 1 ? "s" : ""} attention` : "no issues found in inspected files"}</div>
                <div className="mono text-[11px] text-ink2">@{h.r.sha?.slice(0, 7) ?? "?"} · {h.r.packages.length} pkgs · synced {h.r.refreshed_at ? fmtTime(h.r.refreshed_at) : "never"}</div>
              </li>
            ))}
          </ul>
        </div>

        <Counts cards={cards} />

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
            <h2 className="label">Alerts</h2>
            <nav className="flex gap-3 text-[12px]">{FILTERS.map((f) => <Link key={f} href={`/?f=${f}`} className={f === filter ? "font-semibold" : ""}>{f.replace("_", " ")}</Link>)}</nav>
          </div>
          {shown.length === 0 && <p className="text-ink2 text-[13px]">{cards.length === 0 ? "No alerts yet. Alerts appear here automatically when a discovered finding matches a watched repository." : "Nothing in this filter."}</p>}
          <ul className="grid gap-4">{shown.map((c) => <AlertCard key={c.a.id} c={c} repo={c.a.repo} />)}</ul>
        </div>
      </section>

      <aside className="grid gap-8 content-start">
        <div>
          <h2 className="label mb-3">Coverage</h2>
          <ul className="text-[13px] grid gap-2">
            <Row glyph="●" name="GitHub-reviewed advisories" cls={lastDelivery ? `push · last delivery ${fmtTime(lastDelivery)}` : "push · no live deliveries yet"} />
            <Row glyph="◐" name="GitHub Advisory Database" cls="near-real-time · every 5 min" />
            <Row glyph="◐" name={`${FEEDS.filter((f) => f.cadence === "fast").length} fast disclosure feeds`} cls="near-real-time · every 5 min" />
            <Row glyph="○" name={`CISA KEV · ${FEEDS.filter((f) => f.cadence === "slow").length} research feeds`} cls="periodic · 10 min / hourly" />
            <Row glyph="⊘" name="X, LinkedIn, Threads, Reddit" cls="not accessible" />
          </ul>
          <Link href="/sources" className="text-[12px] mt-2 inline-block">Measured intervals and latency →</Link>
        </div>
        <div>
          <h2 className="label mb-3">Latency (live, backlog excluded)</h2>
          <div className="text-[13px]">publish → alert: {lat.total_publish_to_alert.n ? <span className="mono">{human(lat.total_publish_to_alert.median_s)} median · p90 {human(lat.total_publish_to_alert.p90_s)} · n={lat.total_publish_to_alert.n}</span> : <span className="text-ink2">no live alerts measured yet</span>}</div>
          <div className="text-[13px]">alert → push received: {lat.L6_receipt.n ? <span className="mono">{human(lat.L6_receipt.median_s)} · n={lat.L6_receipt.n}</span> : <span className="text-ink2">no push receipts yet</span>}</div>
        </div>
        <div>
          <h2 className="label mb-3">Watched</h2>
          <ul className="text-[13px] grid gap-1">
            {repos.map((r) => <li key={store.repoKey(r)} className="flex justify-between gap-2"><span className="truncate">{store.repoKey(r)}</span><span className="mono text-ink2 shrink-0">{r.packages.length} pkgs</span></li>)}
          </ul>
          <Link href="/repos" className="text-[12px] mt-2 inline-block">Manage repositories →</Link>
          {env.DEMO_SHARED_REPOS && keys.size > 0 && (await store.listUserRepoKeys(SYSTEM_USER)).length > 0 && <p className="mono text-[11px] text-ink2 mt-2">demo repositories are shared with every signed-in user</p>}
        </div>
        <details>
          <summary className="label cursor-pointer">Live log</summary>
          <ul className="mono text-[11px] grid gap-1 max-h-[360px] overflow-auto mt-2">
            {log.map((l, i) => <li key={i} className="flex gap-2"><span className="text-ink2 shrink-0">{l.at.slice(11, 19)}</span><span className="shrink-0 w-[62px]">{l.kind}</span><span className="truncate" title={l.detail}>{l.detail}</span></li>)}
          </ul>
        </details>
      </aside>
    </div>
  );
}

function Landing({ signin, next }: { signin: boolean; next?: string }) {
  return (
    <div className="mx-auto max-w-[860px] px-6 py-16 grid gap-8">
      <div>
        <h1 className="serif text-[44px] leading-tight">What touched your code.</h1>
        <p className="text-[16px] mt-3">Argus Watch watches security advisories and research disclosures continuously, checks each one against the repositories you connect, and tells you exactly where and why your code is affected, with a proposed fix you can review and open as a draft pull request.</p>
      </div>
      <ul className="grid sm:grid-cols-3 gap-4 text-[13px]">
        <li className="border hair rounded-[6px] p-4"><div className="label mb-1">Discover</div>GitHub advisories (push), GitHub Advisory DB and disclosure feeds (every 5 min), CISA KEV and research feeds (periodic).</li>
        <li className="border hair rounded-[6px] p-4"><div className="label mb-1">Locate and explain</div>Lockfile versions computed in code; conditions assessed with cited lines; verdicts decided by a fixed rule, never by the model alone.</li>
        <li className="border hair rounded-[6px] p-4"><div className="label mb-1">Fix, with your approval</div>Diff preview, a static remediation assessment, then a draft PR on a new branch. Nothing is merged and no repository code is ever executed here.</li>
      </ul>
      <div className="border hair rounded-[6px] p-5 grid gap-3">
        {signin && <p className="text-[13px]" style={{ color: "var(--inferred)" }}>Sign in to continue{next ? ` to ${next}` : ""}.</p>}
        <p className="text-[13px]">Sign in with GitHub, then connect the Argus Watch GitHub App to the repositories you want monitored. Read-only by default; write permission is used only for draft pull requests you explicitly approve per repository and per fix.</p>
        {hasAuth() ? <SignInButton next={next ?? "/"} /> : <p className="text-[13px] text-ink2">Sign-in is not configured on this deployment yet.</p>}
        <p className="text-[12px] text-ink2">See <Link href="/sources">Sources</Link> for what is monitored and how often, with measured intervals.</p>
      </div>
    </div>
  );
}

function Row({ glyph, name, cls }: { glyph: string; name: string; cls: string }) {
  return <li className="flex gap-2"><span aria-hidden className="w-4">{glyph}</span><span className="flex-1">{name}<span className="block mono text-[11px] text-ink2">{cls}</span></span></li>;
}
