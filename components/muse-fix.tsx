"use client";
// One-click remediation by Meta Muse Code: "Fix & create PR" (recommended) or "Fix & push". The user sees the preview
// diff above, opens this dialog, reviews exactly what will happen, and authorizes once. Progress is polled from the
// fix record and shown as an audit ladder (every step has a timestamp and, where possible, a GitHub link).
import { useEffect, useRef, useState } from "react";
import type { Fix } from "@/lib/schema";

type Info = { allowed_files: string[]; test_command: string | null; default_branch: string; blockers: string[] };
const ACTIVE = ["queued", "running", "validated", "merging"];

export type MuseLabels = { title: string; pr: string; push: string; recommended: string };
const MUSE_EN: MuseLabels = { title: "Automated fix · Meta Muse Code", pr: "Fix & create PR", push: "Fix & push", recommended: "recommended" };
export function MuseFix({ fix: initial, onChange, labels = MUSE_EN, autoOpen = false }: { fix: Fix; onChange?: (f: Fix) => void; labels?: MuseLabels; autoOpen?: boolean }) {
  const [fix, setFix] = useState<Fix>(initial);
  const [info, setInfo] = useState<Info | null>(null);
  const [mode, setMode] = useState<"pr" | "push">("pr");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!ACTIVE.includes(fix.status)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/fix/${fix.id}`); if (!r.ok) return;
      const j = await r.json(); setFix(j.fix); onChange?.(j.fix);
    }, 5000);
    return () => clearInterval(t);
  }, [fix.id, fix.status, onChange]);

  async function open(m: "pr" | "push") {
    setMode(m); setErr(null); setReviewed(false); dlg.current?.showModal();
    if (!info) { const r = await fetch(`/api/fix/${fix.id}/run`); const j = await r.json(); if (r.ok) setInfo(j); else setErr(j.error); }
  }
  async function authorize() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/fix/${fix.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, reviewed }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText);
      setFix(j.fix); onChange?.(j.fix); dlg.current?.close();
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  }

  const canStart = ["drafted", "failed", "validation_failed"].includes(fix.status) && fix.files.length > 0 || fix.status === "validation_failed";
  // Arriving from "Fix now" (?act=1): open the authorization dialog in PR mode once. Nothing runs until the user ticks
  // "I reviewed…" and authorizes.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || !canStart || opened.current) return;
    opened.current = true;
    const r = requestAnimationFrame(() => { void open("pr"); });
    return () => cancelAnimationFrame(r);
  }, [autoOpen, canStart]); // eslint-disable-line react-hooks/exhaustive-deps
  const started = fix.mode && fix.events.length > 0;
  return (
    <div className="grid gap-3 border hair rounded-[6px] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="label">{labels.title}</div>
        <span className="text-[12px] text-ink2">Edits run in an isolated runner. Nothing is written to your repository until you authorize it and validation passes.</span>
      </div>
      {canStart && (
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => open("pr")}>{labels.pr} <span className="text-ink2 font-normal">· {labels.recommended}</span></button>
          <button className="btn-ghost" onClick={() => open("push")}>{labels.push}</button>
        </div>
      )}
      {started && <RunLadder fix={fix} />}

      <dialog ref={dlg} className="modal" aria-labelledby="muse-fix-title">
        <form method="dialog" className="grid gap-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); authorize(); }}>
          <div id="muse-fix-title" className="serif text-[22px]">{mode === "pr" ? "Fix & create pull request" : "Fix & push to " + (info?.default_branch ?? "the default branch")}</div>
          <ul className="grid gap-1 list-disc pl-5">
            <li><b>Meta Muse Code</b> investigates and edits a fresh copy of <span className="mono">{fix.repo}</span> at <span className="mono">{fix.base_sha.slice(0, 7)}</span> inside an isolated GitHub Actions runner. Your code is never run on the Argus server.</li>
            <li>It may change only: <span className="mono">{info ? info.allowed_files.join(", ") : "…"}</span>. Any other change discards the whole result.</li>
            <li>Validation: syntax check and static remediation assessment always; repository tests: <b>{info ? (info.test_command ? <span className="mono">{info.test_command}</span> : "none detected, so no tests will run") : "…"}</b>. If tests fail, nothing is written.</li>
            {mode === "pr"
              ? <li>Then Argus creates branch <span className="mono">argus/fix-{fix.id.slice(0, 8)}</span>, commits, and opens a <b>draft</b> pull request for your review. The default branch is not changed and nothing is merged.</li>
              : <li>Then Argus opens a pull request and <b>merges it into {info?.default_branch ?? "the default branch"}</b> only after your repository&apos;s CI checks pass. If the repository has no passing CI check, it refuses to merge and leaves the pull request open; the runner&apos;s own tests never replace CI. Branch protection rules are respected; if they require a review, the PR stays open.</li>}
            <li>The diff you see may differ from Muse Code&apos;s final edit; you get the final diff, test log and audit trail before anything merges{mode === "push" ? " (push mode merges automatically once checks pass)" : ""}.</li>
            <li>Passing tests do not prove the vulnerability is gone. <b>Security remediation: not verified.</b></li>
          </ul>
          {info?.blockers.length ? <ul className="grid gap-1" role="alert" style={{ color: "var(--contradicted)" }}>{info.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
          <label className="flex items-center gap-2"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the proposed change and authorize this {mode === "pr" ? "pull request" : "push"}.</label>
          {err && <p role="alert" style={{ color: "var(--contradicted)" }}>{err}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => dlg.current?.close()}>Cancel</button>
            <button type="submit" className="btn" disabled={!reviewed || busy || !info || info.blockers.length > 0}>{busy ? "Starting…" : mode === "pr" ? "Authorize: fix & create PR" : "Authorize: fix & push"}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function RunLadder({ fix }: { fix: Fix }) {
  const r = fix.runner;
  const t = r?.tests;
  const st = fix.status;
  const final = st === "merged" ? { tone: "var(--observed)", text: "Merged", url: fix.commit_url, link: "View commit ↗" }
    : st === "pr_created" ? { tone: "var(--observed)", text: "Pull request opened", url: fix.pr_url, link: `${fix.repo}#${fix.pr_number} ↗` }
    : st === "merging" ? { tone: "var(--inferred)", text: "Pull request opened, waiting for checks before merging", url: fix.pr_url, link: `${fix.repo}#${fix.pr_number} ↗` }
    : st === "blocked_by_protection" ? { tone: "var(--inferred)", text: fix.error ?? "Merge refused", url: fix.pr_url, link: "Review PR ↗" }
    : st === "validation_failed" || st === "failed" ? { tone: "var(--contradicted)", text: fix.error ?? "Failed; nothing was written", url: r?.run_url ?? null, link: "Runner log ↗" }
    : { tone: "var(--ink-2)", text: st === "queued" ? "Starting the isolated runner…" : st === "running" ? "Muse Code is working on the fix…" : "Validated; writing to GitHub…", url: r?.run_url ?? null, link: "Runner log ↗" };
  return (
    <div className="grid gap-3">
      <div className="text-[14px]" style={{ color: final.tone }} aria-live="polite">{final.text}{final.url && <> · <a href={final.url} target="_blank" rel="noreferrer">{final.link}</a></>}</div>
      {r && (r.finished_at || r.summary) ? (
        <div className="grid gap-1 text-[12px]">
          {r.summary && <p className="text-[13px]"><span className="label mr-2">Muse Code</span>{r.summary}</p>}
          <div className="text-ink2">Changed: <span className="mono">{r.changed_files.join(", ") || "none"}</span>{r.rejected_files.length ? <span style={{ color: "var(--contradicted)" }}> · rejected: <span className="mono">{r.rejected_files.join(", ")}</span></span> : null}{r.steps != null ? ` · ${r.steps} agent step(s)` : ""}{r.muse_version ? ` · ${r.muse_version}` : ""}</div>
          <div>{t?.executed ? <span style={{ color: t.exit_code === 0 ? "var(--observed)" : "var(--contradicted)" }}>Tests executed: <span className="mono">{t.command}</span> → exit {t.exit_code}</span> : <span className="text-ink2">Tests: none executed (no test command detected). Checks were static only.</span>}</div>
          {t?.log && <details><summary className="cursor-pointer text-ink2">Test log</summary><pre className="mono whitespace-pre-wrap text-[11px] max-h-64 overflow-auto mt-1">{t.log}</pre></details>}
        </div>
      ) : null}
      <details open={false} className="text-[12px]"><summary className="label cursor-pointer">Audit trail ({fix.events.length})</summary>
        <ol className="grid gap-1 mt-2">{fix.events.map((e, i) => <li key={i} className="grid grid-cols-[150px_1fr] gap-2"><span className="mono text-ink2">{e.at.replace("T", " ").slice(0, 19)}Z</span><span><b>{e.actor}</b> {e.action.replace(/_/g, " ")}: {e.detail}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer">link ↗</a></>}</span></li>)}</ol>
      </details>
    </div>
  );
}
