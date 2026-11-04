// Live check for lib/simulate.ts on assessments in the local store. Run: node --env-file=.env.local --import tsx scripts/checks/simulate-live.mts <id-substring>...
import { simulate } from "../../lib/simulate";
import { readFileSync } from "node:fs";
import { store } from "../../lib/store";
const want = process.argv.slice(2);
const keys = Object.keys(JSON.parse(readFileSync(".data/store.json", "utf8"))).filter((k) => k.startsWith("assessment:"));
for (const w of want) {
  const k = keys.find((x: string) => x.includes(w));
  if (!k) { console.log(`no assessment matching ${w}`); continue; }
  const a = await store.getAssessment(k.slice("assessment:".length));
  if (!a) continue;
  const f = await store.getFinding(a.finding_id);
  const fix = (await store.listFixes(a.id)).find((x) => x.files.length) ?? null;
  const sim = await simulate(a, f, fix, { force: true });
  console.log(`\n== ${a.repo} (${a.verdict}) fix=${fix ? fix.status : "none"} · ${(sim.ms / 1000).toFixed(0)} s · downgraded ${sim.downgraded}`);
  if (!sim.applicable) { console.log(`  NOT APPLICABLE: ${sim.not_applicable_reason}`); continue; }
  console.log(`  ${sim.persona} @ ${sim.surface.name} (${sim.surface.generic ? "generic" : sim.surface.derived_from.map((d) => `${d.file}:${d.line}`).join(", ")})`);
  for (const s of sim.steps) console.log(`  ${s.n}. [${s.basis}] ${s.narration} | ${s.screen.kind}: ${s.screen.lines.map((l) => l.text).join(" / ").slice(0, 140)} | ev ${s.evidence.map((e) => e.condition_id ?? `${e.file}:${e.line}`).join(",")}`);
  console.log(`  => [${sim.consequence.basis}] ${sim.consequence.summary}`);
  if (sim.with_fix) console.log(`  with fix: stop at ${sim.with_fix.blocked_at_step}: ${sim.with_fix.changed_behavior} (${sim.with_fix.label})`);
}
