import type { Assessment, EvidenceState, Verdict } from "@/lib/schema";

export const GLYPH: Record<EvidenceState, string> = { Observed: "■", Inferred: "◧", Unknown: "□", Contradicted: "⊠" };

export function Chip({ state }: { state: EvidenceState }) {
  return <span className={`chip chip-${state}`} aria-label={state}><span aria-hidden>{GLYPH[state]}</span>{state}</span>;
}

export function verdictClass(v: Verdict) { return v === "Affected" ? "band-Affected" : v === "Not Affected" ? "band-NotAffected" : "band-Unclear"; }

export function Band({ a, compact = false, qualifier }: { a: Assessment; compact?: boolean; qualifier?: string }) {
  return (
    <div className={`band ${verdictClass(a.verdict)}`}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`serif verdict-word ${compact ? "text-[22px]" : "text-[32px]"}`}>{a.verdict}</span>
        <span className="label">{a.tier}{a.replayed ? " · replayed" : ""}</span>
      </div>
      {!compact && <p className="mt-1 text-[15px]">{qualifier ?? a.verdict_qualifier}</p>}
      {!compact && <p className="mt-1 text-[12px] text-ink2 mono">rule: {a.verdict_reason}</p>}
    </div>
  );
}

export const fmtTime = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z" : "n/a");
export const secs = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);
export const human = (s: number | null) => (s == null ? "n/a" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : s < 172800 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Unknown");

/** Dates of an assessment, one per line; exact UTC time on hover. */
export function Timeline({ a }: { a: Assessment }) {
  const t = a.timestamps;
  const steps: [string, string | null][] = [["Published", t.published_at], ["Discovered", t.discovered_at], ["Processed", t.processed_at], ["Notified", t.notified_at]];
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
      {steps.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink2">{k}</dt><dd title={v ? fmtTime(v) : undefined}>{fmtDay(v)}</dd></div>)}
    </dl>
  );
}
