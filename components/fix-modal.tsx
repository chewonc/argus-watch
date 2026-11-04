"use client";
// "Fix security issue" modal, shared by the Threats list and the finding page. Opening it is cheap: it reads
// /api/fix-context (no model call, no runner job). Three tabs:
//   Verify    read-only: the evidence Argus has and what is still missing
//   AI Agent  copyable instructions for the user's own coding agent
//   Auto Fix  the remediation workflow (components/remediation.tsx) with the saved destination preference
// Unconfirmed findings never start Auto Fix: the tab explains that verification comes first.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { Fix } from "@/lib/schema";
import type { RemediationMode } from "@/lib/remediation-mode";
import { AskAgent } from "./ask-agent";
import { Remediation } from "./remediation";

type Ctx = {
  assessment_id: string; repo: string; default_branch: string; verified: boolean; verdict: string; location: string | null;
  evidence: { text: string; state: string; refs: { file: string; line: number | null; quote: string }[] }[]; missing: string[];
  fix: Fix | null; can_act: boolean; blocker: string | null; runner_enabled: boolean; runner_note: string | null;
  mode: RemediationMode; after_fix: string; agent_connected: boolean;
};
type Tab = "verify" | "agent" | "auto";
const STATE_WORD: Record<string, string> = { Observed: "Observed in your code", Inferred: "Inferred", Unknown: "Not established", Absent: "Not present" };

