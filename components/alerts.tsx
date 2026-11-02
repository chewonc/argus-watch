// Alert list primitives (server components): severity chip, counts, and the actionable alert card.
// A card answers: how bad (severity + verdict), what (title), where (repo + file:lines), why (one line),
// how to fix (one line), and what you can do (actions). Details stay behind a disclosure.
import Link from "next/link";
import { OpenIn } from "@/components/open-in";
import { Band, Chip, Timeline } from "@/components/ui";
import type { Dict } from "@/lib/i18n/dictionary";
import type { Assessment, Finding, Severity } from "@/lib/schema";
import { severityLabel, SEVERITY_ORDER } from "@/lib/severity";
import { relevance } from "@/lib/verdict";

export function SeverityChip({ s }: { s: Severity }) {
  return <span className={`chip chip-sev-${s.level}`} title={s.source === "estimated" ? "Estimated from verdict and source tier; the advisory states no severity" : "Severity stated by the advisory"}>{severityLabel(s)}</span>;
}

export type CardData = { a: Assessment; f: Finding | null; sev: Severity; read: boolean; resolved: boolean; fixState: "none" | "drafted" | "pr_created" | "failed"; allowPr: boolean; localRoot: string | null; caseHref: string; tx?: { title?: string; problem?: string; fix?: string } };

export function location(a: Assessment): { file: string; from: number; to: number } | null {
  const ls = [...a.locations, ...a.conditions.flatMap((c) => c.evidence.filter((e) => e.line).map((e) => ({ file: e.file, line: e.line! })))].filter((l) => !/package-lock|pnpm-lock|yarn\.lock/.test(l.file));
  if (!ls.length) return null;
  const byFile = new Map<string, number[]>();
  for (const l of ls) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l.line]);
  const [file, lines] = [...byFile.entries()].sort((x, y) => y[1].length - x[1].length)[0];
  return { file, from: Math.min(...lines), to: Math.max(...lines) };
}
export const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
/** Anchor id for a source line in the case page's code pane. Used on both ends so nested paths resolve. */
export const lineAnchor = (file: string, line: number) => `L-${file.replace(/[^A-Za-z0-9._-]/g, "_")}-${line}`;
export function suggestedFix(a: Assessment): string | null {
  const observed = new Set(a.conditions.filter((c) => c.state === "Observed" || c.state === "Inferred").map((c) => c.id));
  const recs = [...a.recommendations].sort((x, y) => Number(y.condition_ids.some((id) => observed.has(id))) - Number(x.condition_ids.some((id) => observed.has(id))));
  return recs[0]?.text ?? null;
}

export function Counts({ cards, d }: { cards: CardData[]; d: Dict }) {
  const open = cards.filter((c) => c.a.verdict !== "Not Affected" && !c.resolved);
  const by = (lvl: Severity["level"]) => open.filter((c) => c.sev.level === lvl).length;
  const tiles: [string, string, number][] = [
    ["needs_action", d.needs_action, open.length], ["critical", d.critical, by("critical")], ["high", d.high, by("high")], ["moderate", d.moderate, by("moderate")], ["low", d.low, by("low")],
    ["new", d.new_unread, open.filter((c) => !c.read).length], ["resolved", d.resolved, cards.filter((c) => c.resolved).length], ["not_affected", d.not_affected, cards.filter((c) => c.a.verdict === "Not Affected").length],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mono text-[12px]">
      {tiles.map(([k, label, v]) => <div key={k} className="border hair rounded-[6px] p-3"><div className="label">{label}</div><div className={`text-[22px] font-sans ${SEVERITY_ORDER.includes(k as Severity["level"]) && v ? `chip-sev-${k}` : ""}`}>{v}</div></div>)}
    </div>
  );
}

export function AlertCard({ c, repo, d }: { c: CardData; repo: string; d: Dict }) {
  const { a, f, sev } = c;
  const loc = location(a);
  const problem = c.tx?.problem ?? (f?.claim?.summary ? firstSentence(f.claim.summary) : a.verdict_qualifier);
  const fix = c.tx?.fix ?? suggestedFix(a);
  const ids = f?.ids.join(", ") || a.finding_id;
  const briefUrl = `/api/remediation/${a.id.split("/").map(encodeURIComponent).join("/")}?agent=claude&download=1`;
  const rel = relevance(a.verdict, a.tier, a.conditions);
  return (
    <li className={`fade border hair rounded-[6px] bg-raised p-4 grid gap-3 ${c.read ? "" : "border-l-4"}`} style={c.read ? undefined : { borderLeftColor: "var(--accent)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip s={sev} />
        <span className={`chip ${a.verdict === "Affected" ? "chip-Contradicted" : a.verdict === "Not Affected" ? "chip-Observed" : "chip-Inferred"}`}>{rel}</span>
        <span className="label">{a.tier}{a.replayed ? " · replayed" : ""}</span>
        {c.resolved && <span className="label" style={{ color: "var(--observed)" }}>fix proposed</span>}
        {!c.read && <span className="label" style={{ color: "var(--accent)" }}>new</span>}
      </div>
      <div>
        <Link href={c.caseHref} className="text-[16px] font-medium no-underline">{c.tx?.title ?? f?.title ?? a.finding_id}</Link>
        <div className="mono text-[12px] text-ink2 mt-1">{ids} · {repo}@{a.sha.slice(0, 7)} · {loc ? <a href={`${c.caseHref}#${lineAnchor(loc.file, loc.from)}`}>{loc.file}:{loc.from}{loc.to !== loc.from ? `–${loc.to}` : ""}</a> : <span title={d.no_location}>{d.no_location}</span>}</div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-[13px]">
        <div><div className="label">{d.problem}</div>{problem}</div>
        <div><div className="label">{d.suggested_fix}</div>{fix ?? <span className="text-ink2">{d.no_fix}</span>}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${c.caseHref}${loc ? `#${lineAnchor(loc.file, loc.from)}` : ""}`} className="btn-ghost no-underline">{d.view_code}</Link>
        {a.verdict !== "Not Affected" && <Link href={`${c.caseHref}#fix`} className="btn-ghost no-underline">{c.fixState === "pr_created" ? d.view_pr : d.preview_fix}</Link>}
        {a.verdict !== "Not Affected" && <Link href={`${c.caseHref}#fix`} className={`btn no-underline ${c.allowPr ? "" : "opacity-50"}`} title={c.allowPr ? "Opens the approval dialog on the case page" : "Enable draft pull requests for this repository on the Repos page first"}>{d.apply_fix}</Link>}
        <OpenIn t={{ repo: a.repo.split("/").slice(0, 2).join("/"), sha: a.sha, file: loc?.file ?? null, line: loc?.from ?? null, localRoot: c.localRoot, caseUrl: c.caseHref, briefUrl, ids }} />
        <a href={briefUrl} className="btn-ghost no-underline">{d.generate_prompt}</a>
      </div>
      <details>
        <summary className="label cursor-pointer">{d.technical_details}</summary>
        <div className="grid gap-3 mt-3">
          <Band a={a} compact />
          <ul className="grid gap-1 text-[13px]">{a.conditions.map((cd) => <li key={cd.id} className="flex gap-2 items-start"><Chip state={cd.state} /><span>{cd.text}</span></li>)}</ul>
          <Timeline a={a} />
        </div>
      </details>
    </li>
  );
}
