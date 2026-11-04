"use client";
// "What happens if you don't fix this?" A short, stepped walkthrough rendered as screens of the user's own app.
// Every step carries an evidence chip (demonstrated / inferred / hypothetical) linking to the cited line.
import { useCallback, useEffect, useState } from "react";
import type { Basis, Screen, Simulation, Step } from "@/lib/simulate";

const BASIS: Record<Basis, { label: string; color: string; help: string }> = {
  demonstrated: { label: "Shown in your code", color: "var(--observed)", help: "Argus observed the code that makes this step possible." },
  inferred: { label: "Inferred from your code", color: "var(--inferred)", help: "Supported by cited code, but not directly observed." },
  hypothetical: { label: "Hypothetical", color: "var(--ink-2)", help: "Plausible, but not supported by evidence in your repository." },
};
const TONE = { normal: "var(--ink)", danger: "var(--contradicted)", success: "var(--observed)", muted: "var(--ink-2)" };

export function SimulateImpact({ assessmentId, repo, sha, title = "What happens if you don't fix this?", button = "Simulate user impact", intro, locale = "en" }: { assessmentId: string; repo: string; sha: string; title?: string; button?: string; intro?: string; locale?: string }) {
  const lineHref = (file: string, line: number | null) => `https://github.com/${repo}/blob/${sha}/${file.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""}`;
  const [sim, setSim] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [withFix, setWithFix] = useState(false);

  async function run(force = false) {
    setBusy(true); setErr(null);
    try { const r = await fetch("/api/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assessment_id: assessmentId, force, locale }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setSim(j.simulation); setI(0); setWithFix(false); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  }
  const last = sim ? (withFix && sim.with_fix?.blocked_at_step ? sim.with_fix.blocked_at_step : sim.steps.length) : 0;
  const total = sim ? last + 1 : 0; // + outcome card
  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(total - 1, x + d))), [total]);
  useEffect(() => {
    if (!sim) return;
    const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest("input,textarea")) return; if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [sim, go]);

  return (
    <section className="grid gap-3" aria-labelledby="sim-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sim-h" className="text-[15px] font-semibold">{title}</h2>
        {!sim && <button className="btn" onClick={() => run()} disabled={busy}>{busy ? "… (~20–40 s)" : button}</button>}
      </div>
      {!sim && !busy && <p className="text-[13px] text-ink2">{intro ?? "See how someone using your app could experience this threat, step by step, built only from what Argus found in your code. Synthetic data; nothing is executed."}</p>}
      {err && <p role="alert" className="text-[13px]" style={{ color: "var(--contradicted)" }}>{err}</p>}
      {sim && !sim.applicable && <div className="border hair rounded-[8px] p-4 text-[14px]"><b>Not enough evidence for a user-facing scenario.</b> <span className="text-ink2">{sim.not_applicable_reason}</span></div>}
      {sim && sim.applicable && (
        <div className="grid gap-3">
          <div className="text-[12px] px-3 py-2 rounded-[6px]" style={{ background: "var(--sunken)" }} role="note">Hypothetical simulation with synthetic data. Nothing was executed or reproduced. Each step says what supports it.</div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] text-ink2">{sim.persona} using <b className="text-ink">{sim.surface.name}</b>{sim.surface.generic ? <span> (generic app: no user-facing code was cited)</span> : <> · based on {sim.surface.derived_from.map((d, k) => <a key={k} className="mono" target="_blank" rel="noreferrer" href={lineHref(d.file, d.line)}>{d.file.split("/").pop()}{d.line ? `:${d.line}` : ""}{k < sim.surface.derived_from.length - 1 ? ", " : ""}</a>)}</>}</div>
            {sim.with_fix && <nav className="seg" aria-label="Scenario"><button aria-current={!withFix ? "page" : undefined} onClick={() => { setWithFix(false); setI(0); }}>Without fix</button><button aria-current={withFix ? "page" : undefined} onClick={() => { setWithFix(true); setI(0); }}>With fix</button></nav>}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <div className="border hair rounded-[14px] bg-raised overflow-hidden" style={{ minHeight: 260 }}>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b hair" aria-hidden><span className="w-2 h-2 rounded-full" style={{ background: "var(--line)" }} /><span className="w-2 h-2 rounded-full" style={{ background: "var(--line)" }} /><span className="w-2 h-2 rounded-full" style={{ background: "var(--line)" }} /><span className="text-[11px] text-ink2 ml-2 truncate">{sim.surface.name}</span></div>
              <div key={`${withFix}-${i}`} className="fade p-4">
                {i < last ? <ScreenView s={sim.steps[i].screen} /> : <Outcome sim={sim} withFix={withFix} />}
              </div>
            </div>
            <ol className="grid gap-1 content-start text-[12px]" aria-label="Steps">
              {sim.steps.slice(0, last).map((s, k) => <li key={k}><button className="text-left w-full px-2 py-1 rounded-[4px]" style={{ background: k === i ? "var(--sunken)" : "transparent" }} onClick={() => setI(k)}><span className="mono text-ink2 mr-1">{k + 1}</span>{s.narration.slice(0, 70)}</button></li>)}
              <li><button className="text-left w-full px-2 py-1 rounded-[4px] font-medium" style={{ background: i === last ? "var(--sunken)" : "transparent" }} onClick={() => setI(last)}>{withFix ? "With the fix" : "Outcome"}</button></li>
            </ol>
          </div>
          {i < last && <StepMeta s={sim.steps[i]} lineHref={lineHref} />}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous step">←</button>
            <button className="btn-ghost" onClick={() => go(1)} disabled={i >= total - 1} aria-label="Next step">→</button>
            <span className="text-[12px] text-ink2">{Math.min(i + 1, total)} / {total} · arrow keys work</span>
            <button className="btn-ghost ml-auto" onClick={() => run(true)} disabled={busy}>{busy ? "Rebuilding…" : "Rebuild"}</button>
          </div>
          <p className="text-[11px] text-ink2">Built by Meta {sim.model} from Argus&apos;s assessment in {(sim.ms / 1000).toFixed(0)} s.{sim.downgraded ? ` ${sim.downgraded} claim(s) the model made without evidence were downgraded to hypothetical.` : ""}</p>
        </div>
      )}
    </section>
  );
}

