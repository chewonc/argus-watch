"use client";
// Threat Timeline on the case page: what happened to this threat in the world, and when Argus found it in your code.
// Every entry shows its source and how sure it is (Confirmed / Reported / Inferred: glyph + word, never colour alone).
import { useEffect, useState } from "react";
import type { ThreatTimeline as TL, TLEvent } from "@/lib/timeline";

const CONF: Record<TLEvent["confidence"], { glyph: string; label: string; color: string; help: string }> = {
  confirmed: { glyph: "■", label: "Confirmed", color: "var(--observed)", help: "From a registry, an official catalog, or Argus Watch's own record." },
  reported: { glyph: "◧", label: "Reported", color: "var(--inferred)", help: "Stated by this source; not independently confirmed." },
  inferred: { glyph: "□", label: "Inferred", color: "var(--ink-2)", help: "Date derived from a record, not stated for this event." },
};
const KIND: Partial<Record<TLEvent["kind"], string>> = {
  disclosure: "Disclosure", advisory_published: "Advisory", advisory_updated: "Update", withdrawn: "Withdrawn", patch: "Patch", exploitation: "Exploitation",
  research: "Research", report: "Report", argus_discovered: "Argus Watch", argus_assessed: "Your code", argus_notified: "Alert", fix_drafted: "Fix", fix_pr: "Pull request", fix_merged: "Merged", agent_report: "Your agent",
};
const fmt = (e: TLEvent) => {
  const d = new Date(e.at);
  if (e.precision === "month") return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) + (e.precision === "time" ? ` ${d.toISOString().slice(11, 16)} UTC` : "");
};

