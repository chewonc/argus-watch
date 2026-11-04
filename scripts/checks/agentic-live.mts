// Live check: re-assess stored fixture assessments with agentic investigation and compare to the stored result.
// Run: AW_NO_PERSIST=1 node --env-file=.env.local --import tsx scripts/checks/agentic-live.mts c13_mcp c14_mcp c4_jwt c2_not
import { readFileSync } from "node:fs";
import { assess } from "../../lib/analyze";
import { store } from "../../lib/store";
const keys = Object.keys(JSON.parse(readFileSync(".data/store.json", "utf8"))).filter((k) => k.startsWith("assessment:"));
for (const w of process.argv.slice(2)) {
  const k = keys.filter((x) => x.includes(w)).pop();
  if (!k) { console.log(`no assessment for ${w}`); continue; }
  const before = await store.getAssessment(k.slice("assessment:".length));
  if (!before) continue;
  const f = await store.getFinding(before.finding_id);
  const repo = await store.getRepo(before.repo);
  if (!f?.claim || !repo) { console.log(`${w}: missing finding/repo`); continue; }
  const t0 = Date.now();
  const after = await assess(f, f.claim, { ...repo, sha: before.sha }, { budget: true });
  console.log(`\n== ${before.repo.split("/").pop()}  before: ${before.verdict}  after: ${after.verdict}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const inv = after.investigation;
  console.log(`  investigation: ${inv ? `${inv.steps} tool call(s), +${inv.added.length} file(s) ${inv.added.map((p) => p.split("/").pop()).join(", ")} · ${inv.tokens} tokens` : "none"}`);
  if (inv) console.log(`  tools: ${inv.tools.join(" → ")}`);
  for (const c of after.conditions) { const b = before.conditions.find((x) => x.id === c.id); console.log(`  ${c.id}: ${b?.state ?? "-"} → ${c.state} ${c.evidence[0] ? `${c.evidence[0].file.split("/").pop()}:${c.evidence[0].line}` : ""}`); }
}
