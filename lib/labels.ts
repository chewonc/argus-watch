// Plain-language presentation of an assessment: one status, one title, one location line.
// Presentation only: verdicts, tiers, severities and evidence are unchanged. Verification decides first, so a
// finding that is not established for this repository is never shown with a severity word.
import type { Assessment, Finding, Severity } from "./schema";

export type StatusKind = "serious" | "important" | "moderate" | "minor" | "affects" | "possible" | "not_affected" | "fix_ready" | "resolved";
export type Status = { kind: StatusKind; label: string; glyph: string; tone: string };

const S: Record<StatusKind, Omit<Status, "kind">> = {
  serious: { label: "Serious", glyph: "◆", tone: "sev-critical" },
  important: { label: "Important", glyph: "▲", tone: "sev-high" },
  moderate: { label: "Moderate", glyph: "●", tone: "sev-moderate" },
  minor: { label: "Minor", glyph: "○", tone: "sev-low" },
  affects: { label: "Affects you", glyph: "●", tone: "sev-moderate" },
  possible: { label: "Possible issue", glyph: "◌", tone: "possible" },
  not_affected: { label: "You're not affected", glyph: "✓", tone: "ok" },
  fix_ready: { label: "Fix ready to review", glyph: "✓", tone: "muted" },
  resolved: { label: "Resolved", glyph: "✓", tone: "muted" },
};
const mk = (kind: StatusKind): Status => ({ kind, ...S[kind] });
/** Status with its label taken from a translated UI dictionary (keys st_<kind>). */
export const localized = <T extends { kind: StatusKind; label: string }>(st: T, d: Record<string, string>): T => ({ ...st, label: d[`st_${st.kind}`] ?? st.label });

/** Verified = the deterministic verdict rule (lib/verdict.ts) returned Affected for this repository. */
export const isVerified = (a: Pick<Assessment, "verdict"> & { agent?: Assessment["agent"] }) => a.verdict === "Affected" || (a.verdict !== "Not Affected" && a.agent?.status === "confirmed" && a.agent.evidence.length > 0);

export function statusOf(a: Pick<Assessment, "verdict"> & { agent?: Assessment["agent"] }, sev: Severity, state: { resolved: boolean; prOpen: boolean }): Status {
  if (state.prOpen || a.agent?.status === "fix_proposed") return mk("fix_ready");
  if (state.resolved) return mk("resolved");
  if (a.verdict === "Not Affected") return mk("not_affected");
  // An agent "not affected" moves the alert to Resolved with its own label; it never hides it.
  if (a.agent?.status === "not_affected") return { ...mk("resolved"), label: "Not affected (checked by your AI agent)" };
  if (!isVerified(a)) return mk("possible");
  return mk(sev.level === "critical" ? "serious" : sev.level === "high" ? "important" : sev.level === "moderate" ? "moderate" : sev.level === "low" ? "minor" : "affects");
}

const TECH: Record<string, string> = {
  "github-actions": "GitHub Actions", "next.js": "Next.js", next: "Next.js", jsonwebtoken: "jsonwebtoken (login tokens)", nextjs: "Next.js", react: "React", "react-server-components": "React Server Components", express: "Express",
  docker: "Docker", kubernetes: "Kubernetes", helm: "Helm", jwt: "login tokens (JWT)", mcp: "AI tool connections (MCP)", "openai-sdk": "the OpenAI SDK", "openai-agents-sdk": "the OpenAI Agents SDK",
  "anthropic-sdk": "the Anthropic SDK", langchain: "LangChain", "ai-agent": "your AI agent code", vercel: "Vercel", node: "Node.js", "node.js": "Node.js", python: "Python", npm: "npm packages",
};
export const techName = (t: string) => TECH[t.toLowerCase()] ?? t.replace(/(^|[-_ ])(\w)/g, (_m, s, c) => `${s ? " " : ""}${c.toUpperCase()}`);

const base = (file: string) => file.split("/").pop() ?? file;
const area = (file: string) =>
  /\.github\/workflows\//.test(file) ? "your CI workflow" : /auth|login|session|token/i.test(file) ? "your login code" : /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod)$/.test(file) ? "your dependencies" : /docker|compose/i.test(file) ? "your container setup" : /config|\.env|settings/i.test(file) ? "a configuration file" : base(file);

