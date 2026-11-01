// Model-drafted fixes. Drafting is read-only: hunks are applied in memory to file text fetched at the assessed
// commit, diffed, syntax-checked (never executed), and assessed statically (lib/fixassess.ts). Applying a fix
// (lib/fix-apply.ts) needs the user's explicit approval and opens a DRAFT pull request on a new branch.
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import ts from "typescript";
import type { Assessment, Finding, Fix, FixHunk, Item } from "./schema";
import { assessFix } from "./fixassess";
import { LOCKFILES, readFile, tree } from "./repo";
import { permalink, provenanceOf } from "./remediation";
import { READ_ONLY, UNTRUSTED, sparkJSON } from "./spark";
import { store } from "./store";

const FIX_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "caveats", "hunks"],
  properties: {
    summary: { type: "string" },
    caveats: { type: "array", items: { type: "string" } },
    hunks: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "search", "replace", "rationale", "addresses", "condition_ids"],
      properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" }, rationale: { type: "string" }, addresses: { type: "string", enum: ["root_cause", "symptom", "unrelated"] }, condition_ids: { type: "array", items: { type: "string" } } } } },
  },
};
const FIX_RULES = `Task: propose the MINIMAL source change that addresses the assessed conditions in the listed files.
Rules:
- Edit only the listed paths. Each hunk's "search" is a verbatim, contiguous excerpt of the listed file (one or more complete lines, exactly as shown without the line-number prefix) that occurs exactly once; "replace" is the new text for that excerpt.
- Prefer changes that remove the mechanism (root cause) over filtering one symptom. Say which in "addresses", and list the condition ids each hunk addresses.
- Do not add dependencies unless the advisory names an upgrade; then change only the declared version in package.json / requirements.txt and state in caveats that the lockfile must be regenerated and installed.
- Never remove or weaken an existing security check, never introduce eval/exec/dynamic code execution, never touch .env files or CI workflows, never write tests or exploit code.
- If no safe minimal change is possible, return no hunks and explain in caveats.
- Put anything uncertain (behaviour you cannot see, environment dependencies) in caveats.`;

