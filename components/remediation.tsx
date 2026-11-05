"use client";
// Auto Fix tab of the Fix modal: one state-driven view per fix status (no numbered wizard). Outcome first, technical
// details collapsed. Writes happen only when the user clicks the approval button for the exact patch and the destination
// shown next to it; the server binds that click to user, repository, commit, patch hash and destination
// (lib/write-auth.ts). The destination dropdown defaults to the saved Settings preference, applies to this attempt only,
// and never writes by itself. Automatic merging is never offered as part of an approval.
import { fixBranch } from "@/lib/fix-branch";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Fix } from "@/lib/schema";
import { isStaleRun } from "@/lib/run-stale";
import { DESTINATIONS, fixChecks, friendlyError, type Check } from "@/lib/fix-summary";
import type { RemediationMode } from "@/lib/remediation-mode";
import { Assessment, Diff, RejectedHunks, StatusLadder } from "./fix-preview";
import { RunLadder } from "./muse-fix";
import type { ResultInfo } from "./result-dialog";
import { DONE, fixSummary } from "@/lib/fix-summary";


const WORKING = ["drafting", "queued", "running"];
const since = (from: number | null, now: number) => { if (!from) return null; const s = Math.max(0, Math.round((now - from) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

function Checks({ items }: { items: Check[] }) {
  return <ul className="grid gap-0.5 text-[calc(13px*var(--ui))]">{items.map((c) => <li key={c.text} className={c.tone === "ok" ? "" : c.tone === "bad" ? "tone-bad" : "tone-warn"}><span aria-hidden>{c.tone === "ok" ? "✓" : c.tone === "bad" ? "✗" : "⚠"}</span> {c.text}</li>)}</ul>;
}

/** The repository's own CI on the fix branch (read-only). CI results are build health, not proof the vulnerability is fixed. */
function RepoCI({ fix }: { fix: Fix }) {
  const [runs, setRuns] = useState(fix.check_runs ?? []);
  const [at, setAt] = useState(fix.checks_at);
  const [busy, setBusy] = useState(false);
  if (!fix.pr_url) return null;
  const refresh = async () => { setBusy(true); try { const r = await fetch(`/api/fix/${fix.id}/checks`, { method: "POST" }); const j = await r.json().catch(() => ({})); if (j.fix) { setRuns(j.fix.check_runs ?? []); setAt(j.fix.checks_at ?? null); } } finally { setBusy(false); } };
  return (
    <div>
      <div className="label">Repository CI (GitHub)</div>
      {runs.length ? <ul className="grid gap-0.5">{runs.map((r) => <li key={r.name}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a> : r.name}: {r.conclusion ?? r.status}</li>)}</ul> : <p>{at ? "No checks reported for this branch." : "Not read yet."}</p>}
      <p className="text-ink2 mt-1">CI results come from your repository and do not show that the vulnerability is fixed.</p>
      <button className="btn-ghost mt-1" disabled={busy} onClick={refresh}>{busy ? "Reading…" : "Refresh CI status"}</button>
    </div>
  );
}

function TechnicalDetails({ fix }: { fix: Fix }) {
  return (
    <details className="disclose"><summary>Technical details</summary>
      <div className="grid gap-4 mt-3 text-[calc(12px*var(--ui))]">
        {fix.summary && <div><div className="label">{fix.agent === "muse-code" ? "Muse Code's note (written before the checks)" : "Proposal note"}</div><p>{fix.summary}</p></div>}
        {fix.error && <div><div className="label">Error</div><p className="mono [overflow-wrap:anywhere]">{fix.error}</p></div>}
        <StatusLadder fix={fix} />
        {fix.assessment && <Assessment fix={fix} />}
        {fix.caveats.length > 0 && <div><div className="label">Caveats</div><ul className="list-disc pl-5">{fix.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
        <RepoCI fix={fix} />
        {fix.agent === "muse-code" && <RunLadder fix={fix} />}
        {fix.runner?.run_url && <a href={fix.runner.run_url} target="_blank" rel="noreferrer">Job log ↗</a>}
      </div>
    </details>
  );
}

export function Remediation({ assessmentId, initial, canAct, runnerEnabled, defaultBranch, repo, mode = "pr", onChange, onDone, permissionMissing = false }: { assessmentId: string; initial: Fix | null; canAct: boolean; runnerEnabled: boolean; defaultBranch: string; repo: string; embedded?: boolean; mode?: RemediationMode; onChange?: (f: Fix | null) => void; onDone?: (info: ResultInfo) => void; permissionMissing?: boolean }) {
  const [fix, setFix] = useState<Fix | null>(initial);
  const [dest, setDest] = useState<RemediationMode>(mode); // this attempt only; Settings is not changed
  const [busy, setBusy] = useState<string | null>(null);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const call = useCallback(async (url: string, body?: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j.fix) setFix(j.fix);
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j as { fix?: Fix };
  }, []);
  const act = async (name: string, fn: () => Promise<unknown>) => { setBusy(name); setBusySince(Date.now()); setErr(null); try { await fn(); } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); } };
  const run = (f: Fix) => call(`/api/fix/${f.id}/run`, { mode: dest, reviewed: true });
  // "Prepare fix" / "Start over": a NEW attempt (new fix record), then, with the runner, generate and check the patch.
  // Nothing in this step writes to the repository. A new attempt starts from the saved preference.
  const prepare = (fresh: boolean) => act("prepare", async () => {
    if (fresh) { setDest(mode); setReviewed(false); }
    const j = await call("/api/fix", { assessment_id: assessmentId, force: fresh });
    if (runnerEnabled && j.fix && j.fix.status === "drafted" && j.fix.files.length) await run(j.fix);
  });

  useEffect(() => { onChange?.(fix); }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Approve & Fix" on a not-yet-checked patch: the user approved the patch they reviewed (approvedVersion). The
  // runner checks it; if the checked patch is byte-for-byte that version, SaveBell continues to the write with the same
  // server-side approval rules. If the checks changed the patch, the user must review and approve the final version.
  const approvedVersion = useRef<string | null>(null);
  const [patchChanged, setPatchChanged] = useState(false);
  // The completion dialog appears only for an operation the user started in this session, once the server reports it finished.
  const armed = useRef(false);
  useEffect(() => {
    if (!fix) return;
    if (fix.status === "validated" && approvedVersion.current && !busy) {
      const v = approvedVersion.current; approvedVersion.current = null;
      if (fix.patch_version === v) void act("approve", () => call(`/api/fix/${fix.id}/approve`, { patch_version: v, mode: dest, reviewed: true }));
      else { setPatchChanged(true); setReviewed(false); }
      return;
    }
    if (armed.current && DONE.includes(fix.status) && !busy) { armed.current = false; const info = fixSummary(fix, repo); if (info) onDone?.(info); }
  }, [fix, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // A request the server refused before anything was recorded (e.g. permission or approval checks): report it too.
  useEffect(() => {
    if (!armed.current || busy || !err) return;
    if (fix && DONE.includes(fix.status)) return; // the status effect above reports it
    armed.current = false; approvedVersion.current = null;
    onDone?.({ tone: "bad", title: "Fix not completed", summary: friendlyError(err) === "We couldn't prepare the fix." ? err : friendlyError(err), points: ["Nothing was written to your repository."], next: "Fix the problem shown, then try again. Your prepared patch is kept." });
  }, [err, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = fix?.status ?? null;
  const stale = !!fix && isStaleRun(fix, now);
  useEffect(() => {
    if (!fix || !(WORKING.includes(fix.status) || fix.status === "approved" || fix.status === "merging") || stale) return;
    const t = setInterval(async () => { const r = await fetch(`/api/fix/${fix.id}`); if (r.ok) setFix((await r.json()).fix); }, 4000);
    return () => clearInterval(t);
  }, [fix, stale]);
  useEffect(() => { if (!busy && !(status && WORKING.includes(status))) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [busy, status]);

  if (!canAct && !fix) return null;
  const files = fix?.files ?? [];
  const branch = fix ? fixBranch(fix.id) : "savebell/fix-…";
  const working = busy === "prepare" || (!!status && WORKING.includes(status) && !stale);
  const ready = !!fix && !working && files.length > 0 && (status === "validated" || (status === "drafted" && (!runnerEnabled || dest === "preview" || !canAct)) || (status === "drafted" && runnerEnabled));
  const needsCheck = !!fix && status === "drafted" && runnerEnabled;
  const destLabel = DESTINATIONS.find((d) => d.id === dest)!.label;
  const destLine = dest === "preview" ? `Nothing will be written to ${repo}.` : dest === "branch" ? `New branch ${branch} in ${repo}. Your default branch ${defaultBranch} is not changed.` : `Draft pull request from ${branch} into ${defaultBranch} in ${repo}. Nothing is merged.`;
  const destSelect = (
    <label className="flex flex-wrap items-center gap-2 text-[calc(13px*var(--ui))]"><span className="text-ink2">After fixing</span>
      <select value={dest} disabled={!!busy} onChange={(e) => { setDest(e.target.value as RemediationMode); setErr(null); }} className="border hair rounded-[6px] h-8 px-2 bg-transparent text-[calc(13px*var(--ui))]">
        {DESTINATIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
    </label>
  );
  const errLine = (err ? <p role="alert" className="text-[calc(13px*var(--ui))] tone-bad">{friendlyError(err) === "We couldn't prepare the fix." ? err : friendlyError(err)}</p> : null);

  // 1. Nothing prepared yet
  if (!fix || (status === "drafting" && !working)) return (
    <div className="grid gap-3">
      <h3 className="text-[calc(15px*var(--ui))] font-semibold">Prepare a fix</h3>
      <p className="text-[calc(13px*var(--ui))] text-ink2">{runnerEnabled ? "Muse Code prepares a change and checks it in an isolated environment. Nothing is written to your repository." : "SaveBell drafts a proposed change from the cited files. Nothing is written to your repository."}</p>
      {destSelect}
      {errLine}
      <button className="btn w-fit" disabled={!!busy || !canAct} onClick={() => prepare(false)}>Prepare fix</button>
    </div>
  );

  // 2. Working (drafting, queued, running)
  if (working) return (
    <div className="grid gap-3" aria-live="polite">
      <h3 className="text-[calc(15px*var(--ui))] font-semibold">Preparing your fix…</h3>
      <p className="text-[calc(13px*var(--ui))] text-ink2">Generating and checking the patch. Nothing is written to your repository.</p>
      <p className="text-[calc(12px*var(--ui))] text-ink2">Elapsed {since(fix.runner?.dispatched_at && status !== "drafting" ? Date.parse(fix.runner.dispatched_at) : busySince, now) ?? "0s"}</p>
      {(status === "queued" || status === "running") && <button className="btn-ghost w-fit" disabled={busy === "cancel"} onClick={() => act("cancel", () => call(`/api/fix/${fix.id}/cancel`))}>{busy === "cancel" ? "Cancelling…" : "Cancel"}</button>}
    </div>
  );

  // 3. Writing (approved): authorized operation in progress, cannot be cancelled
  if (status === "approved") return (
    <div className="grid gap-2" aria-live="polite">
      <h3 className="text-[calc(15px*var(--ui))] font-semibold">{fix.mode === "branch" ? "Pushing branch…" : "Creating pull request…"}</h3>
      <p className="text-[calc(13px*var(--ui))] text-ink2">You approved this change. It can no longer be stopped; you can delete the branch or close the pull request on GitHub afterwards.</p>
    </div>
  );

  // 4. Completed
  if (status === "pr_created" || status === "merging" || status === "blocked_by_protection" || status === "merged" || status === "branch_pushed") {
    const h = status === "branch_pushed" ? "Branch pushed" : status === "merged" ? "Merged" : status === "merging" ? "Waiting for checks before merging" : status === "blocked_by_protection" ? "Pull request open, not merged" : fix.pr_draft === false ? "Pull request created (marked [DRAFT])" : "Draft pull request created";
    const text = status === "branch_pushed" ? `Your fix is on branch ${fix.branch} in ${repo}. Open a pull request on GitHub when you're ready.` : status === "merged" ? "Your repository's checks passed and the change was merged." : status === "merging" ? "The change will merge only if your repository's checks pass." : status === "blocked_by_protection" ? "The pull request stays open for your review." : "Your proposed fix is ready to review on GitHub.";
    return (
      <div className="grid gap-3">
        <h3 className="text-[calc(15px*var(--ui))] font-semibold">{h}</h3>
        <p className="text-[calc(13px*var(--ui))] text-ink2">{text}</p>
        <Checks items={fixChecks(fix)} />
        <div className="flex flex-wrap gap-2">
          {fix.pr_url && <a className="btn no-underline" href={fix.pr_url} target="_blank" rel="noreferrer">View pull request ↗</a>}
          {!fix.pr_url && fix.commit_url && <a className="btn no-underline" href={fix.commit_url} target="_blank" rel="noreferrer">View on GitHub ↗</a>}
          {status === "merging" && <button className="btn-ghost" disabled={!!busy} onClick={() => act("cancel", () => call(`/api/fix/${fix.id}/cancel`))}>Cancel automatic merge</button>}
        </div>
        {errLine}
        <details className="disclose"><summary>Code changes</summary><div className="grid gap-3 mt-3">{files.map((x) => <div key={x.path} className="border hair rounded-[6px] overflow-hidden"><div className="mono text-[calc(12px*var(--ui))] px-3 py-2 border-b hair [overflow-wrap:anywhere]">{x.path}</div><Diff patch={x.patch} /></div>)}</div></details>
        <TechnicalDetails fix={fix} />
      </div>
    );
  }

  // 5. Failed / cancelled / stalled
  if (status === "failed" || status === "validation_failed" || status === "cancelled" || stale) return (
    <div className="grid gap-3">
      <h3 className="text-[calc(15px*var(--ui))] font-semibold">{status === "cancelled" ? "Cancelled" : "Fix failed"}</h3>
      <p className="text-[calc(13px*var(--ui))] text-ink2">{status === "cancelled" ? "The operation was stopped. Nothing was written to your repository." : stale ? friendlyError("stale") : friendlyError(fix.error)}</p>
      {errLine}
      <button className="btn w-fit" disabled={!!busy || !canAct} onClick={() => prepare(true)}>{busy === "prepare" ? "Starting…" : "Start over"}</button>
      <TechnicalDetails fix={fix} />
    </div>
  );

  // 6. Patch ready (validated by the runner, or a read-only proposal)
  if (ready) {
    const writeFailed = /GitHub write failed|write refused/.test(fix.error ?? "");
    return (
      <div className="grid gap-3">
        <h3 className="text-[calc(15px*var(--ui))] font-semibold">Patch ready for review</h3>
        {patchChanged && <p role="alert" className="text-[calc(13px*var(--ui))] tone-warn">The checks changed the patch. Nothing was written. Review the final changes below, then approve them.</p>}
        <p className="text-[calc(13px*var(--ui))] text-ink2">{status === "validated" ? "Muse Code prepared a fix for your repository." : "SaveBell drafted a proposed fix."}</p>
        <Checks items={needsCheck ? fixChecks(fix).map((c) => (c.text === "Not tested yet" ? { ...c, text: "Not checked in an isolated environment yet" } : c)) : fixChecks(fix)} />
        {writeFailed && <p role="alert" className="text-[calc(13px*var(--ui))] tone-bad">The last attempt to write didn&apos;t finish. If a branch named {branch} exists on GitHub, it was created by that attempt; nothing else was changed.</p>}
        <details className="disclose" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setReviewed(true); }}>
          <summary>Review changes ({files.length} file{files.length === 1 ? "" : "s"})</summary>
          <div className="grid gap-3 mt-3">{files.map((x) => <div key={x.path} className="border hair rounded-[6px] overflow-hidden"><div className="mono text-[calc(12px*var(--ui))] px-3 py-2 border-b hair [overflow-wrap:anywhere]">{x.path}</div><Diff patch={x.patch} /></div>)}{fix.rejected_hunks.length > 0 && <RejectedHunks fix={fix} />}</div>
        </details>
        {destSelect}
        <p className="text-[calc(12px*var(--ui))] text-ink2">{destLine}</p>
        {errLine}
        <div className="flex flex-wrap items-center gap-2">
          {dest === "preview" ? (
            <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(files.map((x) => x.patch).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } }}>{copied ? "Copied" : "Copy patch"}</button>
          ) : needsCheck ? (
            <button className="btn" disabled={!reviewed || !!busy || !canAct || permissionMissing} title={reviewed ? undefined : "Open Review changes first"}
              onClick={() => { armed.current = true; approvedVersion.current = fix.patch_version; setPatchChanged(false); void act("prepare", () => run(fix)); }}>Approve &amp; Fix</button>
          ) : (
            <button className="btn" disabled={!reviewed || !!busy || !canAct || permissionMissing} title={reviewed ? undefined : "Open Review changes first"}
              onClick={() => { armed.current = true; void act("approve", () => (status === "validated"
                ? call(`/api/fix/${fix.id}/approve`, { patch_version: fix.patch_version, mode: dest, reviewed: true })
                : call(`/api/fix/${fix.id}/apply`, { reviewed: true, mode: dest, patch_version: fix.patch_version }))); }}>
              {busy === "approve" ? "Working…" : dest === "branch" ? "Approve & push branch" : "Approve & create PR"}
            </button>
          )}
          {status === "validated" && <button className="btn-ghost" disabled={!!busy} onClick={() => act("discard", () => call(`/api/fix/${fix.id}/cancel`))}>Discard</button>}
          {!reviewed && dest !== "preview" && <span className="text-[calc(12px*var(--ui))] text-ink2">Open Review changes to enable approval.</span>}
        </div>
        <TechnicalDetails fix={fix} />
      </div>
    );
  }

  return <p className="text-[calc(13px*var(--ui))] text-ink2">{destLabel}</p>;
}
