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
import { ResultDialog, type ResultInfo } from "./result-dialog";

type Ctx = {
  assessment_id: string; repo: string; default_branch: string; verified: boolean; verdict: string; location: string | null;
  code_url: string | null;
  evidence: Evidence[]; missing: string[];
  fix: Fix | null; can_act: boolean; blocker: string | null; runner_enabled: boolean; runner_note: string | null;
  mode: RemediationMode; after_fix: string; agent_connected: boolean;
  grant: { kind: "install" | "accept" | "allow_changes"; url: string | null } | null; repo_key: string;
};
type Tab = "verify" | "agent" | "auto";
export type Evidence = { text: string; state: string; computed?: boolean; refs: { file: string; line: number | null; quote: string; url: string | null }[] };
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

export function FixModal({ assessmentId: initialId, onClose }: { assessmentId: string; onClose: () => void }) {
  // A fresh verification stores a new assessment record; the modal follows it.
  const [assessmentId, setAssessmentId] = useState(initialId);
  const [reload, setReload] = useState(0);
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  // Tabs stay mounted once opened (hidden when inactive), so Verify results, Auto Fix progress and copied prompts
  // survive switching tabs. Nothing reruns unless the user asks.
  const [visited, setVisited] = useState<Set<Tab>>(new Set());
  if (tab && !visited.has(tab)) setVisited(new Set([...visited, tab])); // derived during render (React's documented pattern)
  const [dialog, setDialog] = useState<ResultInfo | null>(null);
  const verifyDone = useRef<string | null>(null); // assessment id a finished verification is waiting for
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
      .then((j) => {
        if (!live) return; setCtx(j); setTab((t) => t ?? (j.verified ? "auto" : "verify"));
        // A verification just finished: summarize the result the backend recorded (never assumed on the client).
        if (verifyDone.current && verifyDone.current === j.assessment_id) { verifyDone.current = null; setDialog(verifySummary(j)); }
      })
      .catch((e) => live && setErr(String((e as Error).message)));
    return () => { live = false; };
  }, [assessmentId, reload]);
  const close = () => { ref.current?.close(); };

  const tabs: { id: Tab; label: string }[] = [{ id: "verify", label: "Verify" }, { id: "auto", label: "Auto Fix" }, { id: "agent", label: "AI Agent" }];
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClick={(e) => { if (e.target === ref.current) close(); }}
      className="modal m-auto w-[min(640px,calc(100vw-32px))] max-h-[min(86vh,820px)] rounded-[12px] border hair bg-raised text-ink p-0 backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b hair">
        <h2 id={titleId} className="text-[calc(16px*var(--ui))] font-semibold">Fix security issue</h2>
        <button type="button" className="text-ink2 hover:text-ink text-[calc(22px*var(--ui))] leading-none w-10 h-10 -mr-2 grid place-items-center" aria-label="Close" onClick={close}>×</button>
      </div>
      <div role="tablist" aria-label="Ways to fix" className="flex gap-1 px-4 sm:px-5 pt-3 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${titleId}-${t.id}`} aria-selected={tab === t.id} aria-controls={`${titleId}-panel`} disabled={!ctx}
            className={`px-2.5 sm:px-3 h-9 rounded-[6px] text-[calc(13px*var(--ui))] whitespace-nowrap ${tab === t.id ? "bg-[var(--line)] font-semibold" : "text-ink2 hover:text-ink"}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div id={`${titleId}-panel`} role="tabpanel" aria-labelledby={tab ? `${titleId}-${tab}` : undefined} className="px-4 sm:px-5 py-4 overflow-auto max-h-[calc(min(86vh,820px)-110px)] grid gap-4">
        {err && <p role="alert" className="text-[calc(13px*var(--ui))] tone-bad">Could not load this finding: {err}</p>}
        {!ctx && !err && <p className="text-[calc(13px*var(--ui))] text-ink2" aria-live="polite">Loading…</p>}
        {ctx && visited.has("verify") && <div hidden={tab !== "verify"}><VerifyTab c={ctx}
          onVerified={(id) => { changed.current = true; verifyDone.current = id; if (id !== assessmentId) setAssessmentId(id); else setReload((n) => n + 1); }}
          onFailed={(msg) => setDialog({ tone: "bad", title: "Verification failed", summary: "The check could not be completed, so nothing was recorded.", points: [msg], next: "Try again in a minute. The previous result is unchanged." })} /></div>}
        {ctx && visited.has("agent") && <div hidden={tab !== "agent"}><AskAgent id={ctx.assessment_id} connected={ctx.agent_connected} verified={ctx.verified} /></div>}
        {ctx && visited.has("auto") && <div hidden={tab !== "auto"}><AutoTab c={ctx} onChange={() => { changed.current = true; }} goVerify={() => setTab("verify")} recheck={() => setReload((n) => n + 1)} onDone={setDialog} /></div>}
        {dialog && <ResultDialog info={dialog} onOk={() => setDialog(null)} />}
      </div>
    </dialog>
  );
}

/** Completion summary from the context the backend returned after a verification. */
function verifySummary(c: Ctx): ResultInfo {
  const observed = c.evidence.filter((e) => e.state === "Observed").length;
  const points = [
    `Repository: ${c.repo} (latest commit)`,
    `${c.evidence.length} required condition${c.evidence.length === 1 ? "" : "s"} checked, ${observed} observed in your code`,
    ...(c.location ? [`Location: ${c.location.split("/").pop()}`] : []),
    ...(c.missing.length ? [`${c.missing.length} piece${c.missing.length === 1 ? "" : "s"} of evidence still missing`] : []),
  ];
  if (c.verified) return { tone: "bad", title: "Verification complete: confirmed", summary: "Argus found evidence in your code that this vulnerability affects your project.", points, next: "Open Auto Fix to prepare a fix, or use AI Agent to fix it in your editor." };
  if (c.verdict === "Not Affected") return { tone: "ok", title: "Verification complete: not affected", summary: "The conditions this vulnerability needs were not found in your code.", points, next: "Nothing to fix. Argus checks again when your code changes." };
  return { tone: "warn", title: "Verification complete: inconclusive", summary: "There isn't enough evidence to confirm or rule out this vulnerability.", points, next: "Review the missing evidence, or ask your AI agent to check the code locally." };
}

function VerifyTab({ c, onVerified, onFailed }: { c: Ctx; onVerified: (assessmentId: string) => void; onFailed: (message: string) => void }) {
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const fileName = c.location ? c.location.split("/").pop() : null;
  // Runs a fresh, read-only check in Argus (POST /api/verify): same analyzer and evidence rules as the pipeline.
  const verify = async () => {
    setState("checking"); setErr(null);
    try {
      const r = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assessment_id: c.assessment_id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setState("done"); onVerified(j.assessment.id);
    } catch (e) { const m = String((e as Error).message); setErr(m); setState("idle"); onFailed(m); }
  };
  const result = c.verified ? "confirmed" : c.verdict === "Not Affected" ? "not_affected" : state === "done" ? "unclear" : "possible";
  const head = { confirmed: "Confirmed", not_affected: "Not affected", unclear: "Unable to confirm", possible: "Possible issue" }[result];
  const text = {
    confirmed: "We found evidence that this vulnerability affects your code.",
    not_affected: "The required vulnerability conditions were not found in your code.",
    unclear: "There isn't enough evidence to determine whether your code is affected.",
    possible: "We haven't confirmed whether this vulnerability affects your code.",
  }[result];
  if (state === "checking") return (
    <div className="grid gap-2 text-[calc(13px*var(--ui))]" aria-live="polite">
      <p className="text-[calc(15px*var(--ui))] font-semibold">Checking your code…</p>
      <p className="text-ink2">Reading the relevant files at the latest commit. This can take a minute or two. Nothing in your repository is changed.</p>
    </div>
  );
  return (
    <div className="grid gap-4 text-[calc(13px*var(--ui))]">
      <div className="grid gap-1">
        <p className={`text-[calc(15px*var(--ui))] font-semibold ${result === "confirmed" ? "tone-bad" : result === "not_affected" ? "tone-ok" : "tone-warn"}`}>{head}</p>
        <p className="text-ink2">{text}</p>
      </div>
      {c.location && result !== "not_affected" && (
        <div className="flex flex-wrap items-center gap-2">
          {c.code_url
            ? <a href={c.code_url} target="_blank" rel="noreferrer" className="btn-ghost w-fit no-underline" title={c.location}>View code on GitHub <span aria-hidden>↗</span><span className="sr-only"> (opens {c.location} in a new tab)</span></a>
            : <span className="text-ink2">Exact GitHub link unavailable for</span>}
          <span className="mono text-[calc(12px*var(--ui))] text-ink2" title={c.location}>{fileName}</span>
        </div>
      )}
      {((c.missing.length > 0 && result !== "confirmed") || c.evidence.length > 0) && (
        <div className="grid gap-1">
          {c.missing.length > 0 && result !== "confirmed" && <details className="disclose"><summary>Missing evidence ({c.missing.length})</summary><ul className="list-disc pl-5 grid gap-0.5 mt-2">{c.missing.map((m) => <li key={m}>{m}</li>)}</ul></details>}
          {c.evidence.length > 0 && <EvidenceList items={c.evidence} />}
        </div>
      )}
      {err && <p role="alert" className="tone-bad">{err}</p>}
      <div className="flex flex-wrap gap-2">
        {result === "confirmed" ? <button type="button" className="btn-ghost" onClick={verify}>Check again</button>
          : <button type="button" className="btn" onClick={verify}>{result === "unclear" ? "Try again" : "Verify"}</button>}
      </div>
      <p className="text-[calc(12px*var(--ui))] text-ink2">Verification is read-only and runs in Argus Watch. A result is recorded only when it meets the same evidence rules as the original analysis.</p>
    </div>
  );
}

/** Evidence behind a native disclosure (collapsed by default). Paths are shown once per group, by file name; the full path is in the link title. */
export function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <details className="disclose">
      <summary>Evidence ({items.length})</summary>
      <ul className="grid gap-3 mt-3">{items.map((e, i) => (
        <li key={i} className="grid gap-1">
          <div><span className={e.state === "Observed" ? "tone-ok" : e.state === "Unknown" ? "tone-warn" : "text-ink2"}>{STATE_WORD[e.state] ?? e.state}</span>{e.computed ? " (computed)" : ""} · {e.text}</div>
          {e.refs.map((r, j) => (
            <div key={j} className="grid gap-0.5 pl-3 border-l hair">
              <span className="text-[calc(12px*var(--ui))] text-ink2">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" title={r.file} className="mono">{r.file.split("/").pop()}{r.line ? `:${r.line}` : ""} ↗</a> : <span className="mono" title={r.file}>{r.file.split("/").pop()}{r.line ? `:${r.line}` : ""}</span>}</span>
              {r.quote && <pre className="mono text-[calc(12px*var(--ui))] whitespace-pre-wrap [overflow-wrap:anywhere] bg-[var(--line)]/40 rounded-[4px] px-2 py-1">{r.quote}</pre>}
            </div>
          ))}
        </li>
      ))}</ul>
    </details>
  );
}

function AutoTab({ c, onChange, goVerify, recheck, onDone }: { c: Ctx; onChange: () => void; goVerify: () => void; recheck: () => void; onDone: (info: ResultInfo) => void }) {
  // While a permission is missing, re-read it when the user comes back from GitHub (focus) and every few seconds, so
  // "Approve & Fix" returns by itself. The prepared patch and the chosen destination live in the fix record and in the
  // still-mounted Auto Fix panel, so nothing is lost.
  const waiting = !!c.grant;
  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => recheck();
    window.addEventListener("focus", onFocus);
    const t = setInterval(recheck, 8000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, [waiting, recheck]);
  if (!c.verified) return (
    <div className="grid gap-2 text-[calc(13px*var(--ui))]">
      <p className="text-[calc(15px*var(--ui))] font-semibold">Verification needed first</p>
      <p className="text-ink2">This is a possible issue, not a confirmed vulnerability. Fixes are prepared only for confirmed findings.</p>
      <button type="button" className="btn w-fit" onClick={goVerify}>Verify</button>
    </div>
  );
  const pending = c.fix && !["failed", "validation_failed", "cancelled", "drafted"].includes(c.fix.status);
  return (
    <div className="grid gap-3">
      {c.grant && <GrantPermission c={c} recheck={recheck} />}
      {c.blocker && !pending && !c.grant && (
        <div role="note" className="text-[calc(13px*var(--ui))] grid gap-1">
          <p className="text-[calc(15px*var(--ui))] font-semibold">Auto Fix is unavailable</p>
          <p className="text-ink2">{((b) => b.charAt(0).toUpperCase() + b.slice(1))(c.blocker.replace(/^(Deployment configuration|Repository permission): /, ""))}</p>
          {c.blocker.startsWith("Repository permission") && <p className="text-ink2">Manage access on <Link href="/settings#repositories">Settings → Repositories</Link>. The AI Agent tab still works.</p>}
        </div>
      )}
      {(c.can_act || pending || c.grant) && <Remediation assessmentId={c.assessment_id} initial={c.fix} canAct={c.can_act} runnerEnabled={c.runner_enabled} defaultBranch={c.default_branch} repo={c.repo} mode={c.mode} onChange={onChange} onDone={onDone} permissionMissing={!!c.grant} />}
    </div>
  );
}

/**
 * Shown only when Argus lacks a permission for this repository. Opens GitHub's own approval page (a new tab, so this
 * workflow stays open) or, for Argus's own per-repository opt-in, turns it on with one click. GitHub App permissions
 * are the App's fixed set (Contents and Pull requests write); GitHub lets you limit them to the repositories you choose.
 */
function GrantPermission({ c, recheck }: { c: Ctx; recheck: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const g = c.grant!;
  const how = g.kind === "install" ? "Install the Argus Watch GitHub App on this repository. GitHub asks you to choose the repositories and confirm."
    : g.kind === "accept" ? "GitHub needs you to approve the App's Contents and Pull requests write access for the repositories you selected. Nothing is changed in your code by approving."
    : "Changes are turned off for this repository in Argus. Turning them on writes nothing to GitHub; each change still needs your approval.";
  const allow = async () => {
    setBusy(true); setErr(null);
    try { const r = await fetch("/api/repos/allow-changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo_key: c.repo_key }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? r.statusText); recheck(); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  };
  return (
    <div role="note" className="text-[calc(13px*var(--ui))] grid gap-2 border hair rounded-[8px] px-3 py-3">
      <p className="tone-bad font-medium">Argus doesn&apos;t have permission to change this repository.</p>
      <p className="text-ink2">{how}</p>
      <div className="flex flex-wrap items-center gap-2">
        {g.kind === "allow_changes"
          ? <button type="button" className="btn" disabled={busy} onClick={allow}>{busy ? "Granting…" : "Grant Permission"}</button>
          : <a className="btn no-underline" href={g.url ?? "#"} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>Grant Permission <span aria-hidden>↗</span></a>}
        {g.kind !== "allow_changes" && opened && <button type="button" className="btn-ghost" onClick={recheck}>I&apos;ve approved it</button>}
      </div>
      {g.kind !== "allow_changes" && <p className="text-[calc(12px*var(--ui))] text-ink2">{opened ? "Waiting for GitHub. This updates by itself when you come back to this tab." : "Opens GitHub in a new tab. Come back here afterwards; your prepared fix stays as it is."}</p>}
      {err && <p role="alert" className="tone-bad">{err}</p>}
    </div>
  );
}
