"use client";
// Bulk fixing on the Threats page: select issues → preview (nothing runs) → Prepare fixes (verification where needed, then
// one patch per issue through the same endpoints as a single Fix) → review grouped by repository → one explicit approval.
// The server re-checks every id, permission and patch; this component only orchestrates and shows outcomes.
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { approveLabel, groupFixes, type BulkItem, type FixGroup } from "@/lib/bulk";
import { DESTINATIONS, fixChecks, friendlyError } from "@/lib/fix-summary";
import type { RemediationMode } from "@/lib/remediation-mode";
import type { Fix } from "@/lib/schema";
import { Diff } from "./fix-preview";

type Sel = { selected: Set<string>; toggle: (id: string) => void };
const Ctx = createContext<Sel | null>(null);

/** Checkbox on one finding card. */
export function SelectBox({ id, label }: { id: string; label: string }) {
  const c = useContext(Ctx);
  if (!c) return null;
  return <input type="checkbox" className="w-4 h-4 self-center cursor-pointer" aria-label={`Select: ${label}`} checked={c.selected.has(id)} onChange={() => c.toggle(id)} />;
}

/** Wraps the Threats list: selection state, the contextual action bar, "Fix available", and the bulk modal. `ids` = findings shown in the current filter scope. */
export function BulkFix({ ids, mode, children }: { ids: string[]; mode: RemediationMode; children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string[] | null>(null);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = ids.length > 0 && ids.every((i) => selected.has(i));
  // Never keep selections that are no longer in scope (filter changed).
  useEffect(() => { const r = requestAnimationFrame(() => setSelected((s) => new Set([...s].filter((x) => ids.includes(x))))); return () => cancelAnimationFrame(r); }, [ids]);
  return (
    <Ctx.Provider value={{ selected, toggle }}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[calc(13px*var(--ui))]">
        <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4" checked={all} onChange={() => setSelected(all ? new Set() : new Set(ids))} /> Select all ({ids.length} shown)</label>
        {selected.size > 0
          ? <div className="flex items-center gap-2" role="toolbar" aria-label="Selected issues"><span>{selected.size} selected</span><button className="btn" onClick={() => setOpen([...selected])}>Fix selected</button><button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear</button></div>
          : <button className="btn-ghost" disabled={!ids.length} onClick={() => setOpen(ids)}>Fix available</button>}
      </div>
      {children}
      {open && <BulkModal ids={open} defaultMode={mode} onClose={() => setOpen(null)} />}
    </Ctx.Provider>
  );
}

type Preview = { items: BulkItem[]; counts: { ready: number; needs_verification: number; ineligible: number }; repos: string[]; estimate: { verification_checks: number; fix_attempts_max: number; hosted_used: number; hosted_cap: number } };
type Outcome = { id: string; title: string; repo: string; state: "pending" | "verifying" | "preparing" | "ready" | "unconfirmed" | "not_affected" | "failed" | "skipped" | "cancelled"; note?: string; fix?: Fix };
const post = async (url: string, body: unknown) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function BulkModal({ ids, defaultMode, onClose }: { ids: string[]; defaultMode: RemediationMode; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const tid = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"preview" | "running" | "results" | "done">("preview");
  const [out, setOut] = useState<Outcome[]>([]);
  const [mode, setMode] = useState<RemediationMode>(defaultMode);
  const [err, setErr] = useState<string | null>(null);
  const [approved, setApproved] = useState<{ fix_ids: string[]; ok: boolean; url?: string | null; error?: string }[] | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);
  const changed = useRef(false);

  useEffect(() => { const d = ref.current; d?.showModal(); const h = () => { if (changed.current) router.refresh(); onClose(); }; d?.addEventListener("close", h); return () => d?.removeEventListener("close", h); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { post("/api/bulk/preview", { assessment_ids: ids, mode: defaultMode }).then(setPreview).catch((e) => setErr(String(e.message))); }, [ids, defaultMode]);

  const included = (preview?.items ?? []).filter((i) => i.cls !== "ineligible" && !excluded.has(i.assessment_id));
  const set = (id: string, patch: Partial<Outcome>) => setOut((o) => o.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Prepare: verify uncertain issues (read-only), then prepare one patch per confirmed issue. Never writes to GitHub.
  const run = async () => {
    cancelled.current = false; changed.current = true; setPhase("running");
    setOut(included.map((i) => ({ id: i.assessment_id, title: i.title, repo: i.repo, state: "pending" })));
    const one = async (i: BulkItem) => {
      if (cancelled.current) return set(i.assessment_id, { state: "cancelled" });
      let aid = i.assessment_id;
      try {
        if (i.cls === "needs_verification") {
          set(aid, { state: "verifying" });
          const v = await post("/api/verify", { assessment_id: aid });
          const verdict = v.assessment.verdict as string;
          if (verdict === "Not Affected") return set(i.assessment_id, { state: "not_affected", note: "Not affected: the required conditions weren't found." });
          if (verdict !== "Affected") return set(i.assessment_id, { state: "unconfirmed", note: "Couldn't confirm this issue, so no fix was prepared." });
          aid = v.assessment.id;
        }
        if (cancelled.current) return set(i.assessment_id, { state: "cancelled" });
        set(i.assessment_id, { state: "preparing" });
        const ctx = await fetch(`/api/fix-context?assessment_id=${encodeURIComponent(aid)}`).then((r) => r.json());
        if (!ctx.can_act) return set(i.assessment_id, { state: "skipped", note: ctx.blocker ? String(ctx.blocker).replace(/^(Deployment configuration|Repository permission): /, "") : "Can't be fixed automatically." });
        let fix: Fix = (await post("/api/fix", { assessment_id: aid, force: true })).fix;
        if (ctx.runner_enabled && fix.status === "drafted" && fix.files.length) {
          fix = (await post(`/api/fix/${fix.id}/run`, { mode, reviewed: true })).fix;
          for (let t = 0; t < 150 && ["queued", "running"].includes(fix.status); t++) {
            if (cancelled.current) { await post(`/api/fix/${fix.id}/cancel`, {}).catch(() => {}); return set(i.assessment_id, { state: "cancelled", fix }); }
            await wait(4000); fix = (await fetch(`/api/fix/${fix.id}`).then((r) => r.json())).fix;
          }
        }
        const ok = (fix.status === "validated" || fix.status === "drafted") && fix.files.length > 0;
        set(i.assessment_id, ok ? { state: "ready", fix } : { state: "failed", fix, note: friendlyError(fix.error) });
      } catch (e) { set(i.assessment_id, { state: "failed", note: friendlyError(String((e as Error).message)) }); }
    };
    for (let k = 0; k < included.length; k += 2) await Promise.all(included.slice(k, k + 2).map(one)); // at most two at a time
    setPhase("results");
  };

  const ready = out.filter((o) => o.state === "ready" && o.fix);
  const groups: FixGroup[] = groupFixes(ready.map((o) => o.fix!));
  const approve = async () => {
    setErr(null);
    try { const j = await post("/api/bulk/approve", { mode, groups: groups.map((g) => ({ fix_ids: g.fixes.map((f) => f.id), patch_versions: g.fixes.map((f) => f.patch_version) })) }); setApproved(j.results); setPhase("done"); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  const close = () => ref.current?.close();
  const notOk = out.filter((o) => o.state !== "ready" && o.state !== "pending");

  return (
    <dialog ref={ref} aria-labelledby={tid} onClick={(e) => { if (e.target === ref.current) close(); }} className="m-auto w-[min(640px,calc(100vw-32px))] max-h-[min(86vh,820px)] rounded-[12px] border hair bg-raised text-ink p-0 backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b hair">
        <h2 id={tid} className="text-[calc(16px*var(--ui))] font-semibold">{phase === "preview" ? "Prepare fixes" : phase === "running" ? "Preparing fixes…" : phase === "done" ? "Done" : "Fixes ready"}</h2>
        <button type="button" aria-label="Close" className="text-ink2 text-[calc(22px*var(--ui))] w-10 h-10 -mr-2 grid place-items-center" onClick={close}>×</button>
      </div>
      <div className="px-4 sm:px-5 py-4 grid gap-4 overflow-auto max-h-[calc(min(86vh,820px)-70px)] text-[calc(13px*var(--ui))]">
        {err && <p role="alert" className="tone-bad">{err}</p>}
        {phase === "preview" && !preview && !err && <p className="text-ink2">Checking what can be fixed…</p>}

        {phase === "preview" && preview && (() => {
          const repos = new Set(included.map((i) => i.repo.split("/").slice(0, 2).join("/")));
          const nVerify = included.filter((i) => i.cls === "needs_verification").length;
          return (
            <>
              <p className="text-[calc(14px*var(--ui))]">{preview.items.length} issue{preview.items.length === 1 ? "" : "s"} selected{repos.size ? ` across ${repos.size} repositor${repos.size === 1 ? "y" : "ies"}` : ""}.</p>
              <ul className="grid gap-0.5">
                <li>{included.filter((i) => i.cls === "ready").length} ready for a fix attempt</li>
                <li>{nVerify} need verification first</li>
                <li>{preview.items.length - included.length} won&apos;t be processed</li>
              </ul>
              <details className="disclose"><summary>Issues to process</summary>
                <ul className="grid gap-2 mt-2">{preview.items.map((i) => (
                  <li key={i.assessment_id} className="flex items-start gap-2">
                    {i.cls !== "ineligible" ? <input type="checkbox" className="w-4 h-4 mt-0.5" aria-label={`Include ${i.title}`} checked={!excluded.has(i.assessment_id)} onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(i.assessment_id)) n.delete(i.assessment_id); else n.add(i.assessment_id); return n; })} /> : <span className="w-4" aria-hidden />}
                    <span className="grid min-w-0"><span className="[overflow-wrap:anywhere]">{i.title}</span><span className="text-ink2 text-[calc(12px*var(--ui))] [overflow-wrap:anywhere]">{i.repo.split("/").pop()} · {i.cls === "ready" ? "Ready" : i.cls === "needs_verification" ? "Needs verification" : i.reason}</span></span>
                  </li>))}</ul>
              </details>
              <div className="grid gap-0.5 text-ink2">
                <div className="label">Estimated work</div>
                <span>Up to {included.length} issue{included.length === 1 ? "" : "s"} to process, {nVerify} verification check{nVerify === 1 ? "" : "s"}, {repos.size} repositor{repos.size === 1 ? "y" : "ies"}.</span>
                <span>Each verification and fix uses Meta AI analysis{preview.estimate.hosted_cap >= 0 ? ` (${preview.estimate.hosted_used} of ${preview.estimate.hosted_cap} hosted analyses used this month)` : ""}. Nothing is written to your repositories in this step.</span>
              </div>
              {included.length === 0
                ? <div className="grid gap-2"><p className="text-[calc(14px*var(--ui))] font-semibold">No fixes available</p><p className="text-ink2">These issues can&apos;t be fixed automatically right now.</p><button className="btn-ghost w-fit" onClick={close}>Close</button></div>
                : <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={close}>Cancel</button><button className="btn" onClick={run}>{included.every((i) => i.cls === "needs_verification") ? "Verify and prepare" : "Prepare fixes"}</button></div>}
            </>
          );
        })()}

        {phase === "running" && (
          <>
            <ul className="grid gap-1" aria-live="polite">{out.map((o) => <li key={o.id} className="flex justify-between gap-3"><span className="truncate">{o.title}</span><span className="shrink-0 text-ink2">{{ pending: "Waiting", verifying: "Checking…", preparing: "Preparing…", ready: "✓ Ready", unconfirmed: "Couldn't confirm", not_affected: "Not affected", failed: "Couldn't fix", skipped: "Skipped", cancelled: "Cancelled" }[o.state]}</span></li>)}</ul>
            <button className="btn-ghost w-fit" onClick={() => { cancelled.current = true; }}>Cancel</button>
          </>
        )}

        {phase === "results" && (
          <>
            <p className="text-[calc(14px*var(--ui))]">{ready.length} fix{ready.length === 1 ? "" : "es"} prepared.{notOk.length ? ` ${notOk.length} need${notOk.length === 1 ? "s" : ""} attention.` : ""}</p>
            {groups.map((g, gi) => (
              <div key={gi} className="grid gap-1.5 border-t hair pt-3">
                <div className="font-semibold">{g.repo}</div>
                <div className="text-ink2">{g.fixes.length} fix{g.fixes.length === 1 ? "" : "es"} {g.combined ? "combined into one change" : "prepared"}{g.reason ? `. ${g.reason}` : ""}</div>
                <ul className="grid gap-0.5">{fixChecks({ files: g.fixes.flatMap((f) => f.files), runner: null, agent: "muse-code", syntax_check: [] } as unknown as Fix).filter((c) => !/tests|Not tested|No tests/.test(c.text)).map((c) => <li key={c.text} className={c.tone === "warn" ? "tone-warn" : ""}>{c.tone === "ok" ? "✓" : "⚠"} {c.text}</li>)}</ul>
                <details className="disclose"><summary>Review changes</summary><div className="grid gap-3 mt-2">{g.fixes.flatMap((f) => f.files).map((x, k) => <div key={k} className="border hair rounded-[6px] overflow-hidden"><div className="mono text-[calc(12px*var(--ui))] px-3 py-2 border-b hair [overflow-wrap:anywhere]">{x.path}</div><Diff patch={x.patch} /></div>)}</div></details>
              </div>
            ))}
            {notOk.length > 0 && <details className="disclose"><summary>Couldn&apos;t fix {notOk.length} issue{notOk.length === 1 ? "" : "s"}</summary><ul className="grid gap-1 mt-2">{notOk.map((o) => <li key={o.id}><span className="[overflow-wrap:anywhere]">{o.title}</span><span className="block text-ink2">{o.note ?? o.state}</span></li>)}</ul></details>}
            {groups.length > 0 && (
              <div className="grid gap-2 border-t hair pt-3">
                <label className="flex flex-wrap items-center gap-2"><span className="text-ink2">Apply fix as</span>
                  <select value={mode} onChange={(e) => setMode(e.target.value as RemediationMode)} className="border hair rounded-[6px] h-9 px-2 bg-transparent">{DESTINATIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
                <p className="text-ink2">{mode === "preview" ? "Nothing will be written to your repositories." : `${groups.length} ${mode === "branch" ? "new branch" : "draft pull request"}${groups.length === 1 ? "" : "s"}, one per change above. Nothing is merged.`} Tests passing doesn&apos;t prove a security fix works.</p>
                {mode === "preview"
                  ? <button className="btn w-fit" onClick={async () => { try { await navigator.clipboard.writeText(groups.flatMap((g) => g.fixes.flatMap((f) => f.files.map((x) => x.patch))).join("\n")); setCopied(true); } catch { /* clipboard unavailable */ } }}>{copied ? "Copied" : "Copy patches"}</button>
                  : <button className="btn w-fit" onClick={approve}>{approveLabel(mode, groups.length)}</button>}
              </div>
            )}
            {groups.length === 0 && <button className="btn-ghost w-fit" onClick={close}>Close</button>}
          </>
        )}

        {phase === "done" && approved && (
          <>
            <p className="text-[calc(14px*var(--ui))]">{approved.filter((r) => r.ok).length} of {approved.length} {mode === "branch" ? "branches pushed" : "pull requests created"}.</p>
            <ul className="grid gap-1">{approved.map((r, i) => <li key={i}>{r.ok ? <>✓ {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{mode === "branch" ? "View branch" : "View pull request"} ↗</a> : "Done"}</> : <span className="tone-bad">✗ {r.error}</span>}</li>)}</ul>
            <button className="btn-ghost w-fit" onClick={close}>Close</button>
          </>
        )}
      </div>
    </dialog>
  );
}