/** The technology this finding is about that this repository actually uses (from tags and packages). */
export function matchedTech(f: Finding | null, repoTags: string[] = [], repoPkgs: string[] = []): string | null {
  const c = f?.claim; if (!c) return null;
  const pkg = c.packages.find((p) => repoPkgs.includes(p.name));
  if (pkg) return techName(pkg.name);
  const tag = c.tech_tags.find((t) => repoTags.includes(t)) ?? c.tech_tags[0];
  return tag ? techName(tag) : c.packages[0]?.name ?? null;
}

/**
 * Card / page title. Never an article title. Verified findings name the problem and the affected area from
 * cited evidence; unverified ones only say which technology the news concerns.
 */
export function plainTitle(a: Assessment, f: Finding | null, loc: { file: string } | null, repoTags: string[] = [], repoPkgs: string[] = []): string {
  const tech = matchedTech(f, repoTags, repoPkgs);
  if (!isVerified(a)) return `Possible security issue with ${tech ?? "a tool you use"}`;
  const pt = f?.claim?.plain_title?.trim();
  if (pt) return pt;
  const where = loc ? area(loc.file) : null;
  switch (f?.claim?.claim_type) {
    case "dependency_vulnerability": return a.dependency ? `A package you use has a security flaw: ${techName(a.dependency.name)}` : `A package you use has a security flaw${tech ? `: ${tech}` : ""}`;
    case "framework_misconfiguration": return `Unsafe setting in ${where ?? tech ?? "your project"}`;
    case "ai_agent_tool_use": case "prompt_injection": return `Your AI tool code could be misused${where && where !== "your AI agent code" ? ` (${where})` : ""}`;
    case "supply_chain": return `Untrusted code could reach ${where ?? "your project"}`;
    default: return `${where ? `${where[0].toUpperCase()}${where.slice(1)} needs` : "Your project needs"} a security fix`;
  }
}

/** Second card line: the verified location, or an honest statement that nothing was confirmed. */
export function whereLine(a: Assessment, loc: { file: string; from: number; to: number } | null): { kind: "file" | "package" | "unverified" | "none"; text: string } {
  if (!isVerified(a)) return { kind: "unverified", text: "Not yet confirmed in your project." };
  if (loc) return { kind: "file", text: `${loc.file}:${loc.from}` };
  if (a.dependency) return { kind: "package", text: `${a.dependency.source_file} · ${a.dependency.name}@${a.dependency.version}` };
  return { kind: "none", text: "Affected file not found" };
}

/** Best timestamp for "newest first": discovery, then processing, then publication. */
export const discoveredAt = (a: Assessment) => a.timestamps.discovered_at || a.timestamps.processed_at || a.timestamps.published_at || "";

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

/** Repository monitoring status in everyday words. */
export function repoStatus(r: { refreshed_at: string | null; sha: string | null } | null, opts: { connected: boolean; now?: number }): { label: string; glyph: string; tone: "ok" | "warn" | "bad" } {
  if (!r || !opts.connected) return { label: "Connection problem", glyph: "⚠", tone: "bad" };
  if (!r.sha || !r.refreshed_at) return { label: "Setting up", glyph: "◌", tone: "warn" };
  const age = (opts.now ?? Date.now()) - Date.parse(r.refreshed_at);
  return age > 7 * 864e5 ? { label: "Monitoring paused", glyph: "⏸", tone: "warn" } : { label: "Monitoring active", glyph: "●", tone: "ok" };
}

/** The most-cited non-lockfile location of an assessment (file + line span), or null when nothing was cited. */
export function location(a: Pick<Assessment, "locations" | "conditions"> & { agent?: Assessment["agent"] }): { file: string; from: number; to: number } | null {
  const ls = [...a.locations, ...(a.agent?.status === "confirmed" ? a.agent.evidence : []), ...a.conditions.flatMap((c) => c.evidence.filter((e) => e.line).map((e) => ({ file: e.file, line: e.line! })))].filter((l) => !/package-lock|pnpm-lock|yarn\.lock/.test(l.file));
  if (!ls.length) return null;
  const byFile = new Map<string, number[]>();
  for (const l of ls) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l.line]);
  const [file, lines] = [...byFile.entries()].sort((x, y) => y[1].length - x[1].length)[0];
  return { file, from: Math.min(...lines), to: Math.max(...lines) };
}

export const caseHref = (aid: string) => `/case/${aid.split("/").map(encodeURIComponent).join("/")}`;

/** Display name for the hosted model id stored on an assessment ("muse-spark-1.3" -> "Meta Muse Spark 1.3"). */
export function modelName(id: string): string {
  const m = /^muse-([a-z]+)-([\d.]+)$/.exec(id);
  return m ? `Meta Muse ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}` : id === "none" ? "No model" : id;
}
