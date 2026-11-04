import { z } from "zod";

// ---- Sources and coverage classes ---------------------------------------
export const SourceClass = z.enum(["push", "polled", "on_demand", "not_accessible"]);
export type SourceClass = z.infer<typeof SourceClass>;

export const SourceId = z.enum(["ghsa", "ghadv", "kev", "rss", "nvd", "osv", "bsky", "manual"]);
export type SourceId = z.infer<typeof SourceId>;

// ---- Trust tier (what a finding may produce downstream) -----------------
export const Tier = z.enum(["official", "corroborated", "signal"]);
export type Tier = z.infer<typeof Tier>;

// ---- Raw ingested item (one per source occurrence) ----------------------
export const Item = z.object({
  id: z.string(), // sha256 of canonical key
  source: SourceId,
  sourceClass: SourceClass,
  url: z.string().url().nullable(),
  title: z.string(),
  author: z.string().nullable(),
  text: z.string(), // normalized body (advisory details / feed summary / fetched page excerpt)
  ids: z.array(z.string()), // CVE-/GHSA-/OSV ids found in the item
  packages: z.array(z.object({ ecosystem: z.string(), name: z.string() })),
  published_at: z.string().nullable(), // source's own timestamp (ISO), null when unknown
  discovered_at: z.string(), // when Argus Watch first saw it
  raw: z.unknown().optional(),
});
export type Item = z.infer<typeof Item>;

// ---- Condition (extracted once per finding version) ---------------------
export const Role = z.enum(["required", "mitigation"]);
export const MitigationKind = z.enum(["environment", "workaround", "not_applicable"]);
export const ConditionDef = z.object({
  id: z.string(),
  text: z.string(), // attack-enabling form: TRUE => system affected
  role: Role,
  mitigation_kind: MitigationKind,
  source_quote: z.string(),
});
export type ConditionDef = z.infer<typeof ConditionDef>;

export const Claim = z.object({
  actionable: z.boolean(),
  claim_type: z.enum([
    "dependency_vulnerability",
    "framework_misconfiguration",
    "ai_agent_tool_use",
    "prompt_injection",
    "supply_chain",
    "other",
  ]),
  summary: z.string(),
  plain_title: z.string().optional(), // <= 8 everyday words for non-experts; absent on claims extracted before Nov 2026
  packages: z.array(z.object({ ecosystem: z.string(), name: z.string(), affected_ranges: z.array(z.string()) })),
  tech_tags: z.array(z.string()), // e.g. "next.js", "express", "mcp", "openai-sdk"
  conditions: z.array(ConditionDef),
  not_actionable_reason: z.string().nullable(),
});
export type Claim = z.infer<typeof Claim>;

// ---- Finding = deduplicated, tiered threat ------------------------------
export const Finding = z.object({
  id: z.string(),
  ids: z.array(z.string()),
  title: z.string(),
  tier: Tier,
  items: z.array(z.string()), // Item ids (all sources that reported it)
  sources: z.array(SourceId),
  published_at: z.string().nullable(), // earliest known
  discovered_at: z.string(), // earliest discovery
  claim: Claim.nullable(), // null until extracted
  claim_version: z.string().nullable(), // hash of the text the claim was extracted from
  extracted_at: z.string().nullable().optional(), // when the claim was (last) extracted; latency stage L2
  publishers: z.array(z.string()).optional(), // distinct publishers (URL host, or source id) of the merged items; tierFor
  analyzing_at: z.string().nullable().optional(), // when status became "analyzing" (requeue_stuck)
  withdrawn_at: z.string().nullable().optional(), // a registry withdrew the advisory (GHSA/OSV withdrawn); alerts are retracted
  status: z.enum(["new", "not_relevant", "not_actionable", "analyzing", "assessed", "error"]),
  relevant_repos: z.array(z.string()),
  error: z.string().nullable().optional(),
  // Credibility of the REPORT (lib/verify.ts), independent of repository impact.
  credibility: z.object({
    label: z.enum(["verified", "corroborated", "unverified", "disputed", "likely_false"]),
    reason: z.string(),
    evidence: z.array(z.object({ kind: z.string(), text: z.string(), url: z.string().nullable() })),
    artefacts: z.array(z.object({ id: z.string(), kind: z.string(), status: z.string(), registry: z.string(), url: z.string(), title: z.string().nullable() })),
    publishers: z.array(z.string()),
    model: z.object({ used: z.boolean(), suggested: z.string().nullable(), searches: z.number(), queries: z.array(z.string()), discarded_urls: z.number(), tokens: z.number(), ms: z.number(), error: z.string().nullable(), name: z.string().nullable() }),
    checked_at: z.string(),
    version: z.string(),
  }).nullable().optional(),
});
export type Finding = z.infer<typeof Finding>;

