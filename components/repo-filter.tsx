"use client";
// Compact repository multi-select for the Threats page. The selection lives in the URL (?repo=owner/a,owner/b), so the
// server filters and counts consistently, links can be shared, and the status tabs keep it. Repositories are GitHub
// repositories (owner/name); fixture folders inside one repository are not treated as separate repositories.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

// Empty selection is explicit (?repo=none) and shows no findings; it never silently means "all".
export function RepoFilter({ repos, selected, none = false }: { repos: { key: string; count: number }[]; selected: string[]; none?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const initial = () => new Set(none ? [] : selected.length ? selected : repos.map((r) => r.key));
  const [pick, setPick] = useState<Set<string>>(initial);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const all = pick.size === repos.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const go = (keys: string[]) => {
    const p = new URLSearchParams(sp.toString());
    if (keys.length === repos.length) p.delete("repo"); else if (keys.length === 0) p.set("repo", "none"); else p.set("repo", keys.join(","));
    setOpen(false);
    router.push(`${path}${p.toString() ? `?${p}` : ""}`);
  };
  const label = none ? "No repositories" : selected.length === 0 ? "All repositories" : selected.length === 1 ? selected[0] : `${selected.length} repositories`;
  const shown = repos.filter((r) => r.key.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div ref={wrap} className="relative">
      <button type="button" className="btn-ghost max-w-[min(320px,calc(100vw-32px))]" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => { setPick(initial()); setOpen((o) => !o); }}>
        <span className="text-ink2">Repository:</span> <span className="truncate">{label}</span> <span aria-hidden className="text-ink2">▾</span>
      </button>
      {(selected.length > 0 || none) && <button type="button" className="text-[calc(12px*var(--ui))] text-ink2 hover:text-ink underline ml-2" onClick={() => go(repos.map((r) => r.key))}>Reset</button>}
      {open && (
        <div id={id} role="dialog" aria-label="Filter by repository" className="menu !left-0 !right-auto w-[min(320px,calc(100vw-32px))] !p-3 grid gap-2">
          <div className="text-[calc(13px*var(--ui))] font-semibold">Filter by repository</div>
          {repos.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" className="border hair rounded-[6px] px-2 h-8 text-[calc(13px*var(--ui))] bg-transparent" />}
          <ul className="grid gap-0.5 max-h-[calc(260px*var(--ui))] overflow-auto text-[calc(13px*var(--ui))]">
            <li><label className="flex items-center gap-2 px-1 py-1"><input type="checkbox" checked={all} onChange={() => setPick(all ? new Set() : new Set(repos.map((r) => r.key)))} /> All repositories</label></li>
            {shown.map((r) => (
              <li key={r.key}><label className="flex items-center gap-2 px-1 py-1">
                <input type="checkbox" checked={pick.has(r.key)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} />
                <span className="flex-1 truncate">{r.key}</span><span className="text-ink2 text-[calc(12px*var(--ui))]">{r.count}</span>
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
  return <a href={`/alerts${qs ? `?${qs}` : ""}`} className="text-[calc(13px*var(--ui))] text-ink2 no-underline hover:text-ink w-fit">← {label}</a>;
}
