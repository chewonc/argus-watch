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
  if (/write access|permission|403/.test(e)) return "Argus doesn't have permission to change this repository.";
  if (/outside|not allowed|forbidden path/.test(e)) return "The fix tried to change files it isn't allowed to change, so it was rejected.";
  return "We couldn't prepare the fix.";
}

export const DESTINATIONS = [
  { id: "preview", label: "No repository changes" },
  { id: "pr", label: "Create draft PR" },
  { id: "branch", label: "Push to new branch" },
] as const;
