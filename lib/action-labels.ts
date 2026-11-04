// Dictionary → FindingActions labels (one place, so the list and the finding page say the same words).
import type { ActionLabels } from "@/components/finding-actions";
export const actionLabels = (d: Record<string, string>): ActionLabels => ({
  fix_now: d.act_fix_now, retry: d.act_retry, approve: d.act_approve, verify: d.act_verify, review_fix: d.act_review_fix, view_pr: d.act_view_pr, view_fix: d.act_view_fix, view_progress: d.act_view_progress, details: d.act_details,
  st_awaiting: d.rst_awaiting, st_preparing: d.rst_preparing, st_in_progress: d.rst_in_progress, st_patch_ready: d.rst_patch_ready, st_creating_pr: d.rst_creating_pr, st_cancelled: d.rst_cancelled, st_checks: d.rst_checks, st_pr: d.rst_pr, st_blocked: d.rst_blocked, st_failed: d.rst_failed, st_stalled: d.rst_stalled, st_merged: d.rst_merged, st_pushed: d.rst_pushed,
});
