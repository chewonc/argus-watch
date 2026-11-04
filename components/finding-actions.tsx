// Context-aware actions for a finding (lib/actions.ts decides; this only renders). Used by the Threats list and the
// finding page so both always offer the same thing for the same state.
import Link from "next/link";
import type { FindingAction } from "@/lib/actions";
import { FixButton } from "./fix-modal";

// Actions that open the Fix modal in place (no navigation) when an assessment id is given.
const IN_MODAL = new Set(["fix_now", "retry", "verify", "review_fix", "approve", "view_progress"]);

export type ActionLabels = Record<"fix_now" | "retry" | "approve" | "verify" | "review_fix" | "view_pr" | "view_fix" | "view_progress" | "details", string> & { spark?: string }
  & Record<"st_awaiting" | "st_preparing" | "st_in_progress" | "st_patch_ready" | "st_creating_pr" | "st_checks" | "st_pr" | "st_blocked" | "st_failed" | "st_stalled" | "st_cancelled" | "st_merged" | "st_pushed", string>;

export function FindingActions({ act, labels, secondary, showNote = true, align = "start", modalFor, autoOpen = false }: { act: FindingAction; labels: ActionLabels; secondary?: { href: string; label: string } | null; showNote?: boolean; align?: "start" | "end"; modalFor?: string; autoOpen?: boolean }) {
  const p = act.primary;
  if (!p && !secondary && !act.state) return null;
  return (
    <div className={`grid gap-1.5 ${align === "end" ? "justify-items-end max-sm:justify-items-start" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {act.state && <span className={`text-[12px] tone-${act.state.tone}`} role="status">{labels[`st_${act.state.key}`]}</span>}
        {p && modalFor && IN_MODAL.has(p.kind) ? <FixButton assessmentId={modalFor} label={labels[p.kind]} autoOpen={autoOpen} /> : p && (p.external
          ? <a href={p.href} target="_blank" rel="noreferrer" className="btn">{labels[p.kind]} <span aria-hidden>↗</span></a>
          : <Link href={p.href} className="btn">{labels[p.kind]}</Link>)}
        {secondary && <Link href={secondary.href} className="btn-ghost">{secondary.label}</Link>}
      </div>
      {showNote && act.note && <p className={`text-[12px] text-ink2 max-w-[460px] ${align === "end" ? "sm:text-right" : ""}`}>{act.note}</p>}
    </div>
  );
}
