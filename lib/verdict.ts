// Deterministic verdict (owner policy: STRICT). The model never chooses the verdict.
import type { ConditionResult, Tier, Verdict } from "./schema";

export function decide(conds: ConditionResult[], tier: Tier): { verdict: Verdict; reason: string; missing: string[] } {
  const missing = conds.filter((c) => c.state === "Unknown").map((c) => c.text);
  const contradicted = conds.filter((c) => c.state === "Contradicted");
  if (contradicted.length) return { verdict: "Not Affected", reason: `Contradicted: ${contradicted.map((c) => c.id).join(", ")}`, missing };
  const required = conds.filter((c) => c.role === "required");
  const notMet = required.filter((c) => c.state !== "Observed" && c.state !== "Inferred");
  if (required.length === 0) return { verdict: "Unclear", reason: "No required conditions could be derived from the report", missing };
  if (notMet.length) return { verdict: "Unclear", reason: `Required condition(s) not established: ${notMet.map((c) => c.id).join(", ")}`, missing };
  const envUnknown = conds.filter((c) => c.role === "mitigation" && c.mitigation_kind === "environment" && c.state === "Unknown");
  if (envUnknown.length) return { verdict: "Unclear", reason: `Strict policy: environment-dependent protection unknown (${envUnknown.map((c) => c.id).join(", ")})`, missing };
  // Tier cap
  if (tier === "signal") return { verdict: "Unclear", reason: "Tier cap: single unconfirmed source (preliminary report) cannot establish Affected", missing };
  if (tier === "corroborated" && required.some((c) => c.state !== "Observed")) return { verdict: "Unclear", reason: "Tier cap: corroborated-but-unofficial report requires every required condition Observed", missing };
  return { verdict: "Affected", reason: "All required conditions Observed/Inferred; no contradiction; environment protections not unknown", missing };
}

/** Five-step relevance label (code, not model): how strongly the evidence supports that this repository is affected. */
export type Relevance = "Confirmed affected" | "Likely affected" | "Potentially affected" | "Insufficient evidence" | "Not affected";
export function relevance(v: Verdict, tier: Tier, conds: Pick<ConditionResult, "state" | "role">[]): Relevance {
  if (v === "Not Affected") return "Not affected";
  if (v === "Affected") return tier === "official" ? "Confirmed affected" : "Likely affected";
  const required = conds.filter((c) => c.role === "required");
  const anyKnown = required.some((c) => c.state === "Observed" || c.state === "Inferred");
  return anyKnown ? "Potentially affected" : "Insufficient evidence";
}

export function qualifier(v: Verdict, tier: Tier): string {
  const pre = tier === "official" ? "" : tier === "corroborated" ? " Pre-advisory: not yet officially confirmed." : " Preliminary report from a single unconfirmed source.";
  if (v === "Affected") return `Affected under the stated conditions, based on inspected static evidence only.${pre}`;
  if (v === "Not Affected") return `Not affected under the stated conditions, based on inspected evidence. This is not a guarantee of safety.${pre}`;
  return `Unclear. Inspected evidence does not establish whether the stated conditions hold. See missing evidence.${pre}`;
}
