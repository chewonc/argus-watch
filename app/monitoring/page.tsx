// Monitoring status: is each repository being watched, in plain words. Source coverage, polling intervals,
// latency and the raw pipeline log are kept under "Advanced diagnostics".
import Link from "next/link";
import Sources from "@/app/sources/page";
import { hasGitHubApp } from "@/lib/env";
import { repoStatus } from "@/lib/labels";
import { requireUser, visibleRepoKeys } from "@/lib/session";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Monitoring() {
  const user = await requireUser("/monitoring");
  const [keys, mine, log] = await Promise.all([visibleRepoKeys(user.id), store.listUserRepos(user.id), store.recentLog(80)]);
  const repos = (await store.listRepos()).filter((r) => keys.has(store.repoKey(r)));
  const lastCheck = log.find((l) => l.kind === "poll" || l.kind === "heartbeat" || l.kind === "webhook")?.at ?? null;
  const errors = recentErrors(log);
  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-10 grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Monitoring status</h1>
        <p className="text-[15px] text-ink2">{errors ? "Some checks had problems in the last hour. Monitoring continues and retries automatically." : "Argus Watch is checking new security threats against your repositories."}</p>
      </div>
      <section className="border hair rounded-[10px] bg-raised overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b hair text-[13px]"><span className="font-semibold">Security news sources</span><span className="text-ink2">{lastCheck ? `Last check ${ago(lastCheck)}` : "Waiting for first check"}</span></div>
        <ul>
          {repos.length === 0 && <li className="px-5 py-4 text-[14px] text-ink2">No repositories yet. <Link href="/repos">Add one</Link></li>}
          {repos.map((r) => { const k = store.repoKey(r); const ur = mine.find((m) => m.repo_key === k); const s = repoStatus(r, { connected: !ur || !!ur.installation_id || !hasGitHubApp() }); return (
            <li key={k} className="flex items-center justify-between gap-3 px-5 py-3 border-b hair last:border-0 text-[14px]"><span className="font-medium truncate">{k}</span><span className={`tone-${s.tone} shrink-0`}><span aria-hidden>{s.glyph}</span> {s.label}</span></li>); })}
        </ul>
      </section>
      <details className="disclose">
        <summary>Advanced diagnostics</summary>
        <div className="mt-6 grid gap-8 [&>div]:!p-0 [&>div]:!max-w-none">
          <Sources />
          <section>
            <h2 className="text-[13px] font-semibold mb-2">Raw pipeline log</h2>
            <ul className="mono text-[11px] grid gap-1 max-h-[360px] overflow-auto">
              {log.map((l, i) => <li key={i} className="flex gap-2"><span className="text-ink2 shrink-0">{l.at.slice(0, 19).replace("T", " ")}</span><span className="shrink-0 w-[62px]">{l.kind}</span><span className="truncate" title={l.detail}>{l.detail}</span></li>)}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}

function recentErrors(log: { kind: string; at: string }[]) { const now = Date.now(); return log.filter((l) => l.kind === "error" && now - Date.parse(l.at) < 3600e3).length; }
function ago(iso: string) { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; }
