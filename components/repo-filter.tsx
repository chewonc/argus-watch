"use client";
// Compact repository multi-select for the Threats page. The selection lives in the URL (?repo=owner/a,owner/b), so the
// server filters and counts consistently, links can be shared, and the status tabs keep it. Repositories are GitHub
// repositories (owner/name); fixture folders inside one repository are not treated as separate repositories.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export function RepoFilter({ repos, selected }: { repos: { key: string; count: number }[]; selected: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set(selected));
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const all = pick.size === 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const go = (keys: string[]) => {
    const p = new URLSearchParams(sp.toString());
    if (keys.length) p.set("repo", keys.join(",")); else p.delete("repo");
    setOpen(false);
    router.push(`${path}${p.toString() ? `?${p}` : ""}`);
  };
  const label = selected.length === 0 ? "All repositories" : selected.length === 1 ? selected[0] : `${selected.length} repositories`;
  const shown = repos.filter((r) => r.key.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div ref={wrap} className="relative">
      <button type="button" className="btn-ghost max-w-[min(320px,calc(100vw-32px))]" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => { setPick(new Set(selected)); setOpen((o) => !o); }}>
        <span className="text-ink2">Repository:</span> <span className="truncate">{label}</span> <span aria-hidden className="text-ink2">▾</span>
      </button>
      {selected.length > 0 && <button type="button" className="text-[12px] text-ink2 hover:text-ink underline ml-2" onClick={() => go([])}>Clear</button>}
      {open && (
        <div id={id} role="dialog" aria-label="Filter by repository" className="menu !left-0 !right-auto w-[min(320px,calc(100vw-32px))] !p-3 grid gap-2">
          <div className="text-[13px] font-semibold">Filter by repository</div>
          {repos.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" className="border hair rounded-[6px] px-2 h-8 text-[13px] bg-transparent" />}
          <ul className="grid gap-0.5 max-h-[260px] overflow-auto text-[13px]">
            <li><label className="flex items-center gap-2 px-1 py-1"><input type="checkbox" checked={all} onChange={() => setPick(new Set())} /> All repositories</label></li>
            {shown.map((r) => (
              <li key={r.key}><label className="flex items-center gap-2 px-1 py-1">
                <input type="checkbox" checked={pick.has(r.key)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} />
                <span className="flex-1 truncate">{r.key}</span><span className="text-ink2 text-[12px]">{r.count}</span>
              </label></li>
            ))}
          </ul>
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn" onClick={() => go([...pick])}>Apply</button></div>
        </div>
      )}
    </div>
  );
}

/** Remembers the current Threats filters for this tab so a finding page's back link returns to the same view. */
export function RememberThreatsView() {
  const sp = useSearchParams();
  useEffect(() => { try { sessionStorage.setItem("aw_threats_qs", sp.toString()); } catch { /* storage unavailable */ } }, [sp]);
  return null;
}

/** "← Threats" back link that restores the remembered filters (falls back to the unfiltered list). */
export function BackToThreats({ label }: { label: string }) {
  const [qs, setQs] = useState("");
  useEffect(() => { try { const v = sessionStorage.getItem("aw_threats_qs") ?? ""; const r = requestAnimationFrame(() => setQs(v)); return () => cancelAnimationFrame(r); } catch { /* storage unavailable */ } }, []);
  return <a href={`/alerts${qs ? `?${qs}` : ""}`} className="text-[13px] text-ink2 no-underline hover:text-ink w-fit">← {label}</a>;
}
