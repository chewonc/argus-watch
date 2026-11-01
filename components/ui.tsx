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

export const fmtTime = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—");
export const secs = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);
export const human = (s: number | null) => (s == null ? "—" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : s < 172800 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);

export function Timeline({ a }: { a: Assessment }) {
  const t = a.timestamps;
  const steps: [string, string | null][] = [["published", t.published_at], ["discovered", t.discovered_at], ["processed", t.processed_at], ["notified", t.notified_at]];
  return (
    <div className="tl mono text-[12px]">
      {steps.map(([k, v], i) => (
        <div key={k}>
          <div className="label">{k}</div>
          <div>{fmtTime(v)}</div>
          {i > 0 && <div className="text-ink2">+{human(secs(steps[i - 1][1], v))}</div>}
        </div>
      ))}
    </div>
  );
}
