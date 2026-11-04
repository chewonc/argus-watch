// Bulk fixing: pure rules, unit-tested. Selection → preview (classification, no work) → prepare (per finding, through the
// same single-fix endpoints and checks) → review grouped by repository → one explicit approval per listed operation.
//   classify()   what can happen to each selected finding, from real state only (verdict, evidence, fixes, permissions)
//   groupFixes() which prepared patches can safely share one commit/PR: same repository, same base commit, same default
//                branch, no file touched by two patches, no duplicate finding. Everything else stays separate.
import { automationBlocker, latestFix } from "./actions";
import { isVerified } from "./labels";
import type { RemediationMode } from "./remediation-mode";
import type { Assessment, Fix } from "./schema";
import type { ActionContext } from "./actions";

export type BulkClass = "ready" | "needs_verification" | "ineligible";
export type BulkItem = { assessment_id: string; repo: string; title: string; cls: BulkClass; reason: string | null };

const ACTIVE = new Set(["drafting", "queued", "running", "approved", "merging"]);
const DONE = new Set(["pr_created", "merged", "branch_pushed", "blocked_by_protection"]);

/** Classify one finding for a bulk run. "ready" means eligible to ATTEMPT a fix, never that a fix will succeed. */
export function classify(a: Assessment, fixes: Fix[], ctx: ActionContext, resolved: boolean): { cls: BulkClass; reason: string | null } {
  if (resolved) return { cls: "ineligible", reason: "Already resolved." };
  if (a.verdict === "Not Affected") return { cls: "ineligible", reason: "Your code isn't affected." };
  const fx = latestFix(fixes);
  if (fx && ACTIVE.has(fx.status)) return { cls: "ineligible", reason: "A fix is already in progress." };
  if (fx && DONE.has(fx.status)) return { cls: "ineligible", reason: "A fix was already created." };
  if (!isVerified(a)) {
    if (a.agent?.status === "not_affected") return { cls: "ineligible", reason: "Your AI agent reported it doesn't affect your code." };
    const b = automationBlocker({ ...a, verdict: "Affected" }, ctx);
    return b ? { cls: "ineligible", reason: plain(b) } : { cls: "needs_verification", reason: "Will be checked first." };
  }
  const b = automationBlocker(a, ctx);
  return b ? { cls: "ineligible", reason: plain(b) } : { cls: "ready", reason: null };
}
const plain = (b: string) => b.replace(/^(Deployment configuration|Repository permission): /, "").replace(/^./, (c) => c.toUpperCase());

export type PreparedFix = Pick<Fix, "id" | "assessment_id" | "repo" | "base_sha" | "files" | "patch_version" | "status">;
export type FixGroup = { repo: string; fixes: PreparedFix[]; combined: boolean; reason: string | null };

/** Group prepared patches per repository; combine only when provably independent. Never across repositories. */
export function groupFixes(fixes: PreparedFix[]): FixGroup[] {
  const out: FixGroup[] = [];
  const byRepo = new Map<string, PreparedFix[]>();
  for (const f of fixes) byRepo.set(f.repo, [...(byRepo.get(f.repo) ?? []), f]);
  for (const [repo, list] of byRepo) {
    const seenAssess = new Set<string>();
    const combinable: PreparedFix[] = [];
    const files = new Set<string>();
    const base = list[0].base_sha;
    for (const f of list) {
      const paths = f.files.map((x) => x.path);
      const reason = seenAssess.has(f.assessment_id) ? "Duplicate fix for the same finding."
        : f.base_sha !== base ? "Prepared against a different commit, so it gets its own pull request."
        : paths.some((p) => files.has(p)) ? "Changes the same file as another fix, so it gets its own pull request."
        : null;
      if (reason) { out.push({ repo, fixes: [f], combined: false, reason }); continue; }
      seenAssess.add(f.assessment_id); paths.forEach((p) => files.add(p)); combinable.push(f);
    }
    if (combinable.length) out.unshift({ repo, fixes: combinable, combined: combinable.length > 1, reason: null });
  }
  return out;
}

/** Destination wording for the bulk approval button. */
export function approveLabel(mode: RemediationMode, groups: number): string {
  if (mode === "preview") return "Copy patches";
  return mode === "branch" ? `Approve & push ${groups} branch${groups === 1 ? "" : "es"}` : `Approve & create ${groups} PR${groups === 1 ? "" : "s"}`;
}
