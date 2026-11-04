// Alert list primitives (server components). A card answers three things only: how it stands (one status),
// what is wrong (plain title) and where (verified location, or an honest "not yet confirmed"). View opens the
// finding; Fix appears only when lib/fixgate.ts allows it. Everything technical lives on the finding page.
import Link from "next/link";
import { CredibilityChip } from "./credibility";
import { FindingActions, type ActionLabels } from "./finding-actions";
import type { FindingAction } from "@/lib/actions";
import { location as loc0, type Status } from "@/lib/labels";
import type { Assessment, Finding, Severity } from "@/lib/schema";

export const location = loc0;
export const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
/** Anchor id for a source line in the case page's code pane. Used on both ends so nested paths resolve. */
export const lineAnchor = (file: string, line: number) => `L-${file.replace(/[^A-Za-z0-9._-]/g, "_")}-${line}`;
export function suggestedFix(a: Assessment): string | null {
  const observed = new Set(a.conditions.filter((c) => c.state === "Observed" || c.state === "Inferred").map((c) => c.id));
  const recs = [...a.recommendations].sort((x, y) => Number(y.condition_ids.some((id) => observed.has(id))) - Number(x.condition_ids.some((id) => observed.has(id))));
  return recs[0]?.text ?? null;
}

export function StatusPill({ s }: { s: Pick<Status, "label" | "glyph" | "tone"> }) {
  return <span className={`status tone-${s.tone}`}><span aria-hidden>{s.glyph}</span>{s.label}</span>;
}

export type CardData = { a: Assessment; f: Finding | null; sev: Severity; status: Status; title: string; where: { kind: "file" | "package" | "unverified" | "none"; text: string }; act: FindingAction; caseHref: string };

export function AlertCard({ c, labels }: { c: CardData; labels: ActionLabels }) {
  return (
    <li className="fade grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-4 border-b hair last:border-0">
      <div className="grid gap-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2"><StatusPill s={c.status} /><CredibilityChip c={c.f?.credibility} compact /></div>
        <Link href={c.caseHref} className="text-[15px] font-semibold leading-snug no-underline hover:underline">{c.title}</Link>
        <div className={`text-[13px] truncate ${c.where.kind === "file" || c.where.kind === "package" ? "mono text-ink2" : "text-ink2"}`}>
          {c.where.kind === "file" || c.where.kind === "package" ? <span aria-label="Affected file">{c.where.text}</span> : c.where.text}
        </div>
      </div>
      <div className="max-sm:col-span-2 max-sm:mt-2">
        <FindingActions act={c.act} labels={labels} secondary={{ href: c.caseHref, label: labels.details }} showNote={false} align="end" modalFor={c.a.id} />
      </div>
    </li>
  );
}