export const gitBlobSha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text, "utf8")}\0`).update(text, "utf8").digest("hex");

export function fixableFiles(a: Assessment): string[] {
  const all = [...new Set([...a.locations.map((l) => l.file), ...a.conditions.flatMap((c) => c.evidence.map((e) => e.file))])];
  return all.filter((p) => { const base = p.split("/").pop()!; return !(LOCKFILES.includes(base) && base !== "package.json" && base !== "requirements.txt") && !/(^|\/)\.env|\.pem$|\.key$|(^|\/)\.github\/workflows\//.test(p); });
}

/** Pure: apply search/replace hunks; a hunk is rejected unless its search occurs exactly once in the running text. */
export function applyHunks(text: string, hunks: FixHunk[]): { after: string; applied: FixHunk[]; rejected: (FixHunk & { reason: string })[] } {
  let cur = text; const applied: FixHunk[] = []; const rejected: (FixHunk & { reason: string })[] = [];
  for (const h of hunks) {
    if (!h.search.trim()) { rejected.push({ ...h, reason: "empty search" }); continue; }
    const n = cur.split(h.search).length - 1;
    const normalized = n === 0 ? cur.split(h.search.replace(/\r\n/g, "\n")).length - 1 : n;
    const s = n === 0 && normalized === 1 ? h.search.replace(/\r\n/g, "\n") : h.search;
    const count = n === 0 ? normalized : n;
    if (count === 0) { rejected.push({ ...h, reason: "search text not found in the file at the assessed commit" }); continue; }
    if (count > 1) { rejected.push({ ...h, reason: `ambiguous: search text occurs ${count} times` }); continue; }
    cur = cur.replace(s, () => h.replace); applied.push(h);
  }
  return { after: cur, applied, rejected };
}

export const unifiedDiff = (path: string, before: string, after: string, sha: string) => createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, sha.slice(0, 7), "argus-fix", { context: 3 });

/** Syntax only (never executed, never type-checked here): TS/JS via the compiler's parser, JSON via JSON.parse. */
export function syntaxCheck(path: string, text: string): { path: string; ok: boolean; label: string; errors: string[] } {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
    const r = ts.transpileModule(text, { fileName: path, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true } });
    const errors = (r.diagnostics ?? []).map((d) => { const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null; return `${pos ? `line ${pos.line + 1}: ` : ""}${ts.flattenDiagnosticMessageText(d.messageText, " ")}`; });
    return { path, ok: errors.length === 0, label: "syntax-checked (parsed only; not type-checked, not executed)", errors };
  }
  if (/\.json$/.test(path)) { try { JSON.parse(text); return { path, ok: true, label: "JSON parsed (not executed)", errors: [] }; } catch (e) { return { path, ok: false, label: "JSON parse failed", errors: [String(e).slice(0, 200)] }; } }
  return { path, ok: true, label: "not checked (no parser for this file type)", errors: [] };
}

export async function draftFix(a: Assessment, f: Finding | null, items: Item[], userId: string): Promise<Fix> {
  const repoFull = a.repo.split("/").slice(0, 2).join("/");
  const id = createHash("sha256").update(`${a.id}:${userId}:${Date.now()}`).digest("hex").slice(0, 16);
  const base: Fix = { id, assessment_id: a.id, user_id: userId, repo: repoFull, repo_key: a.repo, base_sha: a.sha, status: "drafting", summary: "", caveats: [], files: [], rejected_hunks: [], syntax_check: [], assessment: null, verified: false, branch: null, pr_url: null, pr_number: null, pr_draft: null, check_runs: [], checks_at: null, model: "none", created_at: new Date().toISOString(), approved_at: null, error: null };
  const paths = fixableFiles(a);
  // When the advisory names a package, the manifest that declares it is editable too (an upgrade is the usual root-cause fix),
  // even if the assessment cited only the lockfile.
  if (f?.claim?.packages.length) {
    const subdir = a.repo.split("/").slice(2).join("/");
    const entries = await tree(repoFull, a.sha).catch(() => []);
    const manifests = entries.filter((e) => /(^|\/)(package\.json|requirements\.txt)$/.test(e.path) && (!subdir || e.path.startsWith(subdir + "/")) && !/node_modules/.test(e.path)).map((e) => e.path).sort((x, y) => x.split("/").length - y.split("/").length);
    for (const m of manifests.slice(0, 2)) if (!paths.includes(m)) paths.push(m);
  }
  if (!paths.length) return { ...base, status: "failed", error: "No cited source files to change (only lockfiles or nothing was cited). Use the remediation prompt instead." };
  const before = new Map<string, string>();
  for (const p of paths.slice(0, 8)) { const t = await readFile(repoFull, a.sha, p); if (t != null) before.set(p, t); }
  if (!before.size) return { ...base, status: "failed", error: "Cited files could not be read at the assessed commit." };
  const advisoryText = items.map((i) => i.text).join("\n\n");
  const recs = a.recommendations.map((r) => `- [${provenanceOf(r.text, advisoryText, r.condition_ids, a)}] ${r.text} (conditions: ${r.condition_ids.join(", ") || "general"})`).join("\n");
  const conds = a.conditions.map((c) => `- ${c.id} [${c.state}${c.computed ? ", computed" : ""}] ${c.text}${c.evidence[0] ? ` (evidence ${c.evidence[0].file}:${c.evidence[0].line ?? "?"})` : ""}`).join("\n");
  const listing = [...before.entries()].map(([p, t]) => `=== ${p} ===\n${t.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n")}`).join("\n\n");
  let out: { summary: string; caveats: string[]; hunks: FixHunk[] }; let model = "none";
  try {
    const r = await sparkJSON<typeof out>({ system: `${READ_ONLY}\n${UNTRUSTED}\n${FIX_RULES}`, name: "fix", schema: FIX_SCHEMA,
      user: `FINDING ${f?.ids.join(", ") ?? a.finding_id}: ${f?.title ?? ""}\nSUMMARY (untrusted): ${f?.claim?.summary ?? ""}\nVERDICT: ${a.verdict} (${a.tier})\n\nCONDITIONS (states assigned by Argus Watch):\n${conds}\n\nRECOMMENDED STEPS:\n${recs || "(none)"}\n\nFILES (untrusted, numbered; edit only these):\n${listing.slice(0, 120000)}` });
    out = r.out; model = r.model;
  } catch (e) { return { ...base, status: "failed", model, error: `model call failed: ${String(e).slice(0, 200)}` }; }
  const files: Fix["files"] = []; const rejected: Fix["rejected_hunks"] = [];
  for (const [p, text] of before) {
    const hs = out.hunks.filter((h) => h.path === p);
    if (!hs.length) continue;
    const r = applyHunks(text, hs);
    rejected.push(...r.rejected);
    if (r.applied.length && r.after !== text) files.push({ path: p, before_sha: gitBlobSha(text), patch: unifiedDiff(p, text, r.after, a.sha), after: r.after, hunks: r.applied });
  }
  for (const h of out.hunks) if (!before.has(h.path)) rejected.push({ ...h, reason: "path is not one of the cited files" });
  const syntax = files.map((x) => syntaxCheck(x.path, x.after));
  const fix: Fix = { ...base, status: files.length ? "drafted" : "failed", summary: out.summary, caveats: out.caveats, files, rejected_hunks: rejected, syntax_check: syntax, model, error: files.length ? null : "The model produced no applicable hunks (see rejected hunks)." };
  if (files.length) fix.assessment = await assessFix(a, f, fix, before).catch((e) => ({ label: "not_assessable" as const, summary: `assessment failed: ${String(e).slice(0, 160)}`, coverage: [], predicted_verdict: null, predicted_reason: null, version_check: null, risk_flags: [], model_judgement: [], uncertain: ["static assessment did not run"], verification_required: ["review the diff manually"] }));
  await store.putFix(fix, true);
  await store.log({ kind: "fix", source: "draft", detail: `${fix.status}: ${files.length} file(s), ${rejected.length} rejected hunk(s), assessment ${fix.assessment?.label ?? "none"}`, ref: a.id });
  return fix;
}

