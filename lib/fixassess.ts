// Static remediation assessment: does the proposed patch plausibly address the conditions that made the
// repository Affected/Unclear? Every conclusion is tagged by how it was reached:
//   COMPUTED            version re-check in code (strongest)
//   CITATION-VERIFIED   model re-assessed the patched text and its citation was verified mechanically
//   MODEL-ASSUMPTION    model statement without a verifiable citation (downgraded)
//   UNCHANGED           the patch does not touch anything the condition cites
// The result is never "verified": nothing is executed. The overall label is decided in code.
import semver from "semver";
import { modelConditionStates } from "./analyze";
import { versionInRanges } from "./repo";
import type { Assessment, ConditionResult, Finding, Fix, FixAssessment } from "./schema";
import { decide } from "./verdict";

const RISK_REMOVED = /\b(verify|validate|sanitize|sanitise|csrf|xsrf|authoriz|authent|permission|isAdmin|requireAuth|check)\b/i;
const RISK_ADDED = /\beval\s*\(|new Function\s*\(|child_process|\bexec(Sync)?\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=|shell\s*=\s*True|subprocess\.(call|run|Popen)\s*\([^)]*shell\s*=\s*True/i;

function lineOf(before: string, search: string): number | null { const i = before.indexOf(search); return i < 0 ? null : before.slice(0, i).split("\n").length; }

export async function assessFix(a: Assessment, f: Finding | null, fix: Fix, before: Map<string, string>): Promise<FixAssessment> {
  const driving = (c: ConditionResult) => (c.role === "required" && (c.state === "Observed" || c.state === "Inferred")) || (c.role === "mitigation" && c.state === "Unknown");
  // 1. Which conditions does the patch touch? (hunk line range vs evidence line ±3, in the before text)
  const touched = new Set<string>();
  for (const file of fix.files) for (const h of file.hunks) {
    const start = lineOf(before.get(file.path) ?? "", h.search); if (start == null) continue;
    const end = start + h.search.split("\n").length - 1;
    for (const c of a.conditions) for (const e of c.evidence) if (e.file === file.path && e.line && e.line >= start - 3 && e.line <= end + 3) touched.add(c.id);
    for (const id of h.condition_ids) if (a.conditions.some((c) => c.id === id)) touched.add(id);
  }
  // 2. Version re-check (computed) when a manifest changed
  let version_check: FixAssessment["version_check"] = null;
  const claimPkgs = f?.claim?.packages ?? [];
  for (const file of fix.files) {
    const base = file.path.split("/").pop();
    if (base !== "package.json" && base !== "requirements.txt") continue;
    for (const p of claimPkgs) {
      let newVersion: string | null = null;
      if (base === "package.json") { try { const j = JSON.parse(file.after) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }; const decl = j.dependencies?.[p.name] ?? j.devDependencies?.[p.name]; newVersion = decl ? semver.minVersion(decl)?.version ?? null : null; } catch { /* syntax check reports it */ } }
      else { const m = file.after.match(new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}==([0-9][^\\s;#]*)`, "mi")); newVersion = m?.[1] ?? null; }
      if (!newVersion) continue;
      const inRange = p.affected_ranges.length ? versionInRanges(newVersion, p.affected_ranges) : null;
      version_check = { package: `${p.ecosystem}/${p.name}`, new_version: newVersion, outside_ranges: inRange == null ? null : !inRange, note: inRange === false ? `declared ${p.name}@${newVersion} is outside the affected ranges ${p.affected_ranges.join(" | ")} (lockfile must be regenerated; resolved version unverified)` : inRange === true ? `declared ${p.name}@${newVersion} is STILL inside the affected ranges` : `declared ${p.name}@${newVersion}; ranges not machine-checkable` };
    }
  }
  // 3. Model re-assessment of the non-computed conditions on the patched text (citations verified against the patched text)
  // The re-assessment sees the whole cited context: patched text for changed files, the original text for every other
  // cited file. Showing only the changed files made the model "lose" conditions whose evidence lives elsewhere
  // (e.g. the middleware check when only package.json was bumped) and report them Unknown.
  const changed = new Set(fix.files.map((x) => x.path));
  const afterFiles = [...fix.files.map((x) => ({ path: x.path, text: x.after })), ...[...before.entries()].filter(([p]) => !changed.has(p)).map(([path, text]) => ({ path, text }))];
  const nonComputed = a.conditions.filter((c) => !c.computed);
  let after = new Map<string, { state: ConditionResult["state"]; verified: boolean; file: string | null; line: number | null; reasoning: string }>();
  let modelOk = false;
  if (nonComputed.length && fix.files.length) {
    try {
      const r = await modelConditionStates(afterFiles, `${f?.claim?.summary ?? ""}\nA proposed patch MODIFIED these files: ${[...changed].join(", ")}. The other files are unchanged and shown for context. Assess each condition against the text as shown.`, nonComputed.map(({ id, text }) => ({ id, text })), `${fix.repo}@${a.sha.slice(0, 7)} (patched)`);
      after = new Map(r.states.map((s) => [s.id, { state: s.state, verified: s.verified, file: s.file, line: s.line, reasoning: s.reasoning }]));
      modelOk = true;
    } catch { modelOk = false; }
  }
  // 4. Coverage table + predicted verdict
  const coverage: FixAssessment["coverage"] = a.conditions.map((c) => {
    const isTouched = touched.has(c.id);
    if (c.computed) {
      const vc = version_check && /version_/.test(c.id) ? version_check : null;
      const st: ConditionResult["state"] | null = vc ? (vc.outside_ranges === true ? "Contradicted" : vc.outside_ranges === false ? "Observed" : "Inferred") : null;
      return { condition_id: c.id, text: c.text, driving: driving(c), touched: !!vc, before: c.state, after: st, after_evidence: vc ? vc.note : null, tag: vc ? "COMPUTED" as const : "UNCHANGED" as const };
    }
    const m = after.get(c.id);
    if (!m || !isTouched) return { condition_id: c.id, text: c.text, driving: driving(c), touched: isTouched, before: c.state, after: m && isTouched ? m.state : null, after_evidence: null, tag: "UNCHANGED" as const };
    const changed = m.state !== c.state;
    const tag = !changed ? "UNCHANGED" as const : m.verified ? "CITATION-VERIFIED" as const : "MODEL-ASSUMPTION" as const;
    const state = changed && !m.verified && (m.state === "Contradicted" || m.state === "Observed") ? c.state : m.state; // unverified flips do not count
    return { condition_id: c.id, text: c.text, driving: driving(c), touched: true, before: c.state, after: state, after_evidence: m.file ? `${m.file}:${m.line ?? "?"} — ${m.reasoning}` : m.reasoning, tag: state === c.state && changed ? "MODEL-ASSUMPTION" as const : tag };
  });
  const predictedConds: ConditionResult[] = a.conditions.map((c) => { const cv = coverage.find((x) => x.condition_id === c.id)!; return { ...c, state: cv.after ?? c.state }; });
  const pv = decide(predictedConds, a.tier);
  // 5. Risk screen (deterministic heuristics over the diff)
  const risk_flags: string[] = [];
  for (const file of fix.files) {
    const removed = file.patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1));
    const added = file.patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
    if (removed.some((l) => RISK_REMOVED.test(l))) risk_flags.push(`${file.path}: removes a line that looks like a security check`);
    if (added.some((l) => RISK_ADDED.test(l))) risk_flags.push(`${file.path}: adds dynamic code execution or unsafe HTML`);
    if (file.path.split("/").pop() === "package.json") { try { const b = JSON.parse(before.get(file.path) ?? "{}") as { dependencies?: Record<string, string> }; const n = JSON.parse(file.after) as { dependencies?: Record<string, string> }; const added2 = Object.keys(n.dependencies ?? {}).filter((k) => !(b.dependencies ?? {})[k]); if (added2.length) risk_flags.push(`${file.path}: adds new dependencies ${added2.join(", ")}`); } catch { /* ignore */ } }
    if (removed.length + added.length > 150) risk_flags.push(`${file.path}: large change (${removed.length + added.length} lines)`);
  }
  if (fix.syntax_check.some((s) => !s.ok)) risk_flags.push("syntax check failed");
  // 6. Overall label, decided in code
  const drivingRows = coverage.filter((c) => c.driving);
  const resolved = drivingRows.filter((c) => (c.tag === "COMPUTED" && c.after === "Contradicted") || (c.tag === "CITATION-VERIFIED" && c.after === "Contradicted"));
  const anyVerifiedImprovement = resolved.length > 0;
  let label: FixAssessment["label"] = "not_supported";
  if (!drivingRows.length || !modelOk && !version_check) label = "not_assessable";
  else if (anyVerifiedImprovement && pv.verdict === "Not Affected" && !risk_flags.length) label = "supported";
  else if (anyVerifiedImprovement || pv.verdict !== a.verdict) label = "partially_supported";
  if (version_check?.outside_ranges === false) label = "not_supported";
  const model_judgement = fix.files.flatMap((x) => x.hunks.map((h) => ({ path: x.path, addresses: h.addresses, reason: h.rationale })));
  const uncertain = [
    ...drivingRows.filter((c) => !resolved.includes(c)).map((c) => `${c.condition_id} is ${c.after ?? c.before} after the patch (${c.tag.toLowerCase().replace("-", " ")})`),
    "not type-checked here; imports and types unverified", "runtime behaviour not observed; no tests were run",
    ...(version_check ? ["resolved lockfile version not verified until the lockfile is regenerated"] : []),
  ];
  const verification_required = ["Review every hunk against the condition it claims to address", "Run the existing test suite and type checker locally or in CI", ...(version_check ? ["Regenerate and commit the lockfile, then confirm the installed version"] : []), "Confirm environment-dependent conditions (hosting, proxies, headers) in the deployed environment"];
  const summary = label === "supported" ? `Every verdict-driving condition is contradicted after the patch by computed or citation-verified evidence; predicted verdict ${pv.verdict}. Still not verified by execution.`
    : label === "partially_supported" ? `Some driving conditions change state after the patch (${resolved.map((c) => c.condition_id).join(", ") || "none verified"}); predicted verdict ${pv.verdict}. Others remain, or risk flags apply.`
    : label === "not_supported" ? `No verdict-driving condition is contradicted by verifiable evidence after the patch${version_check?.outside_ranges === false ? "; the declared version is still inside the affected range" : ""}.`
    : "The patch could not be assessed statically (no driving conditions, or the model re-assessment failed).";
  return { label, summary, coverage, predicted_verdict: pv.verdict, predicted_reason: pv.reason, version_check, risk_flags, model_judgement, uncertain, verification_required };
}