// ---- Evidence and assessment --------------------------------------------
// ---- Severity (GHSA/CVSS when the source states it; otherwise estimated from verdict x tier) ----
export const Severity = z.object({
  level: z.enum(["critical", "high", "moderate", "low", "none", "unknown"]),
  cvss: z.number().nullable(),
  source: z.enum(["ghsa", "estimated"]),
});
export type Severity = z.infer<typeof Severity>;

export const EvidenceState = z.enum(["Observed", "Inferred", "Unknown", "Contradicted"]);
export type EvidenceState = z.infer<typeof EvidenceState>;

export const Evidence = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  quote: z.string().nullable(),
  sha: z.string().nullable(),
});

export const ConditionResult = ConditionDef.extend({
  state: EvidenceState,
  evidence: z.array(Evidence),
  reasoning: z.string(),
  computed: z.boolean().default(false), // true when decided by code (e.g. version in range)
});
export type ConditionResult = z.infer<typeof ConditionResult>;

export const Verdict = z.enum(["Affected", "Not Affected", "Unclear"]);
export type Verdict = z.infer<typeof Verdict>;

export const Location = z.object({
  file: z.string(),
  line: z.number().int(),
  quote: z.string(),
  why: z.string(),
});

export const Assessment = z.object({
  id: z.string(), // `${finding.id}:${repo}:${sha}:${claim_version}`
  finding_id: z.string(),
  repo: z.string(), // owner/name
  sha: z.string(),
  tier: Tier,
  dependency: z.object({ name: z.string(), version: z.string(), source_file: z.string() }).nullable(),
  locations: z.array(Location),
  conditions: z.array(ConditionResult),
  verdict: Verdict,
  verdict_reason: z.string(), // which rule fired, including the tier cap
  verdict_qualifier: z.string(),
  missing_evidence: z.array(z.string()),
  unverified: z.array(z.string()),
  recommendations: z.array(z.object({ text: z.string(), condition_ids: z.array(z.string()) })),
  timestamps: z.object({
    published_at: z.string().nullable(),
    discovered_at: z.string(),
    processed_at: z.string(),
    notified_at: z.string().nullable(),
  }),
  model: z.string(), // model id requested for the assessment call ("none" when no model ran)
  model_served: z.object({ model: z.string().nullable(), host: z.string() }).nullable().optional(), // what the API reported serving, and which host answered (newer records)
  replayed: z.boolean().default(false),
  withdrawn_at: z.string().nullable().optional(), // advisory withdrawn by its registry when this assessment was made
  severity: Severity.optional(), // computed in lib/severity.ts for new assessments; derived at render time for older ones
  investigation: z.object({ added: z.array(z.string()), steps: z.number(), tools: z.array(z.string()), rationale: z.string(), tokens: z.number(), ms: z.number(), model: z.string() }).nullable().optional(), // agentic file discovery (lib/investigate.ts)
  hosted: z.enum(["model", "deterministic", "capped"]).optional(), // how the hosted analysis ran (cost control); absent = model (older records)
  // Result reported by the user's own AI agent over MCP. Every cited line was re-read at `sha` and matched before it was stored;
  // the server verdict above is never overwritten.
  agent: z.object({
    status: z.enum(["confirmed", "not_affected", "fix_proposed"]),
    summary: z.string(),
    evidence: z.array(z.object({ file: z.string(), line: z.number().int(), quote: z.string() })),
    pr_url: z.string().nullable(),
    client: z.string().nullable(),
    at: z.string(),
  }).optional(),
});
export type Assessment = z.infer<typeof Assessment>;

// ---- Users, installations, per-user repos (identity layer; the pipeline stays global) ----
export const UserSettings = z.object({
  inapp: z.boolean().default(true),
  push: z.boolean().default(false),
  push_min_severity: z.enum(["low", "moderate", "high", "critical"]).optional(), // absent = "low" (all alerts); // browser push only for alerts at or above this severity
  webhook_url: z.string().nullable().default(null), // per-user Slack/Discord incoming webhook
  locale: z.string().default("en"),
  // Automatic remediation behavior (lib/remediation-mode.ts). Chooses the destination only; each write still needs approval of the exact patch.
  remediation_mode: z.enum(["preview", "pr", "branch"]).default("pr"),
  // Shared demo repositories (admin-registered, public code): shown unless hidden; their alerts are opt-in.
  hide_demo: z.boolean().default(false),
  demo_alerts: z.boolean().default(false),
});
export const User = z.object({
  id: z.string(), // "gh:<github numeric id>" or "system"
  login: z.string(),
  name: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  created_at: z.string(),
  settings: UserSettings.default(() => UserSettings.parse({})),
});
export type User = z.infer<typeof User>;

