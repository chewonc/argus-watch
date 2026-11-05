// The user's saved "Automatic remediation behavior" (Settings) and how it maps to what the server may write.
// Pure and unit-tested. The preference only chooses the destination; every write still needs the user's explicit
// approval of the exact validated patch (lib/remediation-control.ts checkApprovable). Nothing here escalates:
// a request for a stronger write than the saved preference is refused, never upgraded or downgraded silently.
export type RemediationMode = "preview" | "pr" | "branch";
export type WriteMode = "pr" | "push" | "branch";

export const REMEDIATION_MODES: { id: RemediationMode; title: string; short: string; desc: string }[] = [
  { id: "preview", title: "No repository writes", short: "Generate a patch without changing your repository.", desc: "Muse Code generates and validates the patch in an isolated runner. You get the validated patch to apply yourself; SaveBell never writes to your repository." },
  { id: "pr", title: "Create draft PR", short: "Create a draft PR after approval.", desc: "After you approve the validated patch, SaveBell pushes a new branch and opens a draft pull request. Nothing is merged." },
  { id: "branch", title: "Push to branch", short: "Push changes to a new branch after approval.", desc: "After you approve the validated patch, SaveBell pushes it to a new branch without opening a pull request. Your default branch is never written, and branch protection is respected." },
];

/** Short label for the modal's "After fixing:" line. */
export const AFTER_FIX: Record<RemediationMode, string> = { preview: "Show validated patch only (no repository writes)", pr: "Create draft PR", branch: "Push to a new branch" };

export const modeOf = (s: { remediation_mode?: string } | null | undefined): RemediationMode =>
  s?.remediation_mode === "preview" || s?.remediation_mode === "branch" ? s.remediation_mode : "pr";

/** Whether repository write access (and the per-repository "allow changes" switch) is needed for this preference. */
export const needsWrite = (m: RemediationMode) => m !== "preview";

/** Parse the destination chosen for one attempt (the modal's "After fixing" dropdown); the saved preference is only its default. */
export const destinationOf = (requested: unknown, fallback: RemediationMode): RemediationMode =>
  requested === "preview" || requested === "pr" || requested === "branch" ? requested : fallback;

/**
 * The write the server performs when the user clicks the approval button for one attempt. The click is the authorization
 * for exactly that destination (the grant binds it to the patch, repository and commit). "No repository changes" never
 * writes. Merging is not part of any approval here: a PR approval is never a merge approval.
 */
export function writeModeFor(requested: unknown): { ok: true; mode: WriteMode } | { ok: false; error: string } {
  if (requested === "pr" || requested === "branch") return { ok: true, mode: requested };
  if (requested === "push") return { ok: false, error: "Automatic merging needs its own separate authorization; approve the pull request first." };
  return { ok: false, error: "\"No repository changes\" was selected, so nothing is written to your repository." };
}
