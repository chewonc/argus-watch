// Severity shown on alert cards and counts. Stated severity (GHSA level or CVSS score) wins; otherwise an
// explicit *estimate* from verdict x tier (bumped one level when CISA KEV lists the CVE as exploited).
// The source is always displayed next to the level so an estimate is never mistaken for a vendor rating.
import type { Assessment, Item, Severity } from "./schema";

const ORDER = ["low", "moderate", "high", "critical"] as const;
type Lvl = (typeof ORDER)[number];
const bump = (l: Lvl): Lvl => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(l) + 1)];

export function cvssLevel(score: number): Lvl { return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "moderate" : "low"; }

export function deriveSeverity(a: Pick<Assessment, "verdict" | "tier">, items: Pick<Item, "source" | "text" | "raw">[]): Severity {
  const g = items.find((i) => i.source === "ghsa" || i.source === "ghadv" || i.source === "nvd");
  const raw = g?.raw as { severity?: string; cvss_score?: number | null } | undefined;
  const cvss = raw?.cvss_score ?? null;
  if (cvss != null && Number.isFinite(cvss)) return { level: cvssLevel(cvss), cvss, source: "ghsa" };
  const lvl = (raw?.severity ?? g?.text.match(/^Severity:\s*(\w+)/im)?.[1])?.toLowerCase();
  if (lvl && (ORDER as readonly string[]).includes(lvl)) return { level: lvl as Lvl, cvss: null, source: "ghsa" };
  if (a.verdict === "Not Affected") return { level: "none", cvss: null, source: "estimated" };
  const base: Lvl = a.verdict === "Affected" ? (a.tier === "official" ? "high" : "moderate") : a.tier === "official" ? "moderate" : "low";
  const kev = items.some((i) => i.source === "kev");
  return { level: kev ? bump(base) : base, cvss: null, source: "estimated" };
}

export const SEVERITY_ORDER: Severity["level"][] = ["critical", "high", "moderate", "low", "none", "unknown"];
export const severityLabel = (s: Severity) => `${s.level.toUpperCase()}${s.cvss != null ? ` · CVSS ${s.cvss}` : ""}${s.source === "estimated" ? " · estimated" : ""}`;
