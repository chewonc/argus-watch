// Offline re-score of saved extraction/e2e outputs (no API calls). Tests two fixes:
//  F1: the version condition comes from code (lockfile + semver vs advisory ranges), not from the model.
//  F2: policy for an Unknown mitigation that the advisory says gives full protection (e.g. Vercel hosting):
//      "conservative" = does not block Affected; "strict" = blocks Affected (-> Unclear).
import fs from "node:fs";
import path from "node:path";
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const out = path.join(ROOT, "out");
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "labels.json"), "utf8"));

// F1: deterministic version state, from lockfile text only (no execution).
const RANGES = [[12, 0, 0, 12, 3, 5], [13, 0, 0, 13, 5, 9], [14, 0, 0, 14, 2, 25], [15, 0, 0, 15, 2, 3]];
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function versionState(caseId) {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", caseId, "package-lock.json"), "utf8"));
  const v = lock.packages?.["node_modules/next"]?.version;
  if (!v) return "Unknown";
  const p = v.split(".").map(Number);
  return RANGES.some(r => cmp(p, r.slice(0, 3)) >= 0 && cmp(p, r.slice(3)) < 0) ? "Observed" : "Contradicted";
}
const isVersion = c => /version|<\s*1\d\.|>=\s*1\d\./i.test(`${c.id} ${c.text}`);
const isFullProtection = c => /vercel/i.test(`${c.id} ${c.text}`);

function decide(conds, policy) {
  if (conds.some(c => c.state === "Contradicted")) return "Not Affected";
  const req = conds.filter(c => c.role === "required");
  if (!req.length || !req.every(c => c.state === "Observed" || c.state === "Inferred")) return "Unclear";
  if (policy === "strict" && conds.some(c => c.role === "mitigation" && isFullProtection(c) && c.state === "Unknown")) return "Unclear";
  return "Affected";
}

const rows = [];
for (let r = 1; fs.existsSync(path.join(out, `extract_run${r}.json`)); r++) {
  const x = JSON.parse(fs.readFileSync(path.join(out, `extract_run${r}.json`), "utf8"));
  for (const id of Object.keys(labels)) {
    const a = JSON.parse(fs.readFileSync(path.join(out, `e2e_${id}_run${r}.json`), "utf8"));
    let conds = x.conditions.filter(c => !isVersion(c)).map(c => ({ ...c, state: a.conditions.find(s => s.id === c.id)?.state ?? "Unknown" }));
    conds.push({ id: "version_in_range", text: "next version in advisory range (computed in code)", role: "required", state: versionState(id) });
    rows.push({ run: r, id, gold: labels[id].verdict, conservative: decide(conds, "conservative"), strict: decide(conds, "strict") });
  }
}
console.table(rows);
for (const p of ["conservative", "strict"]) console.log(`${p}: ${rows.filter(r => r[p] === r.gold).length}/${rows.length} match gold`);