function StepMeta({ s, lineHref }: { s: Step; lineHref: (file: string, line: number | null) => string }) {
  const b = BASIS[s.basis];
  return (
    <div className="grid gap-1 text-[13px]">
      <p>{s.narration}</p>
      <div className="flex flex-wrap items-center gap-2"><span className="chip" style={{ color: b.color }} title={b.help}>{b.label}</span>
        {s.evidence.map((e, k) => e.file ? <a key={k} className="mono text-[12px]" target="_blank" rel="noreferrer" href={lineHref(e.file, e.line)}>{e.file}{e.line ? `:${e.line}` : ""}</a> : e.condition_id ? <span key={k} className="mono text-[12px] text-ink2">condition {e.condition_id}</span> : null)}
      </div>
    </div>
  );
}

function ScreenView({ s }: { s: Screen }) {
  const bubble = (who: string) => who === "user" ? { justifySelf: "end", background: "var(--sunken)" } : { justifySelf: "start", background: "transparent", border: "1px solid var(--line)" };
  return (
    <div className="grid gap-2">
      <div className="label">{s.kind.replace("_", " ")} · {s.title}</div>
      {s.kind === "chat" || s.kind === "email"
        ? <div className="grid gap-2">{s.lines.map((l, k) => <div key={k} className="max-w-[85%] px-3 py-2 rounded-[10px] text-[13px]" style={{ ...bubble(l.who), color: TONE[l.tone] }}><span className="text-[10px] uppercase tracking-wide text-ink2 block">{l.who}</span>{l.text}</div>)}</div>
        : s.kind === "notification"
        ? <div className="grid gap-2">{s.lines.map((l, k) => <div key={k} className="px-3 py-2 rounded-[10px] text-[13px] shadow-sm border hair" style={{ color: TONE[l.tone] }}>🔔 {l.text}</div>)}</div>
        : s.kind === "terminal" || s.kind === "agent_log"
        ? <pre className="mono text-[12px] whitespace-pre-wrap p-3 rounded-[6px]" style={{ background: "var(--sunken)" }}>{s.lines.map((l, k) => <div key={k} style={{ color: TONE[l.tone] }}>{l.who === "agent" ? "› " : l.who === "system" ? "# " : ""}{l.text}</div>)}</pre>
        : <div className="grid gap-1.5 text-[13px]">{s.lines.map((l, k) => <div key={k} className="py-1.5 border-b hair last:border-0" style={{ color: TONE[l.tone] }}>{l.text}</div>)}</div>}
    </div>
  );
}

function Outcome({ sim, withFix }: { sim: Simulation; withFix: boolean }) {
  if (withFix && sim.with_fix) return (
    <div className="grid gap-2 text-[14px]">
      <div className="label" style={{ color: "var(--observed)" }}>With the fix</div>
      <p>{sim.with_fix.changed_behavior}</p>
      <p className="text-[12px] text-ink2">{sim.with_fix.label}{sim.with_fix.blocked_at_step ? ` · the chain is expected to stop at step ${sim.with_fix.blocked_at_step}` : ""}</p>
      {sim.with_fix.remaining_uncertainty.length > 0 && <div className="text-[13px]"><div className="label">Still uncertain</div><ul className="list-disc pl-5">{sim.with_fix.remaining_uncertainty.map((u, k) => <li key={k}>{u}</li>)}</ul></div>}
    </div>
  );
  const b = BASIS[sim.consequence.basis];
  return (
    <div className="grid gap-2 text-[14px]">
      <div className="label" style={{ color: "var(--contradicted)" }}>What your user experiences</div>
      <p className="text-[16px] font-medium">{sim.consequence.summary}</p>
      <span className="chip w-fit" style={{ color: b.color }}>{b.label}</span>
    </div>
  );
}
