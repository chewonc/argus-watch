"use client";
// Searchable checkbox list of the repositories an installation grants. Already-monitored ones are shown checked and
// disabled. Every row stays mounted while searching (hidden rows keep their checkbox state), so a repository picked
// before narrowing the search is still submitted and the count is exact.
import { useState } from "react";

export type PickRepo = { full_name: string; private: boolean; default_branch: string; language: string | null; watched: boolean };

export function RepoPicker({ installationId, repos, action, manageHref, back }: { installationId: number; repos: PickRepo[]; action: (fd: FormData) => Promise<void>; manageHref?: string; back?: string }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const match = (r: PickRepo) => r.full_name.toLowerCase().includes(q.trim().toLowerCase());
  const visible = repos.filter(match).length;
  const toggle = (name: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(name); else n.delete(name); return n; });
  return (
    <form action={action} onSubmit={() => setBusy(true)} className="grid gap-3">
      {back && <input type="hidden" name="back" value={back} />}
      <input type="hidden" name="installation_id" value={installationId} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" className="border hair rounded-[6px] px-3 h-9 text-[14px] bg-transparent" />
      <ul className="grid max-h-[320px] overflow-auto text-[14px] border hair rounded-[8px]" aria-label="Repositories">
        {repos.map((r) => (
          <li key={r.full_name} hidden={!match(r)} className="flex items-center gap-3 px-3 py-2 border-b hair last:border-0">
            <input type="checkbox" name="repo" value={r.full_name} checked={r.watched || picked.has(r.full_name)} disabled={r.watched} onChange={(e) => toggle(r.full_name, e.target.checked)} id={`r-${installationId}-${r.full_name}`} />
            <label htmlFor={`r-${installationId}-${r.full_name}`} className="flex-1 truncate"><span>{r.full_name}</span>{r.private && <span className="text-ink2 text-[12px] ml-2">private</span>}{r.watched && <span className="text-ink2 text-[12px] ml-2">monitored</span>}</label>
          </li>
        ))}
        {visible === 0 && <li className="text-ink2 px-3 py-2">{repos.length ? "No repositories match." : "This installation grants no repositories yet."}</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn" disabled={picked.size === 0 || busy}>{busy ? "Adding…" : picked.size ? `Start monitoring ${picked.size}` : "Select repositories"}</button>
        {manageHref && <a href={manageHref} target="_blank" rel="noreferrer" className="text-[13px] text-ink2 hover:text-ink">Repository missing? Grant access on GitHub ↗</a>}
      </div>
    </form>
  );
}