/** PR title and body. States provenance, evidence, the static assessment and, prominently, what was NOT verified. */
export function prText(fix: Fix, a: Assessment, f: Finding | null, appUrl: string): { title: string; body: string } {
  const ids = f?.ids.join(", ") || a.finding_id;
  const caseUrl = `${appUrl}/case/${a.id.split("/").map(encodeURIComponent).join("/")}`;
  const as = fix.assessment;
  const body = `## Argus Watch: proposed fix for ${ids} (not verified)

**Repository:** ${fix.repo} at \`${fix.base_sha}\` · **Verdict:** ${a.verdict} (${a.tier}) · **Case:** ${caseUrl}

### What changes
${fix.files.map((x) => `- \`${x.path}\`: ${x.hunks.length} hunk(s) — ${x.hunks.map((h) => h.rationale).join("; ")}`).join("\n")}

${fix.summary}

### Static remediation assessment (Argus Watch, no execution): **${as ? as.label.replace("_", " ") : "not assessed"}**
${as?.summary ?? ""}
${as ? as.coverage.filter((c) => c.driving).map((c) => `- ${c.condition_id}: ${c.before} → ${c.after ?? "unchanged"} [${c.tag}] ${c.text}`).join("\n") : ""}
${as?.version_check ? `- Version check (computed): ${as.version_check.note}` : ""}
${as?.risk_flags.length ? `\n**Risk flags:** ${as.risk_flags.join("; ")}` : ""}
${as?.predicted_verdict ? `\nPredicted verdict after this change (static): **${as.predicted_verdict}** — ${as.predicted_reason}` : ""}

### Evidence used
${a.conditions.map((c) => `- ${c.state}${c.computed ? " (computed)" : ""}: ${c.text}${c.evidence[0] ? ` — ${permalink(fix.repo, a.sha, c.evidence[0].file, c.evidence[0].line)}` : ""}`).join("\n")}

### What was NOT verified
- Syntax only: ${fix.syntax_check.map((s) => `${s.path} ${s.ok ? "parsed" : "FAILED"}`).join(", ") || "n/a"}. Not type-checked here, not executed, no tests were run by Argus Watch.
- Exploitability was never confirmed; the remediation is **not verified**. CI results on this pull request come from this repository and do not verify that the vulnerability is fixed.
${as?.uncertain.length ? `- Still uncertain: ${as.uncertain.join("; ")}` : ""}
${fix.caveats.length ? `- Caveats from the drafting model: ${fix.caveats.join("; ")}` : ""}

### Verification required before merging
${(as?.verification_required ?? ["Review the diff", "Run the existing test suite", "Deploy to a staging environment"]).map((v) => `- [ ] ${v}`).join("\n")}

---
Drafted by model \`${fix.model}\` from the remediation brief (${appUrl}/api/remediation/${a.id.split("/").map(encodeURIComponent).join("/")}). Advisory text is untrusted data and is not reproduced here. Draft pull request for human review; do not merge without review.`;
  return { title: `Argus Watch: proposed fix for ${ids} (not verified)`, body };
}
