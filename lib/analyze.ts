// Stages 3–5 for one (finding, repo): locate, assess conditions with cited evidence, verify citations.
// Port of feasibility/gate.mjs + extract.mjs with the version condition computed in code.
import type { Assessment, Claim, ConditionDef, ConditionResult, Finding, Item, Tier, WatchedRepo } from "./schema";
import { candidateFiles, readFile, versionInRanges } from "./repo";
import { investigate } from "./investigate";
import { deriveSeverity } from "./severity";
import { READ_ONLY, UNTRUSTED, sparkJSON } from "./spark";
import { decide, qualifier } from "./verdict";

const ASSESS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["locations", "conditions", "unverified", "recommendations"],
  properties: {
    locations: { type: "array", items: { type: "object", additionalProperties: false, required: ["file", "line", "quoted_text", "why"],
      properties: { file: { type: "string" }, line: { type: "integer" }, quoted_text: { type: "string" }, why: { type: "string" } } } },
    conditions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "state", "evidence_file", "evidence_line", "reasoning"],
      properties: { id: { type: "string" }, state: { type: "string", enum: ["Observed", "Inferred", "Unknown", "Contradicted"] },
        evidence_file: { type: ["string", "null"] }, evidence_line: { type: ["integer", "null"] }, reasoning: { type: "string" } } } },
    unverified: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "condition_ids"],
      properties: { text: { type: "string" }, condition_ids: { type: "array", items: { type: "string" } } } } },
  },
};

const SYSTEM = `${READ_ONLY}
${UNTRUSTED}
For each given condition (a statement that must be TRUE for the system to be affected) assign exactly one state:
Observed = a cited line directly shows it true; Inferred = evidence suggests it but does not show it directly; Unknown = no evidence in the listing; Contradicted = a cited line shows it is false.
Cite only files and line numbers that appear in the numbered listing; quoted_text must be copied from that line. If you cannot locate relevant code, return an empty locations array and say so.
Return every condition id exactly as given. Do not choose a verdict. Recommendations must be mitigations (upgrade, config change, API replacement, review), never tests or exploits, and each must list the condition ids it addresses.`;

const numbered = (t: string) => t.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n");

