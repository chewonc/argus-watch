// Offline: strict policy using the EXTRACTED mitigation_kind (no hand-coded "vercel" regex).
// Conditions come from out/extract_kind_run*.json; states come from the gate outputs (out/<case>_run1.json),
// joined through the pre-registered gold matchers. Version is computed in code (F1). No API calls.
import fs from "node:fs";
import path from "node:path";
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const out = path.join(ROOT, "out");
const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "labels.json"), "utf8"));
const GOLD = [
  { id: "external_requests_can_set_header", test: t => /x-middleware-subrequest/i.test(t) && /(block|strip|filter|prevent|reach|remov|reject)/i.test(t) },
  { id: "auth_check_in_middleware", test: t => /middleware/i.test(t) && /(auth|access control|protect|session|login)/i.test(t) },
  { id: "not_hosted_on_vercel", test: t => /(vercel|self-host|hosting|hosted|deploy)/i.test(t) },
];
const RANGES = [[12,0,0,12,3,5],[13,0,0,13,5,9],[14,0,0,14,2,25],[15,0,0,15,2,3]];
const cmp = (a, b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2];
function versionState(id) {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", id, "package-lock.json"), "utf8")).packages?.["node_modules/next"]?.version;
  if (!v) return "Unknown";
  const p = v.split(".").map(Number);
  return RANGES.some(r => cmp(p, r.slice(0,3)) >= 0 && cmp(p, r.slice(3)) < 0) ? "Observed" : "Contradicted";
}
// Strict policy: Unknown ENVIRONMENT mitigation blocks Affected; Unknown WORKAROUND is assumed absent (listed as missing evidence).
function decide(conds) {
  if (conds.some(c => c.state === "Contradicted")) return "Not Affected";
  const req = conds.filter(c => c.role === "required");
  if (!req.every(c => c.state === "Observed" || c.state === "Inferred")) return "Unclear";
  if (conds.some(c => c.role === "mitigation" && c.mitigation_kind === "environment" && c.state === "Unknown")) return "Unclear";
  return "Affected";
}
const rows = [];
for (let r = 1; fs.existsSync(path.join(out, `extract_kind_run${r}.json`)); r++) {
  const x = JSON.parse(fs.readFileSync(path.join(out, `extract_kind_run${r}.json`), "utf8"));
  for (const id of Object.keys(labels)) {
    const g = JSON.parse(fs.readFileSync(path.join(out, `${id}_run1.json`), "utf8"));
    const conds = x.conditions.map(c => {
      const gid = GOLD.find(m => m.test(`${c.id} ${c.text}`))?.id;
      return { ...c, gid, state: g.conditions.find(s => s.id === gid)?.state ?? "Unknown" };
    });
    conds.push({ id: "version_in_range", role: "required", mitigation_kind: "not_applicable", state: versionState(id) });
    rows.push({ run: r, id, kinds: x.conditions.map(c => `${c.role[0]}/${c.mitigation_kind}`).join(" "), verdict: decide(conds), gold: labels[id].verdict });
  }
}
console.table(rows);
console.log(`strict + extracted kind: ${rows.filter(r => r.verdict === r.gold).length}/${rows.length} match gold`);
