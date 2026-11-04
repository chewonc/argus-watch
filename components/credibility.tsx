// Credibility of the threat REPORT (lib/verify.ts). Deliberately separate from the repository status pill:
// "Is this threat real?" vs "Does it affect my code?".
import type { Finding } from "@/lib/schema";
import { CREDIBILITY_TEXT, type Credibility } from "@/lib/verify";

type Cred = NonNullable<Finding["credibility"]>;
const TONE = { ok: "var(--observed)", warn: "var(--inferred)", bad: "var(--contradicted)", muted: "var(--ink-2)" };

export function CredibilityChip({ c, compact = false }: { c: Cred | null | undefined; compact?: boolean }) {
  if (!c) return compact ? null : <span className="chip" style={{ color: TONE.muted }} title="This report has not been fact-checked yet">Report not checked yet</span>;
  const t = CREDIBILITY_TEXT[c.label as Credibility];
  return <span className="chip" style={{ color: TONE[t.tone] }} title={`${t.help} ${c.reason}`}>{compact ? t.label : `Report: ${t.label}`}</span>;
}

const KIND: Record<string, string> = { artefact: "Registry record", primary_source: "Primary source", independent_report: "Independent report", copy: "Copy of the same origin", contradiction: "Contradiction", publisher: "Reported by", note: "Note" };

export function CredibilityPanel({ c, title = "Is this threat real?" }: { c: Cred | null | undefined; title?: string }) {
  if (!c) return <p className="text-[13px] text-ink2">This report has not been fact-checked yet.</p>;
  const t = CREDIBILITY_TEXT[c.label as Credibility];
  const groups = ["artefact", "primary_source", "independent_report", "contradiction", "copy", "publisher"].map((k) => [k, c.evidence.filter((e) => e.kind === k)] as const).filter(([, xs]) => xs.length);
  const claims = c.evidence.filter((e) => e.kind === "note" && e.text.startsWith("claim: ")).map((e) => e.text.slice(7));
  return (
    <section className="grid gap-3 text-[13px]" aria-labelledby="cred-h">
      <div className="flex flex-wrap items-baseline gap-2"><h2 id="cred-h" className="text-[15px] font-semibold">{title}</h2><CredibilityChip c={c} /></div>
      <p>{t.help} <span className="text-ink2">{c.reason}.</span></p>
      <p className="text-[12px] text-ink2">This is about the report itself, not about your code. Search results are treated as leads; only registry records and primary sources count as confirmation.</p>
      {claims.length > 0 && <div><div className="label mb-1">Claims checked</div><ul className="list-disc pl-5 grid gap-0.5">{claims.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {groups.map(([k, xs]) => (
        <div key={k}><div className="label mb-1">{KIND[k]}</div>
          <ul className="grid gap-0.5">{xs.map((e, i) => <li key={i} className="break-words">{e.url ? <a href={e.url} target="_blank" rel="noreferrer nofollow">{e.text} ↗</a> : e.text}</li>)}</ul>
        </div>
      ))}
      <p className="text-[11px] text-ink2">
        Checked {c.checked_at.replace("T", " ").slice(0, 16)} UTC · registries: NVD, OSV, GitHub Advisory Database, arXiv
        {c.model.used ? ` · Meta ${c.model.name ?? "Muse Spark"} with web search: ${c.model.searches} search(es)${c.model.discarded_urls ? `, ${c.model.discarded_urls} unseen URL(s) discarded` : ""}` : c.model.error ? ` · web search unavailable (${c.model.error.slice(0, 80)})` : " · web search not needed (official source)"}
      </p>
    </section>
  );
}
