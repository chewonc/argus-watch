// Plain-language outcome of a fix attempt for the Auto Fix tab: what happened, did it work, what next. Pure (unit-tested).
// Technical facts (runner notes, logs, audit trail) stay available in the collapsed "Technical details"; this only
// summarizes them. Passing tests are never presented as proof that the vulnerability is fixed.
import type { Fix } from "./schema";

export type Check = { tone: "ok" | "warn" | "bad"; text: string };

/** Short facts shown under a ready or completed patch. */
export function fixChecks(fix: Pick<Fix, "files" | "runner" | "agent" | "syntax_check">): Check[] {
  const out: Check[] = [];
  const n = fix.files.length;
  out.push({ tone: "ok", text: `${n} file${n === 1 ? "" : "s"} changed` });
  const t = fix.runner?.tests;
  if (t?.executed) {
    const s = t.summary;
    if (t.exit_code === 0) out.push({ tone: "ok", text: s && s.total > 0 ? `${s.passed} test${s.passed === 1 ? "" : "s"} passed` : "Tests passed" });
    else out.push({ tone: "bad", text: s ? `${s.failed} test${s.failed === 1 ? "" : "s"} failed` : "Tests failed" });
  } else if (fix.runner?.install && fix.runner.install.executed && fix.runner.install.exit_code !== 0) out.push({ tone: "bad", text: "Dependencies could not be installed" });
  else out.push({ tone: "warn", text: fix.agent === "muse-code" ? "No tests were found to run" : "Not tested yet" });
  if (fix.syntax_check?.some((c) => !c.ok)) out.push({ tone: "bad", text: "A changed file has a syntax error" });
  out.push({ tone: "warn", text: "Security fix not yet verified" });
  return out;
}

/** A user-actionable explanation for a failed attempt; the raw error stays in Technical details. */
export function friendlyError(err: string | null | undefined): string {
  const e = (err ?? "").toLowerCase();
  if (!e) return "We couldn't prepare the fix.";
  if (/no applicable hunks|no editable files|produced no/.test(e)) return "We couldn't generate a usable fix for this issue.";
  if (/model call failed|timeout|timed out|503|502|rate limit|429/.test(e)) return "The AI service didn't respond in time. Try again in a few minutes.";
  if (/tests? failed|validation/.test(e)) return "The proposed change didn't pass your repository's tests.";
  if (/install/.test(e)) return "Your project's dependencies couldn't be installed, so the change couldn't be checked.";
  if (/never reported|stale|stopped responding/.test(e)) return "The fix job stopped responding. Nothing was written to your repository.";
  if (/changed on .* since the analysis|base commit changed/.test(e)) return "Your code changed since this issue was found. Run the check again before fixing.";
  if (/write access|permission|403/.test(e)) return "SaveBell doesn't have permission to change this repository.";
  if (/outside|not allowed|forbidden path/.test(e)) return "The fix tried to change files it isn't allowed to change, so it was rejected.";
  return "We couldn't prepare the fix.";
}

export const DESTINATIONS = [
  { id: "preview", label: "No repository changes" },
  { id: "pr", label: "Create draft PR" },
  { id: "branch", label: "Push to new branch" },
] as const;

/** What a completion dialog shows. */
export type ResultInfo = { tone: "ok" | "bad" | "warn"; title: string; summary: string; points?: string[]; next?: string; link?: { href: string; label: string } };

export const DONE = ["pr_created", "branch_pushed", "merging", "merged", "blocked_by_protection", "failed", "validation_failed"];
/** Completion summary from the fix record the backend returned. Success wording only for statuses the server reports. */
export function fixSummary(fix: Fix, repo: string): ResultInfo | null {
  const files = `${fix.files.length} file${fix.files.length === 1 ? "" : "s"} changed`;
  const checks = fixChecks(fix).map((c) => c.text);
  const pr = fix.pr_url ? { href: fix.pr_url, label: "View pull request" } : fix.commit_url ? { href: fix.commit_url, label: "View on GitHub" } : undefined;
  switch (fix.status) {
    case "pr_created": return { tone: "ok", title: fix.pr_draft === false ? "Fix complete: pull request created" : "Fix complete: draft pull request created", summary: `SaveBell opened ${fix.pr_draft === false ? "a pull request (marked [DRAFT])" : "a draft pull request"} in ${repo}${fix.pr_number ? ` (#${fix.pr_number})` : ""} with the change you approved. Nothing was merged.`, points: checks, next: "Review it on GitHub and merge it when you are satisfied. The alert shows \"Fix merged\" after you merge.", link: pr };
    case "branch_pushed": return { tone: "ok", title: "Fix complete: branch pushed", summary: `SaveBell pushed the change you approved to ${fix.branch} in ${repo}. Your default branch is unchanged.`, points: [files, ...checks.slice(1)], next: "Open a pull request on GitHub when you are ready.", link: pr };
    case "merging": return { tone: "warn", title: "Pull request created, waiting for checks", summary: `The pull request in ${repo} is open. SaveBell merges it only if your repository's checks pass.`, points: checks, next: "You can cancel the automatic merge from this tab.", link: pr };
    case "merged": return { tone: "ok", title: "Fix merged", summary: `The change is merged into ${repo}.`, points: checks, next: "SaveBell checks the repository again with the new code.", link: pr };
    case "blocked_by_protection": return { tone: "warn", title: "Pull request open, not merged", summary: fix.error ?? "The merge was refused, so the pull request stays open for your review.", points: checks, next: "Review and merge it on GitHub yourself.", link: pr };
    case "failed": case "validation_failed": return { tone: "bad", title: "Fix failed", summary: friendlyError(fix.error), points: ["Nothing was merged.", ...(fix.branch && /pull request|PR/i.test(fix.error ?? "") ? [`If a branch ${fix.branch} exists, it was created by this attempt.`] : [])], next: "Start over, or use the AI Agent tab to fix it in your editor." };
    default: return null;
  }
}
