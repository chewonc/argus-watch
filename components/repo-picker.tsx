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
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" className="border hair rounded-[6px] px-3 h-9 text-[14px] bg-transparent" />
      <ul className="grid max-h-[320px] overflow-auto text-[14px] border hair rounded-[8px]">
        {shown.map((r) => (
          <li key={r.full_name} className="flex items-center gap-3 px-3 py-2 border-b hair last:border-0">
            <input type="checkbox" name="repo" value={r.full_name} defaultChecked={r.watched} disabled={r.watched} onChange={(e) => setN((x) => x + (e.target.checked ? 1 : -1))} id={`r-${r.full_name}`} />
            <label htmlFor={`r-${r.full_name}`} className="flex-1 truncate"><span>{r.full_name}</span>{r.private && <span className="text-ink2 text-[12px] ml-2">private</span>}{r.watched && <span className="text-ink2 text-[12px] ml-2">already watching</span>}</label>
          </li>
        ))}
        {shown.length === 0 && <li className="text-ink2 px-3 py-2">No repositories match.</li>}
      </ul>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={n === 0}>{n ? `Start monitoring ${n}` : "Select repositories"}</button>
      </div>
    </form>
  );
}
