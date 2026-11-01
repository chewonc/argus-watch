// English source strings for the UI. Other languages are produced by Google Cloud Translation at request time
// (lib/i18n/translate.ts) and cached; the English text is the key, so a changed string is re-translated automatically.
export const en = {
  nav_watch: "Watch", nav_repos: "Repos", nav_sources: "Sources", nav_alerts: "Alerts", nav_settings: "Settings", sign_in: "Sign in with GitHub", sign_out: "Sign out", sign_in_not_configured: "sign-in not configured",
  headline: "What touched your code.",
  tagline: "Advisories and research signals checked against your watched repositories, continuously, read-only. Absence of alerts is evidence from inspected files only, never proof of safety.",
  repositories: "Repositories", no_repos: "No repositories watched yet.", connect_link: "Connect GitHub and pick repositories →", needs_attention: "need attention", no_issues: "no issues found in inspected files", demo: "demo",
  needs_action: "needs action", critical: "critical", high: "high", moderate: "moderate", low: "low", new_unread: "new (unread)", resolved: "resolved / fix proposed", not_affected: "not affected",
  alerts: "Alerts", filter_needs_action: "needs action", filter_new: "new", filter_all: "all", filter_resolved: "resolved", filter_not_affected: "not affected",
  no_alerts: "No alerts yet. Alerts appear here automatically when a discovered finding matches a watched repository.", nothing_in_filter: "Nothing in this filter.",
  problem: "Problem", suggested_fix: "Suggested fix", where: "Where", what_if_approve: "What happens if you approve a fix", approve_explainer: "A draft pull request on a new branch; nothing is merged and the default branch is untouched. Changes are syntax-checked only, never executed.",
  no_fix: "No concrete fix produced; see missing evidence.", no_location: "exact location not available: no source line could be cited",
  view_code: "View code", preview_fix: "Preview fix", apply_fix: "Apply fix…", view_pr: "View draft PR", open_in: "Open in…", generate_prompt: "Generate fix prompt", technical_details: "Technical details",
  coverage: "Coverage", latency: "Latency (live, backlog excluded)", watched: "Watched", manage_repos: "Manage repositories →", live_log: "Live log",
  full_analysis: "Full analysis", proposed_fix: "Proposed fix", draft_fix: "Draft fix", drafting: "Drafting… (model call, ~30–90 s)", re_draft: "Re-draft", approve_open_pr: "Approve & open draft PR…",
  not_verified: "Security remediation: not verified", notifications: "Notifications", mark_all_read: "Mark all read", settings: "Settings", language: "Language",
  read_only_footer: "Read-only analysis. Argus Watch does not run, reproduce, or test any vulnerability. Evidence-supported impact prediction is not experimentally confirmed exploitability. Repository changes happen only as draft pull requests you explicitly approve.",
} as const;
export type Key = keyof typeof en;
export type Dict = Record<Key, string>;