export const Installation = z.object({
  id: z.number(),
  account: z.string(),
  account_type: z.enum(["User", "Organization"]),
  user_ids: z.array(z.string()),
  created_at: z.string(),
  suspended: z.boolean().default(false),
});
export type Installation = z.infer<typeof Installation>;

export const UserRepo = z.object({
  user_id: z.string(),
  repo_key: z.string(), // store.repoKey(): owner/name[/subdir]
  installation_id: z.number().nullable().default(null),
  allow_pr: z.boolean().default(false), // explicit per-repo opt-in before any draft PR can be opened
  local_root: z.string().nullable().default(null), // absolute local checkout path for IDE deep links (client-provided)
  paused: z.boolean().default(false), // the user paused monitoring: no new assessments or notifications for them; history stays
  // GitHub no longer grants this user access (left the org, repo removed from the installation): hidden and not notified
  // until access returns (lib/access.ts). Not a deletion: findings and settings stay.
  access_lost: z.boolean().optional(),
  added_at: z.string(),
});
export type UserRepo = z.infer<typeof UserRepo>;

// ---- Notifications and push --------------------------------------------
export const Notification = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: z.enum(["alert", "verdict_changed", "severity_changed", "fix_pr_created", "fix_failed"]),
  credibility: z.enum(["verified", "corroborated", "unverified", "disputed", "likely_false"]).nullable().optional(), // report credibility when notified
  withdrawn: z.boolean().optional(),
  assessment_id: z.string(),
  finding_id: z.string(),
  repo: z.string(),
  title: z.string(),
  verdict: Verdict,
  severity: Severity,
  created_at: z.string(),
  updated_at: z.string(),
  read_at: z.string().nullable().default(null),
  // latency stages L4–L6
  published_at: z.string().nullable().default(null),
  notified_at: z.string(),
  pushed_at: z.string().nullable().default(null),
  received_at: z.string().nullable().default(null),
});
export type Notification = z.infer<typeof Notification>;

export const PushSubscription = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  ua: z.string().optional(),
  added_at: z.string(),
});
export type PushSubscription = z.infer<typeof PushSubscription>;

