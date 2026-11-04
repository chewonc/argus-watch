// Context-aware actions for a finding, shared by the Threats list and the finding page. Pure: derived only from
// the assessment, the existing fix records (lib/schema.ts Fix.status, the one remediation state machine) and the
// repository's real permissions. Severity never decides what is offered.
//   Fix now      confirmed finding, repository allows changes, App can write, deployment has fixes enabled
//   Verify       possible issue / insufficient evidence: read-only check with the user's own agent; never edits code
//   Review fix   confirmed, but automation cannot act here (the reason is shown)
//   View progress / View PR / View fix   a remediation already exists for this finding
// An opened pull request is never shown as "resolved".
import { isVerified, location } from "./labels";
import { UNFIXABLE } from "./fixgate";
import type { Assessment, Fix } from "./schema";

export type ActionKind = "fix_now" | "retry" | "verify" | "review_fix" | "view_pr" | "view_fix" | "view_progress";
export type ActionTone = "muted" | "warn" | "bad" | "ok";
export type FindingAction = {
  primary: { kind: ActionKind; href: string; external: boolean } | null;
  state: { key: "awaiting" | "preparing" | "in_progress" | "checks" | "pr" | "blocked" | "failed" | "merged"; tone: ActionTone } | null;
  note: string | null;
};
export type ActionContext = { fixEnabled: boolean; allowPr: boolean; isDemo: boolean; hasInstallation: boolean; writePermission: boolean | null };

const ACTIVE: Partial<Record<Fix["status"], NonNullable<FindingAction["state"]>["key"]>> = { drafting: "preparing", approved: "preparing", queued: "preparing", running: "in_progress", validated: "in_progress", merging: "checks" };

/** Newest fix record for the assessment (fixes are stored per assessment). */
export const latestFix = (fixes: Fix[]) => [...fixes].sort((x, y) => y.created_at.localeCompare(x.created_at))[0] ?? null;

/** Why automation cannot change this repository, or null when it can. Checked in the same order the server enforces. */
export function automationBlocker(a: Assessment, ctx: ActionContext): string | null {
  const loc = location(a);
  if (!ctx.fixEnabled) return "Automated fixes are turned off on this deployment.";
  if (ctx.isDemo) return "Shared demo repository: fixes are preview-only here.";
  if (!loc) return "No exact line was cited, so there is nothing safe to change automatically.";
  if (UNFIXABLE.test(loc.file)) return `${loc.file.split("/").pop()} can't be changed automatically (lockfiles, secrets and CI workflows are excluded).`;
  if (!ctx.hasInstallation) return "Install the Argus Watch GitHub App on this repository to apply fixes.";
  if (ctx.writePermission === false) return "The GitHub App needs write access to contents and pull requests.";
  if (ctx.writePermission == null) return "Write access for this repository could not be confirmed.";
  if (!ctx.allowPr) return "Changes are off for this repository: enable them on Repositories.";
  return null;
}

export function findingAction(a: Assessment, fixes: Fix[], ctx: ActionContext, caseHref: string): FindingAction {
  if (a.verdict === "Not Affected") return { primary: null, state: null, note: null };
  const fx = latestFix(fixes);
  const fixHref = `${caseHref}#fix`;
  if (fx) {
    const active = ACTIVE[fx.status];
    if (active) return { primary: { kind: "view_progress", href: fixHref, external: false }, state: { key: active, tone: "warn" }, note: null };
    if (fx.status === "pr_created") return { primary: fx.pr_url ? { kind: "view_pr", href: fx.pr_url, external: true } : { kind: "view_progress", href: fixHref, external: false }, state: { key: "pr", tone: "ok" }, note: "A pull request is a proposed change: review and merge it on GitHub. The alert stays open until then." };
    if (fx.status === "blocked_by_protection") return { primary: fx.pr_url ? { kind: "view_pr", href: fx.pr_url, external: true } : { kind: "view_progress", href: fixHref, external: false }, state: { key: "blocked", tone: "warn" }, note: fx.error };
    if (fx.status === "merged") return { primary: { kind: "view_fix", href: fx.commit_url ?? fx.pr_url ?? fixHref, external: !!(fx.commit_url ?? fx.pr_url) }, state: { key: "merged", tone: "ok" }, note: null };
  }
  // The user's own agent already checked it and found it does not apply: nothing further to verify here (Details stays).
  if (a.agent?.status === "not_affected" && !isVerified(a)) return { primary: null, state: null, note: "Your AI agent checked this and reported that it does not affect your code." };
  if (!isVerified(a)) return { primary: { kind: "verify", href: `${caseHref}?verify=1#agent`, external: false }, state: null, note: null };
  const blocker = automationBlocker(a, ctx);
  const failed = fx && (fx.status === "failed" || fx.status === "validation_failed");
  if (blocker) return { primary: { kind: "review_fix", href: fx ? fixHref : `${caseHref}#how-to-fix`, external: false }, state: failed ? { key: "failed", tone: "bad" } : null, note: failed && fx.error ? `${fx.error} ${blocker}` : blocker };
  if (failed) return { primary: { kind: "retry", href: `${caseHref}?act=1#fix`, external: false }, state: { key: "failed", tone: "bad" }, note: fx.error };
  return { primary: { kind: "fix_now", href: `${caseHref}?act=1#fix`, external: false }, state: fx?.status === "drafted" ? { key: "awaiting", tone: "muted" } : null, note: null };
}