export function ThreatTimeline({ assessmentId, title = "Threat timeline" }: { assessmentId: string; title?: string }) {
  const [t, setT] = useState<TL | null>(null);
  const [repo, setRepo] = useState<TLEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);

  const fetchTimeline = async (force: boolean) => {
    const r = await fetch("/api/timeline", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assessment_id: assessmentId, force }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j as { timeline: TL; repo?: TLEvent[] };
  };
  const apply = (p: Promise<{ timeline: TL; repo?: TLEvent[] }>) => p.then((j) => { setT(j.timeline); setRepo(j.repo ?? []); setErr(null); }, (e) => setErr(String((e as Error).message))).finally(() => setBusy(false));
  function load(force = false) { setBusy(true); setErr(null); void apply(fetchTimeline(force)); }
  useEffect(() => { void apply(fetchTimeline(false)); }, [assessmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = t ? [...t.events, ...repo].sort((a, b) => a.at.localeCompare(b.at)) : [];
  const shown = onlyConfirmed ? all.filter((e) => e.confidence === "confirmed") : all;
  const byId = new Map(all.map((e) => [e.id, e]));
  const sources = t ? new Set(t.events.flatMap((e) => e.sources.map((s) => s.publisher))).size : 0;

  return (
    <section className="grid gap-3" aria-labelledby="tl-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tl-h" className="text-[15px] font-semibold">{title}</h2>
        {t && <div className="flex items-center gap-2 text-[12px]">
          <div className="seg" role="group" aria-label="Filter events">
            <button type="button" aria-pressed={!onlyConfirmed} onClick={() => setOnlyConfirmed(false)} className={`tl-seg${!onlyConfirmed ? " on" : ""}`}>All</button>
            <button type="button" aria-pressed={onlyConfirmed} onClick={() => setOnlyConfirmed(true)} className={`tl-seg${onlyConfirmed ? " on" : ""}`}>Confirmed only</button>
          </div>
          <button type="button" className="btn-ghost" onClick={() => load(true)} disabled={busy} aria-label="Rebuild timeline from current sources">{busy ? "…" : "Refresh"}</button>
        </div>}
      </div>

      {busy && !t && <div className="grid gap-2" aria-busy="true" aria-live="polite"><p className="text-[13px] text-ink2">Collecting dated records and reading the sources with Meta Muse Spark (first time ~10–30 s)…</p>{[0, 1, 2].map((i) => <div key={i} className="h-[14px] rounded bg-[var(--sunken)] pulse" style={{ width: `${80 - i * 15}%` }} />)}</div>}
      {err && <p className="text-[13px]" style={{ color: "var(--contradicted)" }}>Timeline unavailable: {err}. <button type="button" className="underline" onClick={() => load()}>Try again</button></p>}

      {t && <>
        <p className="text-[14px] leading-relaxed">{t.summary}<span className="text-[11px] text-ink2 ml-2">{t.summary_basis === "model" ? "summary by Muse Spark, checked against the events" : "summary generated from the events"}</span></p>
        {t.limited && <p className="text-[13px] text-ink2">Little history is known for this threat: only {t.events.filter((e) => e.kind !== "argus_discovered").length} dated record(s) in the sources Argus follows. Absence of events is not evidence that nothing happened.</p>}
        <ol className="tl-list">
          {shown.map((e) => {
            const c = CONF[e.confidence];
            const conflict = e.conflicts_with.map((id) => byId.get(id)).filter(Boolean) as TLEvent[];
            return (
              <li key={e.id} className={`tl-item${e.lane === "repo" ? " tl-repo" : ""}${conflict.length ? " tl-conflict" : ""}`}>
                <time dateTime={e.at} className="mono text-[12px] text-ink2 tl-date">{fmt(e)}</time>
                <div className="grid gap-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                    <span className="label !text-[11px]">{e.lane === "repo" ? "Your repository · " : ""}{KIND[e.kind] ?? e.kind}</span>
                    <span className="chip" style={{ color: c.color }} title={c.help}>{c.glyph} {c.label}</span>
                    {e.basis === "model_extracted" && <span className="text-ink2" title="Proposed by Meta Muse Spark; date and claim were found verbatim in the source">read by Muse Spark · quote checked</span>}
                    {conflict.length > 0 && <span style={{ color: "var(--unclear)" }}>⚠ dates differ between sources</span>}
                  </div>
                  <div className="text-[14px] [overflow-wrap:anywhere]">{e.title}</div>
                  {e.detail && <div className="text-[12px] text-ink2">{e.detail}</div>}
                  <div className="text-[12px] flex flex-wrap gap-x-3">{e.sources.map((s, i) => s.url ? <a key={i} href={s.url} target="_blank" rel="noreferrer nofollow" className="break-all">{s.publisher} ↗</a> : <span key={i} className="text-ink2">{s.publisher}</span>)}</div>
                  {e.quote && <details className="disclose"><summary>Source text</summary><blockquote className="text-[12px] mt-1 border-l-2 hair pl-3">“{e.quote}”{e.date_quote && <span className="block text-ink2 mt-1">Date as written: “{e.date_quote}”</span>}</blockquote></details>}
                </div>
              </li>
            );
          })}
        </ol>
        <details className="disclose">
          <summary>How this timeline was built</summary>
          <ul className="text-[12px] text-ink2 grid gap-1 mt-2">
            <li>{all.length} events from {sources} source(s). Dates come from source timestamps, registry records{t.registry.length ? ` (${t.registry.map((r) => `${r.id} ${r.registry}: ${r.status === "ok" ? "found" : r.status === "not_found" ? "not found" : "unreachable"}`).join("; ")})` : ""} and Argus Watch&apos;s own records.</li>
            <li>{t.model.name ? `Meta ${t.model.name}` : "Meta Muse Spark"} read the reports and proposed {t.model.proposed} dated development(s); {t.model.accepted} were kept because their date and claim appear verbatim in the source{t.model.rejected.length ? `; ${t.model.rejected.length} rejected (${[...new Set(t.model.rejected.map((r) => r.reason))].join("; ")})` : ""}.{t.model.error ? ` Model unavailable: ${t.model.error}. Showing dated records only.` : ""}</li>
            <li>{t.wonder.enabled ? (t.wonder.reviews.length ? `Meta Muse Wonder reviewed a date conflict: ${t.wonder.reviews[0].resolution === "unresolved" ? "unresolved" : "a preference was accepted because it quoted the source"}. No event is ever removed.` : "Muse Wonder conflict review is on; no conflict needed review.") : "Conflicting dates are shown side by side (Muse Wonder review is off)."}</li>
            <li>Exploitation is &ldquo;Confirmed&rdquo; only from CISA&apos;s Known Exploited Vulnerabilities catalog. Built {t.built_at.replace("T", " ").slice(0, 16)} UTC; rebuilt automatically when new reports about this threat arrive.</li>
          </ul>
        </details>
      </>}
    </section>
  );
}
