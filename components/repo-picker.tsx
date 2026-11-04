"use client";
// Searchable checkbox list of the repositories an installation grants on GitHub. A tick means "SaveBell monitors
// this repository"; GitHub access is a separate thing managed on GitHub. Unticking a monitored repository stops
// monitoring it (after a confirmation) and keeps its history; it never changes GitHub access. Every row stays
// mounted while searching, so choices made before narrowing the search are still submitted.
import { useState } from "react";

export type PickRepo = { full_name: string; private: boolean; default_branch: string; language: string | null; watched: boolean };

export function RepoPicker({ installationId, repos, action, manageHref, back }: { installationId: number; repos: PickRepo[]; action: (fd: FormData) => Promise<void>; manageHref?: string; back?: string }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set()); // not monitored yet, ticked: start
  const [dropped, setDropped] = useState<Set<string>>(new Set()); // monitored, unticked: stop
  const [busy, setBusy] = useState(false);
  const match = (r: PickRepo) => r.full_name.toLowerCase().includes(q.trim().toLowerCase());
  const visible = repos.filter(match).length;
  const flip = (set: typeof setPicked, name: string, on: boolean) => set((s) => { const n = new Set(s); if (on) n.add(name); else n.delete(name); return n; });
  const onChange = (r: PickRepo, checked: boolean) => (r.watched ? flip(setDropped, r.full_name, !checked) : flip(setPicked, r.full_name, checked));
  const changes = picked.size + dropped.size;
  const label = !changes ? "Select repositories" : [picked.size ? `Start monitoring ${picked.size}` : "", dropped.size ? `stop ${dropped.size}` : ""].filter(Boolean).join(", ").replace(/^stop/, "Stop monitoring");
  return (
    <form action={action} className="grid gap-3"
      onSubmit={(e) => {
        if (dropped.size && !window.confirm(`Stop monitoring ${[...dropped].join(", ")}?\n\nSaveBell stops checking ${dropped.size === 1 ? "it" : "them"} for new threats. Existing alerts stay, and GitHub access is not changed. You can tick ${dropped.size === 1 ? "it" : "them"} again any time.`)) { e.preventDefault(); return; }
        setBusy(true);
      }}>
      {back && <input type="hidden" name="back" value={back} />}
      <input type="hidden" name="installation_id" value={installationId} />
      {[...dropped].map((n) => <input key={n} type="hidden" name="stop" value={n} />)}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" className="border hair rounded-[6px] px-3 h-9 text-[calc(14px*var(--ui))] bg-transparent" />
      <p className="text-[calc(12px*var(--ui))] text-ink2">Repositories you gave SaveBell access to on GitHub. Ticked ones are monitored.</p>
      <ul className="grid max-h-[calc(320px*var(--ui))] overflow-auto text-[calc(14px*var(--ui))] border hair rounded-[8px]" aria-label="Repositories">
        {repos.map((r) => {
          const on = r.watched ? !dropped.has(r.full_name) : picked.has(r.full_name);
          return (
            <li key={r.full_name} hidden={!match(r)} className="flex items-center gap-3 px-3 py-2 border-b hair last:border-0">
              <input type="checkbox" name={r.watched ? undefined : "repo"} value={r.full_name} checked={on} onChange={(e) => onChange(r, e.target.checked)} id={`r-${installationId}-${r.full_name}`} />
              <label htmlFor={`r-${installationId}-${r.full_name}`} className="flex-1 truncate"><span>{r.full_name}</span>{r.private && <span className="text-ink2 text-[calc(12px*var(--ui))] ml-2">private</span>}
                {r.watched && <span className={`text-[calc(12px*var(--ui))] ml-2 ${on ? "text-ink2" : "tone-warn"}`}>{on ? "monitored" : "will stop"}</span>}
                {!r.watched && on && <span className="tone-ok text-[calc(12px*var(--ui))] ml-2">will start</span>}</label>
            </li>
          );
        })}
        {visible === 0 && <li className="text-ink2 px-3 py-2">{repos.length ? "No repositories match." : "This installation grants no repositories yet."}</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn" disabled={changes === 0 || busy}>{busy ? "Saving…" : label}</button>
        {manageHref && <a href={manageHref} target="_blank" rel="noreferrer" className="text-[calc(13px*var(--ui))] text-ink2 hover:text-ink">Manage GitHub access</a>}
      </div>
    </form>
  );
}
