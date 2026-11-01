// Offline consistency check for the evaluation set. No model, no network, read-only.
// Usage: node feasibility/check_labels.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "labels.json"), "utf8"));
const defs = JSON.parse(fs.readFileSync(path.join(ROOT, "advisories", "conditions.json"), "utf8"));
const errors = [];

function condDefs(advisory) {
  const d = defs[advisory];
  if (!d) return null;
  return d.same_conditions_as ? defs[d.same_conditions_as].conditions : d.conditions;
}
// Same rule as argus-watch/lib/verdict.ts
function decide(conds, tier) {
  if (conds.some((c) => c.state === "Contradicted")) return "Not Affected";
  const required = conds.filter((c) => c.role === "required");
  if (!required.length || required.some((c) => c.state !== "Observed" && c.state !== "Inferred")) return "Unclear";
  if (conds.some((c) => c.role === "mitigation" && c.mitigation_kind === "environment" && c.state === "Unknown")) return "Unclear";
  if (tier === "signal") return "Unclear";
  if (tier === "corroborated" && required.some((c) => c.state !== "Observed")) return "Unclear";
  return "Affected";
}

const dist = { Affected: 0, "Not Affected": 0, Unclear: 0 };
for (const [id, lab] of Object.entries(labels)) {
  const dir = path.join(ROOT, "cases", id);
  if (!fs.existsSync(dir)) { errors.push(`${id}: case folder missing`); continue; }
  if (!fs.existsSync(path.join(ROOT, "advisories", `${lab.advisory}.json`))) errors.push(`${id}: advisory file missing`);
  const cd = condDefs(lab.advisory);
  if (!cd) { errors.push(`${id}: no condition defs for ${lab.advisory}`); continue; }
  const ids = cd.map((c) => c.id);
  for (const k of Object.keys(lab.conditions)) if (!ids.includes(k)) errors.push(`${id}: unknown condition ${k}`);
  for (const k of ids) if (!(k in lab.conditions)) errors.push(`${id}: condition ${k} not labelled`);
  for (const L of lab.locations) {
    const p = path.join(dir, L.file);
    if (!fs.existsSync(p)) { errors.push(`${id}: location file ${L.file} missing`); continue; }
    if (L.line > fs.readFileSync(p, "utf8").split("\n").length) errors.push(`${id}: ${L.file}:${L.line} out of range`);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
  const [name, version] = lab.dependency.split(/@(?=[^@]+$)/);
  if (lock.packages[`node_modules/${name}`]?.version !== version) errors.push(`${id}: lockfile has ${name}@${lock.packages[`node_modules/${name}`]?.version}, label says ${version}`);
  const v = decide(cd.map((c) => ({ ...c, state: lab.conditions[c.id] })), lab.tier ?? "official");
  if (v !== lab.verdict) errors.push(`${id}: rule gives ${v}, label says ${lab.verdict}`);
  if (lab.adversarial && !lab.expected_behaviour) errors.push(`${id}: adversarial without expected_behaviour`);
  if (!lab.adversarial) dist[lab.verdict]++;
}
console.log(`${Object.keys(labels).length} cases (${Object.values(labels).filter((l) => l.adversarial).length} adversarial); ordinary verdict distribution:`, dist);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("labels consistent");