// ---- Fix (model-drafted patch; never verified by execution) --------------
export const FixHunk = z.object({ path: z.string(), search: z.string(), replace: z.string(), rationale: z.string(), addresses: z.enum(["root_cause", "symptom", "unrelated"]).default("unrelated"), condition_ids: z.array(z.string()).default([]) });
export type FixHunk = z.infer<typeof FixHunk>;
export const FixAssessment = z.object({
  label: z.enum(["supported", "partially_supported", "not_supported", "not_assessable"]),
  summary: z.string(),
  coverage: z.array(z.object({ condition_id: z.string(), text: z.string(), driving: z.boolean(), touched: z.boolean(), before: EvidenceState, after: EvidenceState.nullable(), after_evidence: z.string().nullable(), tag: z.enum(["COMPUTED", "CITATION-VERIFIED", "MODEL-ASSUMPTION", "UNCHANGED"]) })),
  predicted_verdict: Verdict.nullable(),
  predicted_reason: z.string().nullable(),
  version_check: z.object({ package: z.string(), new_version: z.string(), outside_ranges: z.boolean().nullable(), note: z.string() }).nullable(),
  risk_flags: z.array(z.string()),
  model_judgement: z.array(z.object({ path: z.string(), addresses: z.string(), reason: z.string() })),
  uncertain: z.array(z.string()),
  verification_required: z.array(z.string()),
});
export type FixAssessment = z.infer<typeof FixAssessment>;
export const Fix = z.object({
  id: z.string(),
  assessment_id: z.string(),
  user_id: z.string(),
  repo: z.string(), // owner/name
  repo_key: z.string(),
  base_sha: z.string(),
  status: z.enum(["drafting", "drafted", "approved", "pr_created", "failed",
    // automated remediation (Muse Code runner): queued → running → validated → pr_created → (push mode) merging → merged | blocked_by_protection
    "queued", "running", "validation_failed", "validated", "merging", "merged", "blocked_by_protection",
    // the user stopped a queued or running remediation; the runner's single-use credential is revoked
    "cancelled",
    // branch preference: the approved patch was pushed to a new branch without a pull request
    "branch_pushed"]),
  summary: z.string(),
  caveats: z.array(z.string()),
  files: z.array(z.object({ path: z.string(), before_sha: z.string(), patch: z.string(), after: z.string(), hunks: z.array(FixHunk) })),
  rejected_hunks: z.array(FixHunk.extend({ reason: z.string() })),
  syntax_check: z.array(z.object({ path: z.string(), ok: z.boolean(), label: z.string(), errors: z.array(z.string()) })),
  assessment: FixAssessment.nullable().default(null),
  verified: z.literal(false).default(false), // security remediation is never verified by execution here
  branch: z.string().nullable().default(null),
  pr_url: z.string().nullable().default(null),
  pr_number: z.number().nullable().default(null),
  pr_draft: z.boolean().nullable().default(null),
  check_runs: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable(), url: z.string().nullable() })).default([]),
  checks_at: z.string().nullable().default(null),
  model: z.string(),
  created_at: z.string(),
  approved_at: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  // ---- automated remediation (lib/runner.ts) ----
  mode: z.enum(["pr", "push", "branch", "preview"]).nullable().default(null), // what the user authorized (preview = no repository writes)
  // The user's approval of this exact patch for one destination (lib/write-auth.ts). Required at every repository write.
  grant: z.object({
    id: z.string(), user_id: z.string(), approved_by: z.string(), repo: z.string(), base_sha: z.string(), patch_version: z.string(), files: z.array(z.string()),
    action: z.enum(["pr", "branch", "pr_then_merge"]), branch: z.string(), base_branch: z.string(),
    issued_at: z.string(), expires_at: z.string(), merge_expires_at: z.string().nullable(), revoked_at: z.string().nullable(),
  }).nullable().default(null),
  agent: z.enum(["muse-spark", "muse-code"]).default("muse-spark"), // who produced fix.files
  allowed_files: z.array(z.string()).default([]), // the only paths the runner may change (enforced server-side on the result)
  nonce_hash: z.string().nullable().default(null), // single-use runner credential (sha256), cleared once consumed
  events: z.array(z.object({ at: z.string(), actor: z.string(), action: z.string(), detail: z.string(), url: z.string().nullable().default(null) })).default([]),
  runner: z.object({
    run_url: z.string().nullable().default(null),
    dispatched_at: z.string().nullable().default(null),
    started_at: z.string().nullable().default(null),
    finished_at: z.string().nullable().default(null),
    muse_version: z.string().nullable().default(null),
    steps: z.number().nullable().default(null),
    summary: z.string().default(""),
    changed_files: z.array(z.string()).default([]),
    rejected_files: z.array(z.string()).default([]),
    tests: z.object({ command: z.string().nullable(), executed: z.boolean(), exit_code: z.number().nullable(), log: z.string(), duration_ms: z.number().nullable(),
      summary: z.object({ framework: z.string(), total: z.number(), passed: z.number(), failed: z.number(), names: z.array(z.string()) }).nullable().optional() }).nullable().default(null),
    // dependency install in the runner (npm ci after a runner-regenerated lockfile); null when nothing was installed
    install: z.object({ command: z.string().nullable(), executed: z.boolean(), exit_code: z.number().nullable(), log: z.string() }).nullable().optional(),
    // lib/runner-gates.ts validationSummary(...).label, e.g. "Tests passed (1/1); security fix not verified"
    validation_label: z.string().nullable().optional(),
    error: z.string().nullable().default(null),
  }).nullable().default(null),
  merge_sha: z.string().nullable().default(null),
  commit_url: z.string().nullable().default(null),
  merge_attempts: z.number().default(0),
  // Version of the validated patch the user must approve (hash of paths + contents). Approval names this version;
  // a different patch requires a new review. null until the runner's patch was validated.
  patch_version: z.string().nullable().default(null),
});
export type Fix = z.infer<typeof Fix>;

// ---- Watched repo --------------------------------------------------------
export const WatchedRepo = z.object({
  repo: z.string(), // owner/name
  default_branch: z.string().default("main"),
  subdir: z.string().default(""), // optional path prefix (demo fixtures live in subfolders)
  label: z.string().optional(), // e.g. "production"
  installation_id: z.number().nullable().default(null), // GitHub App installation used to read (and, with allow_pr, write) this repo
  private: z.boolean().default(false),
  // Cached stack summary (refreshed when sha changes)
  sha: z.string().nullable().default(null),
  packages: z.array(z.object({ ecosystem: z.string(), name: z.string(), version: z.string(), source_file: z.string() })).default([]),
  tech_tags: z.array(z.string()).default([]),
  refreshed_at: z.string().nullable().default(null),
});
export type WatchedRepo = z.infer<typeof WatchedRepo>;

// ---- Delivery / run log --------------------------------------------------
export const LogEntry = z.object({
  at: z.string(),
  kind: z.enum(["webhook", "poll", "process", "alert", "replay", "error", "heartbeat", "auth", "fix", "notify"]),
  source: z.string(),
  detail: z.string(),
  ref: z.string().nullable().optional(),
  ms: z.number().optional(),
});
export type LogEntry = z.infer<typeof LogEntry>;
