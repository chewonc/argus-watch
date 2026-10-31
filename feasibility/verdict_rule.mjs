// Deterministic verdict rule, applied offline to saved gate outputs (no API calls, read-only).
// Required conditions must hold for the advisory to apply; mitigations, if present, reduce exposure.
// An Unknown mitigation does not block "Affected" (the advisory's default is unmitigated) but is listed as unverified.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RULES = {
  required: ["vulnerable_version", "auth_check_in_middleware", "not_hosted_on_vercel"],
  mitigation_absent: ["external_requests_can_set_header"], // true = mitigation absent
};

export function decide(conditions) {
  const st = id => conditions.find(c => c.id === id)?.state ?? "Unknown";
  const req = RULES.required.map(st);
  const mit = RULES.mitigation_absent.map(st);
  if (req.includes("Contradicted") || mit.includes("Contradicted")) return "Not Affected";
  if (req.every(s => s === "Observed" || s === "Inferred")) return "Affected";
  return "Unclear";
}

const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "labels.json"), "utf8"));
const out = path.join(ROOT, "out");
const rows = fs.readdirSync(out).filter(f => /_run\d+\.json$/.test(f)).map(f => {
  const id = f.replace(/_run\d+\.json$/, "");
  const o = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
  const v = decide(o.conditions);
  return { file: f, model_verdict: o.verdict, rule_verdict: v, gold: labels[id].verdict, ok: v === labels[id].verdict };
});
console.table(rows);
console.log(`rule verdict accuracy: ${rows.filter(r => r.ok).length}/${rows.length}`);
