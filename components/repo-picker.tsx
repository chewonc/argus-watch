"use client";
// Checkbox list of the repositories an installation grants; already-watched ones are shown checked and disabled.
import { useState } from "react";

export type PickRepo = { full_name: string; private: boolean; default_branch: string; language: string | null; watched: boolean };

export function RepoPicker({ installationId, repos, action }: { installationId: number; repos: PickRepo[]; action: (fd: FormData) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(0);
  const shown = repos.filter((r) => r.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="installation_id" value={installationId} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter repositories" className="border hair rounded-[4px] px-2 py-1 text-[13px] bg-transparent" />
      <ul className="grid gap-1 max-h-[320px] overflow-auto text-[13px]">
        {shown.map((r) => (
          <li key={r.full_name} className="flex items-center gap-2">
            <input type="checkbox" name="repo" value={r.full_name} defaultChecked={r.watched} disabled={r.watched} onChange={(e) => setN((x) => x + (e.target.checked ? 1 : -1))} id={`r-${r.full_name}`} />
            <label htmlFor={`r-${r.full_name}`} className="flex-1 truncate"><span className="mono">{r.full_name}</span>{r.private && <span className="label ml-2">private</span>}{r.language && <span className="text-ink2 ml-2">{r.language}</span>}{r.watched && <span className="label ml-2">watched</span>}</label>
          </li>
        ))}
        {shown.length === 0 && <li className="text-ink2">No repositories match.</li>}
      </ul>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={n === 0}>Watch {n || ""} selected</button>
        <span className="text-[12px] text-ink2">Argus Watch reads lockfiles and the files it cites at one commit. Nothing is written until you enable draft PRs and approve a specific fix.</span>
      </div>
    </form>
  );
}
