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
  status: z.enum(["new", "not_relevant", "not_actionable", "analyzing", "assessed", "error"]),
  relevant_repos: z.array(z.string()),
  error: z.string().nullable().optional(),
});
export type Finding = z.infer<typeof Finding>;

// ---- Evidence and assessment --------------------------------------------
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
  model: z.string(),
  replayed: z.boolean().default(false),
});
export type Assessment = z.infer<typeof Assessment>;

// ---- Watched repo --------------------------------------------------------
export const WatchedRepo = z.object({
  repo: z.string(), // owner/name
  default_branch: z.string().default("main"),
  subdir: z.string().default(""), // optional path prefix (demo fixtures live in subfolders)
  label: z.string().optional(), // e.g. "production"
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
  kind: z.enum(["webhook", "poll", "process", "alert", "replay", "error", "heartbeat"]),
  source: z.string(),
  detail: z.string(),
  ref: z.string().nullable().optional(),
  ms: z.number().optional(),
});
export type LogEntry = z.infer<typeof LogEntry>;
