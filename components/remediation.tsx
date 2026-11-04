"use client";
// One remediation workflow per finding: Review → (Prepare patch) → Approve → Draft PR → Result. It replaces the separate
// preview / Muse Code / PR panels. Nothing is written to the user's repository before "Approve & create draft PR",
// and with the Muse Code runner the user approves the exact validated patch (patch_version), not just the preview.
// Progress shows the real stage and elapsed time; Cancel calls the backend (lib/runner.ts cancelRun).
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Fix } from "@/lib/schema";
import { isStaleRun } from "@/lib/run-stale";
import { Assessment, Diff, RejectedHunks, StatusLadder } from "./fix-preview";
import { RunLadder } from "./muse-fix";

type RunInfo = { allowed_files: string[]; test_command: string | null; default_branch: string; blockers: string[] };
const POLL = ["drafting", "queued", "running", "approved", "merging"];
const RESULT = ["pr_created", "merging", "blocked_by_protection", "merged"];
const FAILED = ["failed", "validation_failed", "cancelled"];

const lineCounts = (patch: string) => patch.split("\n").reduce((n, l) => (l.startsWith("+") && !l.startsWith("+++") ? { ...n, add: n.add + 1 } : l.startsWith("-") && !l.startsWith("---") ? { ...n, del: n.del + 1 } : n), { add: 0, del: 0 });
const since = (iso: string | null | undefined, now: number) => { if (!iso) return null; const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

export function Remediation({ assessmentId, initial, canAct, runnerEnabled, defaultBranch, repo }: { assessmentId: string; initial: Fix | null; canAct: boolean; runnerEnabled: boolean; defaultBranch: string; repo: string }) {
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState<Fix | null>(initial);
  const [info, setInfo] = useState<RunInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  const call = useCallback(async (url: string, body?: unknown, method = "POST") => {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j.fix) setFix(j.fix);
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j;
  }, []);
  const act = async (name: string, fn: () => Promise<unknown>) => { setBusy(name); setErr(null); try { await fn(); setReviewed(false); } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); } };
  const draft = (force = false) => act("draft", () => call("/api/fix", { assessment_id: assessmentId, force }));

  // "Review & Fix" links carry ?act=1 (or #fix): open the workflow; prepare a read-only preview if none exists yet.
  useEffect(() => {
    const want = sp.get("act") === "1" || (typeof window !== "undefined" && window.location.hash === "#fix");
    if (!want) return;
    const r = requestAnimationFrame(() => {
      setOpen(true);
      document.getElementById("fix")?.scrollIntoView({ block: "start" });
      if (!fix && canAct && !started.current) { started.current = true; void draft(); }
    });
    return () => cancelAnimationFrame(r);
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = fix?.status ?? null;
  const stale = !!fix && isStaleRun(fix, now);
  // Poll while something is running; tick a clock for elapsed time.
  useEffect(() => {
    if (!fix || !POLL.includes(fix.status) || stale) return;
    const t = setInterval(async () => { const r = await fetch(`/api/fix/${fix.id}`); if (r.ok) { const j = await r.json(); setFix(j.fix); } }, 4000);
    return () => clearInterval(t);
  }, [fix, stale]);
  useEffect(() => { if (!busy && !(status && POLL.includes(status))) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [busy, status]);
  useEffect(() => {
    if (!open || !fix || !runnerEnabled || info || !["drafted", "validated", "failed", "validation_failed", "cancelled"].includes(fix.status)) return;
    fetch(`/api/fix/${fix.id}/run`).then((r) => (r.ok ? r.json() : null)).then((j) => j && setInfo(j)).catch(() => {});
  }, [open, fix, runnerEnabled, info]);

  if (!canAct && !fix) return null;
  const files = fix?.files ?? [];
  const validated = status === "validated";
  const byRunner = fix?.agent === "muse-code";
  const blockers = info?.blockers ?? [];
  const branch = fix ? `argus/fix-${fix.id.slice(0, 8)}` : "argus/fix-…";
  const stages = runnerEnabled ? ["Review", "Prepare patch", "Approve", "Draft PR"] : ["Review", "Approve", "Draft PR"];
  const stageIx = !fix || status === "drafting" || status === "drafted" ? 0
    : status === "queued" || status === "running" ? 1
    : validated ? (runnerEnabled ? 2 : 1)
    : status === "approved" ? stages.length - 1
    : RESULT.includes(status ?? "") ? stages.length : 0;

  return (
    <section id="fix" className="grid gap-3 scroll-mt-20" aria-label="Fix workflow">
      {!open ? (
        <button type="button" className="btn w-fit" onClick={() => { setOpen(true); if (!fix && canAct && !started.current) { started.current = true; void draft(); } }}>
          {RESULT.includes(status ?? "") ? "View fix status" : status && POLL.includes(status) ? "View progress" : validated ? "Review & approve the patch" : "Review & Fix"} <span aria-hidden>→</span>
        </button>
      ) : (
        <div className="border hair rounded-[10px] bg-raised p-4 sm:p-5 grid gap-4">
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" aria-label="Fix progress">
            {stages.map((s, i) => <li key={s} aria-current={i === stageIx ? "step" : undefined} className={i < stageIx ? "tone-ok" : i === stageIx ? "font-semibold" : "text-ink2"}>{i < stageIx ? "✓" : `${i + 1}`} {s}{i < stages.length - 1 && <span aria-hidden className="text-ink2 ml-3">›</span>}</li>)}
          </ol>
          {err && <p role="alert" className="text-[13px] tone-bad">{err}</p>}

          {/* Preparing the read-only preview */}
          {(!fix || status === "drafting") && <p className="text-[14px]" aria-live="polite">{busy === "draft" || status === "drafting" ? <>Preparing a proposed change from the cited files… <span className="text-ink2">(read-only, usually under a minute{busy === "draft" ? "" : ""})</span></> : <button className="btn" onClick={() => draft()}>Prepare a proposed change</button>}</p>}

          {/* REVIEW (preview or validated patch) */}
          {fix && (status === "drafted" || validated) && files.length > 0 && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="chip" style={{ color: validated ? "var(--observed)" : "var(--inferred)" }}>{validated ? "Validated patch · made by Muse Code in an isolated runner" : "Preliminary proposal · not yet validated"}</span>
                {validated && fix.runner?.validation_label && <span className="text-[12px] text-ink2">{fix.runner.validation_label}</span>}
              </div>
              <p className="text-[14px]">{fix.summary}</p>
              <ul className="grid gap-1 text-[13px]" aria-label="Files that will change">
                {files.map((x) => { const c = lineCounts(x.patch); return <li key={x.path} className="flex flex-wrap gap-x-2"><span className="mono [overflow-wrap:anywhere]">{x.path}</span><span className="tone-ok">+{c.add}</span><span className="tone-bad">−{c.del}</span></li>; })}
              </ul>
              <p className="text-[12px] text-ink2">Destination: a {autoMerge && validated ? "pull request that Argus merges only after your repository's CI passes" : "draft pull request"} on new branch <span className="mono">{branch}</span> in {repo}. Your default branch <span className="mono">{defaultBranch}</span> is not changed{autoMerge && validated ? " until CI passes" : " and nothing is merged"}. Security remediation is not verified by passing checks.</p>
              <details className="disclose"><summary>Code changes ({files.length} file{files.length === 1 ? "" : "s"})</summary>
                <div className="grid gap-3 mt-3">{files.map((x) => <div key={x.path} className="border hair rounded-[6px] overflow-hidden"><div className="mono text-[12px] px-3 py-2 border-b hair [overflow-wrap:anywhere]">{x.path}</div><Diff patch={x.patch} /></div>)}{fix.rejected_hunks.length > 0 && <RejectedHunks fix={fix} />}</div>
              </details>
              <details className="disclose"><summary>Validation &amp; remaining risks</summary>
                <div className="grid gap-4 mt-3"><StatusLadder fix={fix} />{fix.assessment && <Assessment fix={fix} />}{fix.caveats.length > 0 && <div className="text-[12px]"><div className="label">Caveats</div><ul className="list-disc pl-5">{fix.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}{byRunner && <RunLadder fix={fix} />}</div>
              </details>
              {blockers.length > 0 && <ul role="alert" className="grid gap-1 text-[13px] tone-bad">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}

              {/* APPROVE */}
              {(validated || !runnerEnabled) ? (
                <div className="grid gap-2 border-t hair pt-3">
                  <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> <span>I reviewed {validated ? "this patch" : "these changes"} and approve opening a pull request.</span></label>
                  {validated && <label className="flex items-start gap-2 text-[12px] text-ink2"><input type="checkbox" className="mt-0.5" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} /> <span>Also merge it automatically, but only after the repository&apos;s CI checks pass (never with missing or failing CI, never past branch protection).</span></label>}
                  <div className="flex flex-wrap gap-2">
                    <button className="btn" disabled={!reviewed || !!busy || blockers.length > 0} onClick={() => act("approve", () => validated ? call(`/api/fix/${fix.id}/approve`, { patch_version: fix.patch_version, mode: autoMerge ? "push" : "pr", reviewed: true }) : call(`/api/fix/${fix.id}/apply`, { reviewed: true }))}>{busy === "approve" ? "Creating pull request…" : autoMerge && validated ? "Approve & create PR (merge after CI)" : "Approve & create draft PR"}</button>
                    {validated ? <button className="btn-ghost" disabled={!!busy} onClick={() => act("discard", () => call(`/api/fix/${fix.id}/cancel`))}>Discard patch</button> : <button className="btn-ghost" disabled={!!busy} onClick={() => draft(true)}>Re-draft</button>}
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 border-t hair pt-3">
                  <p className="text-[13px]">Next, Meta Muse Code prepares and validates the real patch in an isolated GitHub Actions runner (about 2 minutes). <b>Nothing is written to your repository</b>: you review and approve that patch before a pull request is opened.{info?.test_command ? <> Tests: <span className="mono">{info.test_command}</span>.</> : info ? " No test command detected; checks will be static." : ""}</p>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn" disabled={!!busy || blockers.length > 0} onClick={() => act("prepare", () => call(`/api/fix/${fix.id}/run`, { mode: "pr", reviewed: true }))}>{busy === "prepare" ? "Starting…" : "Prepare validated patch"}</button>
                    <button className="btn-ghost" disabled={!!busy} onClick={() => draft(true)}>Re-draft preview</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* EXECUTE: preparing in the runner, or creating the PR */}
          {fix && (status === "queued" || status === "running" || status === "approved") && !stale && (
            <div className="grid gap-2" aria-live="polite">
              <ol className="grid gap-1 text-[13px]">
                {[["Preparing the isolated runner", status === "queued"], ["Muse Code generating and validating the patch", status === "running"], ["Creating the pull request", status === "approved"]].map(([label, cur]) => <li key={String(label)} className={cur ? "font-semibold" : "text-ink2"}>{cur ? "●" : "○"} {label}</li>)}
              </ol>
              <p className="text-[12px] text-ink2">Elapsed {since(status === "approved" ? fix.approved_at : fix.runner?.dispatched_at, now) ?? "—"}{status === "queued" ? " · GitHub usually starts the runner within seconds" : status === "running" ? " · the last measured run took about 1.5 minutes here" : ""}{fix.runner?.run_url && <> · <a href={fix.runner.run_url} target="_blank" rel="noreferrer">Runner log ↗</a></>}</p>
              {status === "approved"
                ? <p className="text-[12px] text-ink2">The pull request is being created and can no longer be cancelled; close it on GitHub if you change your mind.</p>
                : <button className="btn-ghost w-fit" disabled={!!busy} onClick={() => act("cancel", () => call(`/api/fix/${fix.id}/cancel`))}>{busy === "cancel" ? "Cancelling…" : "Cancel"}</button>}
            </div>
          )}

          {/* RESULT */}
          {fix && RESULT.includes(status ?? "") && (
            <div className="grid gap-2 text-[13px]">
              <p className="text-[14px]">{status === "merged" ? "Merged after your repository's checks passed." : status === "merging" ? "Pull request opened; waiting for your repository's CI before merging." : status === "blocked_by_protection" ? `Pull request open; not merged: ${fix.error ?? "merge refused"}.` : `${fix.pr_draft === false ? "Pull request" : "Draft pull request"} opened. Review and merge it on GitHub; the alert stays open until then.`}</p>
              <div className="flex flex-wrap gap-2">{fix.pr_url && <a className="btn" href={fix.pr_url} target="_blank" rel="noreferrer">Open pull request{fix.pr_number ? ` #${fix.pr_number}` : ""} ↗</a>}{status === "merged" && fix.commit_url && <a className="btn-ghost" href={fix.commit_url} target="_blank" rel="noreferrer">View commit ↗</a>}{status === "merging" && <button className="btn-ghost" disabled={!!busy} onClick={() => act("cancel", () => call(`/api/fix/${fix.id}/cancel`))}>Cancel automatic merge</button>}</div>
              <p className="text-ink2">Changed: <span className="mono [overflow-wrap:anywhere]">{files.map((x) => x.path).join(", ")}</span> · {fix.runner?.validation_label ?? (byRunner ? "validated in the isolated runner" : "syntax-checked only; no tests were run")} · security remediation not verified</p>
              {files.some((x) => /(^|\/)package\.json$/.test(x.path)) && !files.some((x) => /package-lock\.json$|npm-shrinkwrap\.json$/.test(x.path)) && <p className="tone-warn">The dependency manifest changed but no lockfile was regenerated: run your package manager&apos;s install in the PR branch before merging.</p>}
              <details className="disclose"><summary>Validation, CI &amp; audit trail</summary><div className="grid gap-3 mt-3"><StatusLadder fix={fix} />{byRunner && <RunLadder fix={fix} />}</div></details>
            </div>
          )}

          {/* FAILURE / CANCELLED / STALLED */}
          {fix && (FAILED.includes(status ?? "") || stale) && (
            <div className="grid gap-2 text-[13px]">
              <p className={status === "cancelled" ? "text-ink2" : "tone-bad"}>{stale ? "The runner never reported back. Nothing was written to your repository." : status === "cancelled" ? "Cancelled. Nothing was written to your repository." : `Stopped: ${fix.error ?? "the fix could not be completed"}. Nothing was written.`}{fix.runner?.run_url && <> <a href={fix.runner.run_url} target="_blank" rel="noreferrer">Runner log ↗</a></>}</p>
              <div className="flex flex-wrap gap-2">
                {runnerEnabled && files.length > 0 ? <button className="btn" disabled={!!busy || blockers.length > 0} onClick={() => act("prepare", () => call(`/api/fix/${fix.id}/run`, { mode: "pr", reviewed: true }))}>{busy === "prepare" ? "Starting…" : "Prepare the patch again"}</button> : null}
                <button className="btn-ghost" disabled={!!busy} onClick={() => draft(true)}>Start over with a new preview</button>
              </div>
            </div>
          )}

          <button type="button" className="text-[12px] text-ink2 w-fit underline" onClick={() => setOpen(false)}>Hide</button>
        </div>
      )}
    </section>
  );
}