// autoOpen: on the finding page, links from notifications and older bookmarks (?act=1, ?verify=1, #fix) open the modal.
export function FixButton({ assessmentId, label = "Fix", className = "btn", autoOpen = false }: { assessmentId: string; label?: string; className?: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!autoOpen) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("act") !== "1" && q.get("verify") !== "1" && window.location.hash !== "#fix") return;
    const r = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(r);
  }, [autoOpen]);
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>{label}</button>
      {open && <FixModal assessmentId={assessmentId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function FixModal({ assessmentId, onClose }: { assessmentId: string; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const changed = useRef(false);

  const closedCb = useRef(() => {});
  useEffect(() => { closedCb.current = () => { if (changed.current) router.refresh(); onClose(); }; });
  // Native listener: Escape, ×, backdrop click and form-less close all end here, and the modal unmounts.
  useEffect(() => {
    const d = ref.current; if (!d) return;
    const h = () => closedCb.current();
    d.addEventListener("close", h); d.showModal();
    return () => d.removeEventListener("close", h);
  }, []);
  useEffect(() => {
    let live = true;
    fetch(`/api/fix-context?assessment_id=${encodeURIComponent(assessmentId)}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? r.statusText); return j as Ctx; })
      .then((j) => { if (!live) return; setCtx(j); setTab((t) => t ?? (j.verified ? "auto" : "verify")); })
      .catch((e) => live && setErr(String((e as Error).message)));
    return () => { live = false; };
  }, [assessmentId]);
  const close = () => { ref.current?.close(); };

  const tabs: { id: Tab; label: string }[] = [{ id: "verify", label: "Verify" }, { id: "agent", label: "AI Agent" }, { id: "auto", label: "Auto Fix" }];
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClick={(e) => { if (e.target === ref.current) close(); }}
      className="modal m-auto w-[min(640px,calc(100vw-32px))] max-h-[min(86vh,820px)] rounded-[12px] border hair bg-raised text-ink p-0 backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b hair">
        <h2 id={titleId} className="text-[16px] font-semibold">Fix security issue</h2>
        <button type="button" className="text-ink2 hover:text-ink text-[20px] leading-none px-1" aria-label="Close" onClick={close}>×</button>
      </div>
      <div role="tablist" aria-label="Ways to fix" className="flex gap-1 px-5 pt-3">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${titleId}-${t.id}`} aria-selected={tab === t.id} aria-controls={`${titleId}-panel`} disabled={!ctx}
            className={`px-3 h-8 rounded-[6px] text-[13px] ${tab === t.id ? "bg-[var(--line)] font-semibold" : "text-ink2 hover:text-ink"}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div id={`${titleId}-panel`} role="tabpanel" aria-labelledby={tab ? `${titleId}-${tab}` : undefined} className="px-5 py-4 overflow-auto max-h-[calc(min(86vh,820px)-110px)] grid gap-4">
        {err && <p role="alert" className="text-[13px] tone-bad">Could not load this finding: {err}</p>}
        {!ctx && !err && <p className="text-[13px] text-ink2" aria-live="polite">Loading…</p>}
        {ctx && tab === "verify" && <VerifyTab c={ctx} goAgent={() => setTab("agent")} />}
        {ctx && tab === "agent" && <AskAgent id={ctx.assessment_id} connected={ctx.agent_connected} verified={ctx.verified} />}
        {ctx && tab === "auto" && <AutoTab c={ctx} onChange={() => { changed.current = true; }} goVerify={() => setTab("verify")} />}
      </div>
    </dialog>
  );
}

function VerifyTab({ c, goAgent }: { c: Ctx; goAgent: () => void }) {
  return (
    <div className="grid gap-3 text-[13px]">
      <p className="text-[14px]">{c.verified ? "Confirmed: Argus established every required condition in your code." : "Not confirmed yet. This is a possible issue: Argus has not established every condition in your code, so it is not treated as a confirmed vulnerability."}{c.location ? <> Location: <span className="mono [overflow-wrap:anywhere]">{c.location}</span>.</> : null}</p>
      {c.evidence.length > 0 && (
        <div className="grid gap-1.5"><div className="label">Evidence</div>
          <ul className="grid gap-2">{c.evidence.map((e, i) => (
            <li key={i} className="grid gap-0.5">
              <div><span className={e.state === "Observed" ? "tone-ok" : e.state === "Unknown" ? "tone-warn" : "text-ink2"}>{STATE_WORD[e.state] ?? e.state}</span> · {e.text}</div>
              {e.refs.map((r, j) => <div key={j} className="mono text-[12px] text-ink2 [overflow-wrap:anywhere]">{r.file}{r.line ? `:${r.line}` : ""}{r.quote ? ` — ${r.quote}` : ""}</div>)}
            </li>
          ))}</ul>
        </div>
      )}
      {c.missing.length > 0 && <div className="grid gap-1"><div className="label">Missing information</div><ul className="list-disc pl-5 grid gap-0.5">{c.missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
      <p className="text-ink2">Verification is read-only. To check it in your own checkout, <button type="button" className="underline" onClick={goAgent}>ask your AI agent</button>; it cites the exact lines and reports back without changing code.</p>
    </div>
  );
}

function AutoTab({ c, onChange, goVerify }: { c: Ctx; onChange: () => void; goVerify: () => void }) {
  if (!c.verified) return (
    <div className="grid gap-2 text-[13px]">
      <p className="text-[14px]">Verification is required first.</p>
      <p>This finding is a possible issue, not a confirmed vulnerability. Automatic fixes are only prepared for confirmed findings, and opening this tab does not authorize any change.</p>
      <button type="button" className="btn w-fit" onClick={goVerify}>Go to Verify</button>
    </div>
  );
  const pending = c.fix && !["failed", "validation_failed", "cancelled", "drafted"].includes(c.fix.status);
  return (
    <div className="grid gap-3">
      <p className="text-[13px] flex flex-wrap gap-x-2 items-baseline"><span className="text-ink2">After fixing:</span> <b>{c.after_fix}</b> <Link href="/settings#remediation" className="text-[12px]">Change preference</Link></p>
      {c.mode === "branch" && <p className="text-[12px] text-ink2">Pushes to a new branch only. Merging into {c.default_branch} always needs your separate action on GitHub.</p>}
      {c.blocker && !pending && (
        <div role="note" className="text-[13px] border hair rounded-[8px] p-3 grid gap-1">
          <p><b>Auto Fix is unavailable here.</b> {c.blocker}</p>
          <p className="text-ink2">{c.blocker.startsWith("Deployment configuration") ? "This is a server setting for the operator of this deployment, not a problem with your repository." : c.blocker.startsWith("Repository permission") ? <>Fix the permission on <Link href="/repos">Repositories</Link>, or choose &quot;No repository writes&quot; in <Link href="/settings#remediation">Settings</Link>.</> : null} Verify and AI Agent remain available.</p>
        </div>
      )}
      {c.runner_note && <p className="text-[12px] text-ink2">{c.runner_note}</p>}
      {(c.can_act || pending) && <Remediation embedded assessmentId={c.assessment_id} initial={c.fix} canAct={c.can_act} runnerEnabled={c.runner_enabled} defaultBranch={c.default_branch} repo={c.repo} mode={c.mode} onChange={onChange} />}
      <p className="text-[12px] text-ink2">Your saved preference only chooses the destination. Every repository change still needs your approval of the exact patch.</p>
    </div>
  );
}
