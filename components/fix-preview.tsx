"use client";
// Fix preview: draft → diff (additions as ghost text) → status ladder + static assessment → explicit approval dialog
// → draft PR link + the repository's own CI readout (shown separately, never as proof the vulnerability is fixed).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Fix } from "@/lib/schema";

type Labels = { proposed_fix: string; draft_fix: string; drafting: string; re_draft: string; approve: string; not_verified: string };
type Props = { assessmentId: string; initial: Fix | null; allowPr: boolean; isDemoRepo: boolean; verdict: string; defaultBranch: string; repo: string; labels?: Labels };

const EN: Labels = { proposed_fix: "Proposed fix", draft_fix: "Draft fix", drafting: "Drafting… (model call, ~30–90 s)", re_draft: "Re-draft", approve: "Approve & open draft PR…", not_verified: "Security remediation: not verified" };
export function FixPreview({ assessmentId, initial, allowPr, isDemoRepo, verdict, defaultBranch, repo, labels = EN }: Props) {
  const router = useRouter();
  const [fix, setFix] = useState<Fix | null>(initial);
  const [busy, setBusy] = useState<"draft" | "apply" | "checks" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const autoAct = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("act") === "1";

  // When arriving via dashboard "Apply fix" (?act=1): auto-draft if no fix exists, then auto-open dialog once drafted.
  useEffect(() => {
    if (!autoAct) return;
    if (!fix) { draft(); return; }
    if (fix.status === "drafted" && allowPr && !isDemoRepo) dlg.current?.showModal();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.status]);

  async function draft(force = false) {
    setBusy("draft"); setErr(null);
    try { const r = await fetch("/api/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assessment_id: assessmentId, force }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setFix(j.fix); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  }
  async function apply() {
    if (!fix) return;
    setBusy("apply"); setErr(null);
    try { const r = await fetch(`/api/fix/${fix.id}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewed }) }); const j = await r.json(); if (!r.ok) { if (j.fix) setFix(j.fix); throw new Error(j.error ?? r.statusText); } setFix(j.fix); dlg.current?.close(); router.refresh(); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  }
  async function checks() {
    if (!fix) return;
    setBusy("checks"); try { const r = await fetch(`/api/fix/${fix.id}/checks`, { method: "POST" }); const j = await r.json(); if (r.ok) setFix(j.fix); else setErr(j.error); } finally { setBusy(null); }
  }

  if (verdict === "Not Affected") return null;
  return (
    <section id="fix" className="grid gap-4">
      <div className="label">{labels.proposed_fix}</div>
      {!fix && (
        <div className="grid gap-2">
          <p className="text-[13px]">Draft a minimal change for the cited files. Drafting reads the files at the assessed commit and writes nothing to GitHub.</p>
          <button className="btn w-fit" onClick={() => draft()} disabled={busy === "draft"}>{busy === "draft" ? labels.drafting : labels.draft_fix}</button>
        </div>
      )}
      {err && <p className="text-[13px]" style={{ color: "var(--contradicted)" }}>{err}</p>}
      {fix && fix.status === "failed" && (
        <div className="grid gap-2 text-[13px]"><p style={{ color: "var(--contradicted)" }}>No applicable patch: {fix.error}</p>
          {fix.rejected_hunks.length > 0 && <RejectedHunks fix={fix} />}
          <button className="btn-ghost w-fit" onClick={() => draft(true)} disabled={busy === "draft"}>Try drafting again</button></div>
      )}
      {fix && fix.status !== "failed" && (
        <div className="grid gap-5">
          <p className="text-[14px]">{fix.summary}</p>
          <StatusLadder fix={fix} />
          {fix.files.map((f) => (
            <div key={f.path} className="border hair rounded-[6px] bg-raised overflow-hidden">
              <div className="mono text-[12px] px-3 py-2 border-b hair flex flex-wrap justify-between gap-2"><span>{f.path}</span><span className="text-ink2">{f.hunks.length} hunk(s) · {fix.syntax_check.find((s) => s.path === f.path)?.ok ? "syntax ok" : "syntax FAILED"}</span></div>
              <Diff patch={f.patch} />
              <ul className="text-[12px] px-3 py-2 grid gap-1 border-t hair">{f.hunks.map((h, i) => <li key={i}><span className="label mr-2">{h.addresses.replace("_", " ")}</span>{h.rationale}{h.condition_ids.length ? <span className="mono text-ink2"> → {h.condition_ids.join(", ")}</span> : null}</li>)}</ul>
            </div>
          ))}
          {fix.rejected_hunks.length > 0 && <RejectedHunks fix={fix} />}
          {fix.syntax_check.some((s) => !s.ok) && <ul className="text-[12px]" style={{ color: "var(--contradicted)" }}>{fix.syntax_check.filter((s) => !s.ok).flatMap((s) => s.errors.map((e, i) => <li key={s.path + i}>{s.path}: {e}</li>))}</ul>}
          <Assessment fix={fix} />
          {fix.caveats.length > 0 && <div className="text-[12px]"><div className="label">Caveats from the drafting model</div><ul className="list-disc pl-5">{fix.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}

          {fix.status === "drafted" && (
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn" onClick={() => dlg.current?.showModal()} disabled={!allowPr || isDemoRepo} title={isDemoRepo ? "Shared demo repositories never receive pull requests" : !allowPr ? "Enable draft pull requests for this repository on the Repos page first" : ""}>{labels.approve}</button>
              <button className="btn-ghost" onClick={() => draft(true)} disabled={busy === "draft"}>{busy === "draft" ? labels.drafting : labels.re_draft}</button>
              {(!allowPr || isDemoRepo) && <span className="text-[12px] text-ink2">{isDemoRepo ? "Demo repository: preview only." : <>Draft PRs are off for this repository. <a href="/repos">Enable on Repos</a> or use the remediation prompt below.</>}</span>}
            </div>
          )}
          {fix.status === "pr_created" && (
            <div className="border hair rounded-[6px] p-4 grid gap-3">
              <div className="text-[14px]">Draft pull request opened: <a href={fix.pr_url ?? "#"} target="_blank" rel="noreferrer">{fix.repo}#{fix.pr_number} ↗</a> on branch <span className="mono">{fix.branch}</span>{fix.pr_draft === false && <span className="label ml-2" style={{ color: "var(--inferred)" }}>non-draft fallback (plan limit); do not merge</span>}</div>
              <div className="text-[12px] text-ink2">The default branch <span className="mono">{defaultBranch}</span> of {repo} was not modified. Nothing is merged by Argus Watch.</div>
              <div>
                <div className="label mb-1">Repository CI (GitHub) · separate from the Argus Watch assessment</div>
                <p className="text-[12px] text-ink2 mb-2">CI results come from this repository&apos;s own workflows and do not verify that the vulnerability is fixed.</p>
                {fix.check_runs.length ? <ul className="mono text-[12px] grid gap-1">{fix.check_runs.map((r) => <li key={r.name}>{r.conclusion === "success" ? "✓" : r.conclusion ? "✗" : "…"} {r.name} · {r.status}{r.conclusion ? ` · ${r.conclusion}` : ""}{r.url ? <> · <a href={r.url} target="_blank" rel="noreferrer">log ↗</a></> : null}</li>)}</ul> : <p className="text-[12px] text-ink2">{fix.checks_at ? "No check runs reported for this branch (the repository may have no CI)." : "Not read yet."}</p>}
                <button className="btn-ghost mt-2" onClick={checks} disabled={busy === "checks"}>{busy === "checks" ? "Reading…" : "Refresh CI status"}</button>
              </div>
            </div>
          )}
        </div>
      )}

      <dialog ref={dlg} className="modal">
        {fix && (
          <form method="dialog" className="grid gap-3 text-[13px]" onSubmit={(e) => { e.preventDefault(); apply(); }}>
            <div className="serif text-[22px]">What happens if you approve</div>
            <ul className="grid gap-1 list-disc pl-5">
              <li>Repository <span className="mono">{fix.repo}</span>, base branch <span className="mono">{defaultBranch}</span> at <span className="mono">{fix.base_sha.slice(0, 7)}</span>.</li>
              <li>A new branch <span className="mono">argus/fix-{fix.id.slice(0, 8)}</span> with one commit changing {fix.files.length} file(s): {fix.files.map((f) => f.path).join(", ")}.</li>
              <li>A <b>draft</b> pull request is opened for review. The default branch is not modified and nothing is merged.</li>
              <li>The change was syntax-checked only. It was not executed, not type-checked here, and no tests were run. <b>Security remediation: not verified.</b></li>
              <li>Static assessment: <b>{fix.assessment?.label.replace("_", " ") ?? "not assessed"}</b>{fix.assessment?.risk_flags.length ? ` · risk flags: ${fix.assessment.risk_flags.length}` : ""}.</li>
              <li>If the cited files changed on {defaultBranch} since the analysis, nothing is written and you are asked to re-run the analysis.</li>
            </ul>
            <label className="flex items-center gap-2"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the diff and the assessment above.</label>
            {err && <p className="text-[13px]" role="alert" style={{ color: "var(--contradicted)" }}>{err}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => dlg.current?.close()}>Cancel</button>
              <button type="submit" className="btn" disabled={!reviewed || busy === "apply"}>{busy === "apply" ? "Opening draft PR…" : "Approve and open draft PR"}</button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}

function RejectedHunks({ fix }: { fix: Fix }) {
  return <details className="text-[12px]"><summary className="label cursor-pointer">{fix.rejected_hunks.length} hunk(s) not applied</summary><ul className="mt-2 grid gap-2">{fix.rejected_hunks.map((h, i) => <li key={i} className="border hair rounded-[4px] p-2"><div className="mono">{h.path}</div><div style={{ color: "var(--contradicted)" }}>{h.reason}</div><pre className="mono whitespace-pre-wrap mt-1 text-ink2">{h.search.slice(0, 300)}</pre></li>)}</ul></details>;
}

/** Each row stands on its own; no row implies the next one. */
export function StatusLadder({ fix }: { fix: Fix }) {
  const synOk = fix.syntax_check.length > 0 && fix.syntax_check.every((s) => s.ok);
  const ciTypeRun = fix.check_runs.find((r) => /tsc|typecheck|types|type-check/i.test(r.name));
  const ci = fix.check_runs.length ? (fix.check_runs.every((r) => r.conclusion === "success") ? "passed" : fix.check_runs.some((r) => r.conclusion && r.conclusion !== "success") ? "failed" : "pending") : fix.status === "pr_created" ? "none reported" : "not applicable yet";
  const as = fix.assessment?.label;
  const rows: [string, string, "ok" | "warn" | "bad" | "na"][] = [
    ["Patch generated", `by model ${fix.model}; ${fix.files.length} file(s)`, fix.files.length ? "ok" : "bad"],
    ["Syntactically valid", fix.syntax_check.map((s) => `${s.path.split("/").pop()}: ${s.ok ? "parsed" : "FAILED"}`).join(", ") || "n/a", synOk ? "ok" : "bad"],
    ["Type-checked", ciTypeRun ? `by repository CI (${ciTypeRun.name}: ${ciTypeRun.conclusion ?? ciTypeRun.status})` : "not performed by Argus Watch (needs the repository's dependencies); see repository CI", ciTypeRun?.conclusion === "success" ? "ok" : "na"],
    ["Existing CI passed", ci, ci === "passed" ? "ok" : ci === "failed" ? "bad" : "na"],
    ["Static remediation assessment", as ? as.replace("_", " ") : "not assessed", as === "supported" ? "ok" : as === "partially_supported" ? "warn" : as ? "bad" : "na"],
    ["Security remediation verified", "NOT verified: nothing was executed or reproduced. Verification requires review and testing in your environment.", "warn"],
  ];
  const glyph = { ok: "✓", warn: "⚠", bad: "✗", na: "–" };
  const color = { ok: "var(--observed)", warn: "var(--inferred)", bad: "var(--contradicted)", na: "var(--ink-2)" };
  return <ul className="grid gap-1 text-[13px] border hair rounded-[6px] p-3">{rows.map(([k, v, s]) => <li key={k} className="grid grid-cols-[18px_210px_1fr] gap-2"><span style={{ color: color[s] }}>{glyph[s]}</span><span className="font-medium">{k}</span><span className="text-ink2">{v}</span></li>)}</ul>;
}

function Assessment({ fix }: { fix: Fix }) {
  const a = fix.assessment;
  if (!a) return null;
  const tagColor: Record<string, string> = { COMPUTED: "var(--observed)", "CITATION-VERIFIED": "var(--observed)", "MODEL-ASSUMPTION": "var(--inferred)", UNCHANGED: "var(--ink-2)" };
  return (
    <div className="grid gap-3 text-[13px] border hair rounded-[6px] p-4">
      <div className="flex flex-wrap items-baseline gap-2"><span className="label">Static remediation assessment</span><span className="chip" style={{ color: a.label === "supported" ? "var(--observed)" : a.label === "partially_supported" ? "var(--inferred)" : "var(--contradicted)" }}>{a.label.replace("_", " ")}</span>{a.predicted_verdict && <span className="mono text-[12px] text-ink2">predicted verdict after patch (static): {a.predicted_verdict}</span>}</div>
      <p>{a.summary}</p>
      <div>
        <div className="label mb-1">Why it should help · evidence per condition</div>
        <ul className="grid gap-1">{a.coverage.map((c) => <li key={c.condition_id} className="grid grid-cols-[1fr_auto] gap-2"><span>{c.driving ? <b>{c.condition_id}</b> : c.condition_id}: {c.before} → {c.after ?? "unchanged"} <span className="text-ink2">{c.text}</span>{c.after_evidence && <div className="mono text-[11px] text-ink2">{c.after_evidence}</div>}</span><span className="label" style={{ color: tagColor[c.tag] }}>{c.tag}</span></li>)}</ul>
        <p className="text-[11px] text-ink2 mt-1">Bold = conditions that drove the verdict. COMPUTED and CITATION-VERIFIED rows are evidence; MODEL-ASSUMPTION rows are not.</p>
      </div>
      {a.version_check && <div><span className="label mr-2">Version check (computed)</span>{a.version_check.note}</div>}
      {a.risk_flags.length > 0 && <div style={{ color: "var(--contradicted)" }}><span className="label mr-2">Risk flags</span>{a.risk_flags.join(" · ")}</div>}
      {a.model_judgement.length > 0 && <div><div className="label">Model judgement (assumption, not evidence)</div><ul className="list-disc pl-5">{a.model_judgement.map((m, i) => <li key={i}><span className="mono">{m.path}</span> · {m.addresses.replace("_", " ")}: {m.reason}</li>)}</ul></div>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div><div className="label">Still uncertain</div><ul className="list-disc pl-5">{a.uncertain.map((u, i) => <li key={i}>{u}</li>)}</ul></div>
        <div><div className="label">Verification required</div><ul className="list-disc pl-5">{a.verification_required.map((u, i) => <li key={i}>{u}</li>)}</ul></div>
      </div>
      <p className="text-[11px] text-ink2">Limits: static analysis cannot show exploitability; the model can misjudge the mechanism; patched code may break behaviour not visible in the listing; CI passing is evidence of build health only.</p>
    </div>
  );
}

type DiffRow = { kind: "hunk" | "add" | "del" | "ctx"; a: number | null; b: number | null; text: string };
function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = []; let a = 0, b = 0;
  for (const l of patch.split("\n").slice(2)) { // drop the ---/+++ header
    if (l.startsWith("@@")) { const m = l.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/); a = Number(m?.[1] ?? 1) - 1; b = Number(m?.[2] ?? 1) - 1; rows.push({ kind: "hunk", a: null, b: null, text: l }); }
    else if (l.startsWith("+")) { b++; rows.push({ kind: "add", a: null, b, text: l.slice(1) || " " }); }
    else if (l.startsWith("-")) { a++; rows.push({ kind: "del", a, b: null, text: l.slice(1) || " " }); }
    else if (l.startsWith("\\")) continue;
    else { a++; b++; rows.push({ kind: "ctx", a, b, text: l.slice(1) || " " }); }
  }
  return rows;
}
function Diff({ patch }: { patch: string }) {
  const cls = { hunk: "dl diff-hunk", add: "dl diff-add", del: "dl diff-del", ctx: "dl" };
  return <div className="diff overflow-auto py-2">{parsePatch(patch).map((r, i) => <div key={i} className={cls[r.kind]}><span className="ln">{r.a ?? ""}</span><span className="ln">{r.b ?? ""}</span><span>{r.text}</span></div>)}</div>;
}
