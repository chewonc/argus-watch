// The user's saved "Automatic remediation behavior" (Settings) and how it maps to what the server may write.
// Pure and unit-tested. The preference only chooses the destination; every write still needs the user's explicit
// approval of the exact validated patch (lib/remediation-control.ts checkApprovable). Nothing here escalates:
// a request for a stronger write than the saved preference is refused, never upgraded or downgraded silently.
export type RemediationMode = "preview" | "pr" | "branch";
export type WriteMode = "pr" | "push" | "branch";

export const REMEDIATION_MODES: { id: RemediationMode; title: string; desc: string }[] = [
  { id: "preview", title: "No repository writes", desc: "Muse Code generates and validates the patch in an isolated runner. You get the validated patch to apply yourself; Argus never writes to your repository." },
  { id: "pr", title: "Create draft pull request", desc: "After you approve the validated patch, Argus pushes a new branch and opens a draft pull request. Nothing is merged." },
  { id: "branch", title: "Push changes to a branch", desc: "After you approve the validated patch, Argus pushes it to a new branch (argus/fix-…) without opening a pull request. Your default branch is never written, and branch protection is respected." },
];

/** Short label for the modal's "After fixing:" line. */
export const AFTER_FIX: Record<RemediationMode, string> = { preview: "Show validated patch only (no repository writes)", pr: "Create draft PR", branch: "Push to a new branch" };

export const modeOf = (s: { remediation_mode?: string } | null | undefined): RemediationMode =>
  s?.remediation_mode === "preview" || s?.remediation_mode === "branch" ? s.remediation_mode : "pr";

/** Whether repository write access (and the per-repository "allow changes" switch) is needed for this preference. */
export const needsWrite = (m: RemediationMode) => m !== "preview";

/**
 * The write the server performs for an approval, given the saved preference and what the client asked for.
 * "push" (merge after CI) is a separate per-fix opt-in that only exists on top of the pull-request preference.
 */
export function writeModeFor(pref: RemediationMode, requested: unknown): { ok: true; mode: WriteMode } | { ok: false; error: string } {
  if (pref === "preview") return { ok: false, error: "Your remediation preference is \"No repository writes\", so nothing is written. Change it in Settings → Automatic remediation behavior to create a pull request or push a branch." };
  if (pref === "branch") return requested === "branch" ? { ok: true, mode: "branch" } : { ok: false, error: "Your saved preference is \"Push changes to a branch\"; reload and review the destination before approving." };
  if (requested === "pr" || requested === "push") return { ok: true, mode: requested };
  return { ok: false, error: "Your saved preference is \"Create draft pull request\"; reload and review the destination before approving." };
}