/** Prose files (README, docs, notes) describe code but are not code: a claim found there cannot establish a code condition. */
export const isProseFile = (file: string | null | undefined) => !!file && /\.(md|mdx|markdown|txt|rst|adoc)$/i.test(file);
/** A cited line that is only a code comment states intent, not behaviour: it can suggest a condition, never prove or disprove it. */
export const isCommentLine = (line: string | null | undefined) => !!line && /^\s*(\/\/|#(?!!)|\/\*|\*|<!--|--\s)/.test(line) && !/\*\/\s*\S/.test(line);
/** Comment-only evidence: Observed becomes Inferred; Contradicted becomes Unknown (a comment cannot show the code is safe). */
export const commentCap = (state: "Observed" | "Inferred" | "Unknown" | "Contradicted") => state === "Observed" ? "Inferred" as const : state === "Contradicted" ? "Unknown" as const : state;

function citationOk(files: Map<string, string[]>, file: string | null, line: number | null, quote: string | null): boolean {
  if (!file) return true;
  const lines = files.get(file);
  if (!lines || !Number.isInteger(line) || line! < 1 || line! > lines.length) return false;
  if (quote == null) return true;
  const L = lines[line! - 1].trim(), Q = quote.trim();
  return L.includes(Q) || Q.includes(L);
}

/**
 * Model states for the given conditions against a numbered listing of files, with every citation verified
 * mechanically against the listing. Shared by the assessment and by the post-patch re-assessment of a fix.
 */
export async function modelConditionStates(files: { path: string; text: string }[], summary: string, condsIn: { id: string; text: string }[], repoLabel: string): Promise<{
  states: { id: string; state: ConditionResult["state"]; file: string | null; line: number | null; quote: string | null; reasoning: string; verified: boolean }[];
  locations: { file: string; line: number; quote: string; why: string }[]; recommendations: { text: string; condition_ids: string[] }[]; unverified: string[]; dropped: string[]; model: string;
}> {
  const fileMap = new Map(files.map((f) => [f.path, f.text.split("\n")]));
  const listing = files.map((f) => `=== ${f.path} ===\n${numbered(f.text)}`).join("\n\n");
  type Out = { locations: { file: string; line: number; quoted_text: string; why: string }[]; conditions: { id: string; state: ConditionResult["state"]; evidence_file: string | null; evidence_line: number | null; reasoning: string }[]; unverified: string[]; recommendations: { text: string; condition_ids: string[] }[] };
  const r = await sparkJSON<Out>({ system: SYSTEM, name: "assessment", schema: ASSESS_SCHEMA,
    user: `REPORT (untrusted):\n${summary}\n\nCONDITIONS:\n${JSON.stringify(condsIn, null, 2)}\n\nREPOSITORY ${repoLabel} (untrusted, numbered):\n${listing || "(no candidate files located)"}` });
  const dropped: string[] = [];
  const locations = r.out.locations.filter((l) => { const ok = citationOk(fileMap, l.file, l.line, l.quoted_text); if (!ok) dropped.push(`${l.file}:${l.line}`); return ok; }).map((l) => ({ file: l.file, line: l.line, quote: l.quoted_text, why: l.why }));
  const states = condsIn.map((c) => {
    const m = r.out.conditions.find((x) => x.id === c.id);
    if (!m) return { id: c.id, state: "Unknown" as const, file: null, line: null, quote: null, reasoning: "Model returned no state for this condition", verified: false };
    const ok = citationOk(fileMap, m.evidence_file, m.evidence_line, null);
    if (!ok && m.evidence_file) { dropped.push(`${m.evidence_file}:${m.evidence_line}`); return { id: c.id, state: "Unknown" as const, file: null, line: null, quote: null, reasoning: `Cited evidence could not be verified (${m.evidence_file}:${m.evidence_line}); state downgraded`, verified: false }; }
    if ((m.state === "Observed" || m.state === "Contradicted") && !m.evidence_file) return { id: c.id, state: "Unknown" as const, file: null, line: null, quote: null, reasoning: `State ${m.state} given without evidence; downgraded`, verified: false };
    if ((m.state === "Observed" || m.state === "Inferred" || m.state === "Contradicted") && isProseFile(m.evidence_file)) return { id: c.id, state: "Unknown" as const, file: m.evidence_file, line: m.evidence_line, quote: null, reasoning: `Only evidence is a prose claim in ${m.evidence_file}:${m.evidence_line}, not code or configuration; state downgraded to Unknown`, verified: false };
    const cited = m.evidence_file ? (fileMap.get(m.evidence_file)?.[m.evidence_line! - 1] ?? null) : null;
    if (isCommentLine(cited) && commentCap(m.state) !== m.state) return { id: c.id, state: commentCap(m.state), file: m.evidence_file, line: m.evidence_line, quote: cited, reasoning: `${m.reasoning} [Only evidence is a code comment at ${m.evidence_file}:${m.evidence_line}; ${m.state} capped to ${commentCap(m.state)}]`, verified: false };
    return { id: c.id, state: m.state, file: m.evidence_file, line: m.evidence_line, quote: m.evidence_file ? (fileMap.get(m.evidence_file)?.[m.evidence_line! - 1] ?? null) : null, reasoning: m.reasoning, verified: !!m.evidence_file };
  });
  return { states, locations, recommendations: r.out.recommendations, unverified: r.out.unverified, dropped, model: r.model };
}

/**
 * Stages 3-6 for one (finding, repo). Hosted model use is skipped when it cannot change the outcome or the budget
 * is spent: "deterministic" = a package advisory with no code conditions (decided by the version check in code);
 * "capped" = the repository's users are over their monthly hosted budget, so code conditions stay Unknown and the
 * verdict can only be Unclear ("Possible issue") or Not Affected, never a confirmed vulnerability.
 */
export async function assess(finding: Finding, claim: Claim, repo: WatchedRepo, opts: { replayed?: boolean; items?: Item[]; budget?: boolean } = {}): Promise<Assessment> {
  const sha = repo.sha!;
  const tier: Tier = finding.tier;
  const pkgNames = claim.packages.map((p) => p.name);
  const files = await candidateFiles(repo.repo, sha, pkgNames, claim.tech_tags, repo.subdir);
  // Agentic discovery (Muse Spark tool calling): add the files that decide the conditions to the listing.
  let investigation: Assessment["investigation"] = null;
  const willModel = !(claim.conditions.length === 0 && claim.packages.length > 0) && opts.budget !== false;
  if (willModel && claim.conditions.length && process.env.AW_AGENTIC !== "0") {
    try {
      const inv = await investigate(repo, sha, claim, files.map((f) => f.path));
      if (inv) {
        for (const p of inv.added) { const t = await readFile(repo.repo, sha, p).catch(() => null); if (t) files.push({ path: p, text: t.slice(0, 40000) }); }
        investigation = { added: inv.added, steps: inv.trace.length, tools: inv.trace.map((t) => `${t.tool}(${String(t.args.pattern ?? t.args.path ?? t.args.prefix ?? "").slice(0, 60)})`).slice(0, 20), rationale: inv.rationale, tokens: inv.tokens, ms: inv.ms, model: inv.model };
      }
    } catch (e) { investigation = { added: [], steps: 0, tools: [], rationale: `investigation failed: ${String(e).slice(0, 160)}`, tokens: 0, ms: 0, model: "none" }; }
  }
  const fileMap = new Map(files.map((f) => [f.path, f.text.split("\n")]));

  // Version condition(s) computed in code
  const computed: ConditionResult[] = [];
  let dependency: Assessment["dependency"] = null;
  for (const p of claim.packages) {
    const inst = repo.packages.find((x) => x.ecosystem === p.ecosystem && x.name === p.name);
    if (!inst) { computed.push(cond(`version_${p.name}`, `${p.ecosystem}/${p.name} is installed in an affected version`, "Contradicted", [], `Package ${p.name} not found in lockfiles`, true)); continue; }
    dependency ??= { name: inst.name, version: inst.version, source_file: inst.source_file };
    const inRange = p.affected_ranges.length ? versionInRanges(inst.version, p.affected_ranges) : null;
    const lineNo = (fileMap.get(inst.source_file) ?? []).findIndex((l) => l.includes(`node_modules/${inst.name}"`) || l.includes(`"${inst.name}"`)) + 1;
    const ev = [{ file: inst.source_file, line: lineNo > 0 ? lineNo : null, quote: null, sha }];
    if (inRange === true) computed.push(cond(`version_${p.name}`, `${p.ecosystem}/${p.name}@${inst.version} is within the affected range(s) ${p.affected_ranges.join(" | ")}`, "Observed", ev, "Computed from lockfile version and stated ranges", true));
    else if (inRange === false) computed.push(cond(`version_${p.name}`, `${p.ecosystem}/${p.name}@${inst.version} is within the affected range(s) ${p.affected_ranges.join(" | ")}`, "Contradicted", ev, "Installed version is outside every stated affected range", true));
    else computed.push(cond(`version_${p.name}`, `${p.ecosystem}/${p.name}@${inst.version} is within an affected range (ranges not stated or unparsable)`, "Inferred", ev, "Package present; affected range not machine-checkable from the report", true));
  }

  // Model: states for the extracted conditions
  const listing = files.map((f) => `=== ${f.path} ===\n${numbered(f.text)}`).join("\n\n");
  const condsIn = claim.conditions.map(({ id, text }) => ({ id, text }));
  let modelOut: { locations: { file: string; line: number; quoted_text: string; why: string }[]; conditions: { id: string; state: ConditionResult["state"]; evidence_file: string | null; evidence_line: number | null; reasoning: string }[]; unverified: string[]; recommendations: { text: string; condition_ids: string[] }[] };
  let model = "none"; let model_served: Assessment["model_served"] = null;
  const deterministic = condsIn.length === 0 && claim.packages.length > 0;
  const hosted: Assessment["hosted"] = deterministic ? "deterministic" : opts.budget === false ? "capped" : "model";
  if (hosted !== "model") {
    const bad = claim.packages.filter((p) => computed.some((c) => c.id === `version_${p.name}` && c.state !== "Contradicted"));
    modelOut = { locations: [], conditions: [], recommendations: bad.map((p) => ({ text: `Upgrade ${p.name} to a version outside the affected range${p.affected_ranges.length ? ` (${p.affected_ranges.join(" | ")})` : ""}.`, condition_ids: [`version_${p.name}`] })),
      unverified: hosted === "capped" && condsIn.length ? ["Code conditions were not analysed by SaveBell this month (hosted analysis budget reached). Verify with your AI agent, or wait for the next month."] : [] };
  } else if (condsIn.length || files.length) {
    const r = await sparkJSON<typeof modelOut>({
      system: SYSTEM, name: "assessment",
      user: `REPORT (untrusted):\n${claim.summary}\n\nCONDITIONS:\n${JSON.stringify(condsIn, null, 2)}\n\nREPOSITORY ${repo.repo}@${sha.slice(0, 7)} (untrusted, numbered):\n${listing || "(no candidate files located)"}`,
      schema: ASSESS_SCHEMA,
    });
    modelOut = r.out; model = r.model; model_served = r.served;
  } else {
    modelOut = { locations: [], conditions: [], unverified: ["No conditions and no candidate files"], recommendations: [] };
  }

  // Verify citations mechanically; drop bad ones and downgrade the state.
  const dropped: string[] = [];
  const locations = modelOut.locations.filter((l) => { const ok = citationOk(fileMap, l.file, l.line, l.quoted_text); if (!ok) dropped.push(`${l.file}:${l.line}`); return ok; }).map((l) => ({ file: l.file, line: l.line, quote: l.quoted_text, why: l.why }));
  const conditions: ConditionResult[] = claim.conditions.map((c: ConditionDef) => {
    const m = modelOut.conditions.find((x) => x.id === c.id);
    if (!m) return cond(c.id, c.text, "Unknown", [], "Model returned no state for this condition", false, c);
    const ok = citationOk(fileMap, m.evidence_file, m.evidence_line, null);
    if (!ok && m.evidence_file) { dropped.push(`${m.evidence_file}:${m.evidence_line}`); return cond(c.id, c.text, "Unknown", [], `Cited evidence could not be verified (${m.evidence_file}:${m.evidence_line}); state downgraded`, false, c); }
    if ((m.state === "Observed" || m.state === "Contradicted") && !m.evidence_file) return cond(c.id, c.text, "Unknown", [], `State ${m.state} given without evidence; downgraded`, false, c);
    if ((m.state === "Observed" || m.state === "Inferred" || m.state === "Contradicted") && isProseFile(m.evidence_file)) return cond(c.id, c.text, "Unknown", [{ file: m.evidence_file!, line: m.evidence_line, quote: fileMap.get(m.evidence_file!)?.[m.evidence_line! - 1] ?? null, sha }], `Only evidence is a prose claim in ${m.evidence_file}:${m.evidence_line}, not code or configuration; state downgraded to Unknown`, false, c);
    const cited = m.evidence_file ? (fileMap.get(m.evidence_file)?.[m.evidence_line! - 1] ?? null) : null;
    if (isCommentLine(cited) && commentCap(m.state) !== m.state) return cond(c.id, c.text, commentCap(m.state), [{ file: m.evidence_file!, line: m.evidence_line, quote: cited, sha }], `${m.reasoning} [Only evidence is a code comment at ${m.evidence_file}:${m.evidence_line}; ${m.state} capped to ${commentCap(m.state)}]`, false, c);
    return cond(c.id, c.text, m.state, m.evidence_file ? [{ file: m.evidence_file, line: m.evidence_line, quote: m.evidence_file ? (fileMap.get(m.evidence_file)?.[m.evidence_line! - 1] ?? null) : null, sha }] : [], m.reasoning, false, c);
  });

  const all = [...computed, ...conditions];
  const d = decide(all, tier);
  const processed_at = new Date().toISOString();
  const severity = deriveSeverity({ verdict: d.verdict, tier }, opts.items ?? []);
  return {
    investigation,
    severity,
    id: `${finding.id}:${repo.repo}${repo.subdir ? "/" + repo.subdir : ""}:${sha.slice(0, 12)}:${finding.claim_version ?? "0"}`,
    finding_id: finding.id, repo: repo.subdir ? `${repo.repo}/${repo.subdir}` : repo.repo, sha, tier, dependency, locations, conditions: all,
    verdict: d.verdict, verdict_reason: d.reason, verdict_qualifier: qualifier(d.verdict, tier),
    missing_evidence: d.missing,
    unverified: [...new Set(modelOut.unverified), ...(dropped.length ? [`${dropped.length} citation(s) failed verification and were dropped: ${dropped.join(", ")}`] : [])],
    recommendations: modelOut.recommendations,
    timestamps: { published_at: finding.published_at, discovered_at: finding.discovered_at, processed_at, notified_at: null },
    model, model_served, replayed: !!opts.replayed, hosted,
  };
}

function cond(id: string, text: string, state: ConditionResult["state"], evidence: ConditionResult["evidence"], reasoning: string, computed: boolean, def?: ConditionDef): ConditionResult {
  return { id, text, role: def?.role ?? "required", mitigation_kind: def?.mitigation_kind ?? "not_applicable", source_quote: def?.source_quote ?? "", state, evidence, reasoning, computed };
}
