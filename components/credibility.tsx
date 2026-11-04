// Credibility of the threat REPORT (lib/verify.ts). Deliberately separate from the repository status pill:
// "Is this threat real?" vs "Does it affect my code?".
import type { Finding } from "@/lib/schema";
import { CREDIBILITY_TEXT, type Credibility } from "@/lib/verify";

type Cred = NonNullable<Finding["credibility"]>;
const TONE = { ok: "var(--observed)", warn: "var(--inferred)", bad: "var(--contradicted)", muted: "var(--ink-2)" };

export function CredibilityChip({ c, compact = false, l = { none: "Report not checked yet", prefix: "Report" } }: { c: Cred | null | undefined; compact?: boolean; l?: { none: string; prefix: string } }) {
  if (!c) return compact ? null : <span className="chip" style={{ color: TONE.muted }}>{l.none}</span>;
  const t = CREDIBILITY_TEXT[c.label as Credibility];
  return <span className="chip" style={{ color: TONE[t.tone] }} title={`${t.help} ${c.reason}`}>{compact ? t.label : `${l.prefix}: ${t.label}`}</span>;
}

const KIND: Record<string, string> = { artefact: "Registry record", primary_source: "Primary source", independent_report: "Independent report", copy: "Copy of the same origin", contradiction: "Contradiction", publisher: "Reported by", note: "Note" };

export function CredibilityPanel({ c, title = "Is this threat real?", none = "This report has not been fact-checked yet.", collapsible = false, viewDetails = "View details" }: { c: Cred | null | undefined; title?: string; none?: string; collapsible?: boolean; viewDetails?: string }) {
  if (!c) return <section className="grid gap-1"><div className="flex flex-wrap items-baseline gap-2"><h2 className="text-[calc(15px*var(--ui))] font-semibold">{title}</h2>{collapsible && <CredibilityChip c={c} compact={false} l={{ none: "Not checked", prefix: "" }} />}</div><p className="text-[calc(13px*var(--ui))] text-ink2">{none}</p></section>;
  const t = CREDIBILITY_TEXT[c.label as Credibility];
  const groups = ["artefact", "primary_source", "independent_report", "contradiction", "copy", "publisher"].map((k) => [k, c.evidence.filter((e) => e.kind === k)] as const).filter(([, xs]) => xs.length);
  const claims = c.evidence.filter((e) => e.kind === "note" && e.text.startsWith("claim: ")).map((e) => e.text.slice(7));
  const group = ([k, xs]: readonly [string, typeof c.evidence]) => (
    <div key={k}><div className="label mb-1">{KIND[k]}</div>
      <ul className="grid gap-0.5">{xs.map((e, i) => <li key={i} className="[overflow-wrap:anywhere]">{e.url ? <a href={e.url} target="_blank" rel="noreferrer nofollow">{e.text} ↗</a> : e.text}</li>)}</ul>
    </div>
  );
  const footer = (
    <p className="text-[calc(11px*var(--ui))] text-ink2">
      Checked {c.checked_at.replace("T", " ").slice(0, 16)} UTC · registries: NVD, OSV, GitHub Advisory Database, arXiv
      {c.model.used ? ` · Meta ${c.model.name ?? "Muse Spark"} with web search: ${c.model.searches} search(es)${c.model.discarded_urls ? `, ${c.model.discarded_urls} unseen URL(s) discarded` : ""}` : c.model.error ? ` · web search unavailable (${c.model.error.slice(0, 80)})` : " · web search not needed (official source)"}
    </p>
  );
  const scope = <p className="text-[calc(12px*var(--ui))] text-ink2">This is about the report itself, not about your code. Search results are treated as leads; only registry records and primary sources count as confirmation.</p>;
  const claimList = claims.length > 0 && <div><div className="label mb-1">Claims checked</div><ul className="list-disc pl-5 grid gap-0.5">{claims.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  if (collapsible) {
    // Contradictions are warnings: they stay visible; everything else is one click away.
    const warn = groups.filter(([k]) => k === "contradiction");
    return (
      <section className="grid gap-3 text-[calc(13px*var(--ui))]" aria-labelledby="cred-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="cred-h" className="text-[calc(15px*var(--ui))] font-semibold">{title}</h2><CredibilityChip c={c} compact /></div>
        <p>{t.help} <span className="text-ink2">{c.reason}.</span></p>
        {warn.map(group)}
        <details className="disclose"><summary>{viewDetails}</summary>
          <div className="grid gap-3 mt-3">{scope}{claimList}{groups.filter(([k]) => k !== "contradiction").map(group)}{footer}</div>
        </details>
      </section>
    );
  }
  return (
    <section className="grid gap-3 text-[calc(13px*var(--ui))]" aria-labelledby="cred-h">
      <div className="flex flex-wrap items-baseline gap-2"><h2 id="cred-h" className="text-[calc(15px*var(--ui))] font-semibold">{title}</h2><CredibilityChip c={c} /></div>
      <p>{t.help} <span className="text-ink2">{c.reason}.</span></p>
      {scope}{claimList}{groups.map(group)}{footer}
    </section>
  );
}
