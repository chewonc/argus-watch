// Grounding of the user-impact simulation (lib/simulate.ts ground()). Pure: no model, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ground } from "../lib/simulate";
import type { Assessment, Fix } from "../lib/schema";

const a = {
  locations: [{ file: "src/agent.ts", line: 12, quote: "tools: [shell]", why: "x" }],
  conditions: [
    { id: "A1", state: "Observed", evidence: [{ file: "src/agent.ts", line: 12, quote: "", sha: null }] },
    { id: "A2", state: "Inferred", evidence: [] },
    { id: "A3", state: "Unknown", evidence: [] },
  ],
} as unknown as Assessment;
const screen = { kind: "chat" as const, title: "Shop assistant", lines: [{ who: "user" as const, text: "Find me a lamp", tone: "normal" as const }] };
const base = {
  applicable: true, not_applicable_reason: null, persona: "Mina, a customer",
  surface: { kind: "agent", name: "Shopping assistant", derived_from: [{ file: "src/agent.ts", line: 1 }, { file: "src/invented.ts", line: 3 }] },
  steps: [
    { n: 1, actor: "user" as const, screen, narration: "asks", basis: "demonstrated" as const, evidence: [{ condition_id: "A1", file: null, line: null }] },
    { n: 2, actor: "agent" as const, screen, narration: "reads", basis: "demonstrated" as const, evidence: [{ condition_id: "A2", file: null, line: null }] },
    { n: 3, actor: "attacker" as const, screen, narration: "injects", basis: "inferred" as const, evidence: [{ condition_id: "A3", file: null, line: null }] },
    { n: 4, actor: "app" as const, screen: { ...screen, lines: [{ who: "app" as const, text: "key sk-abcdefghijklmnop123", tone: "danger" as const }] }, narration: "leaks", basis: "inferred" as const, evidence: [{ condition_id: "ZZ", file: "src/nowhere.ts", line: 9 }] },
  ],
  consequence: { summary: "unexpected purchase", basis: "demonstrated" as const, evidence: [] },
  with_fix: { blocked_at_step: 2, changed_behavior: "agent asks for confirmation", remaining_uncertainty: ["other tools"] },
};

test("steps keep 'demonstrated' only with an Observed condition; unsupported claims become hypothetical", () => {
  const g = ground(base, a, new Set(["src/agent.ts"]), null);
  assert.deepEqual(g.steps.map((s) => s.basis), ["demonstrated", "inferred", "hypothetical", "hypothetical"]);
  assert.equal(g.consequence.basis, "hypothetical");
  assert.equal(g.downgraded, 4);
});

test("invented files are dropped from the surface and from evidence; secret-like text is removed", () => {
  const g = ground(base, a, new Set(["src/agent.ts"]), null);
  assert.deepEqual(g.surface.derived_from.map((d) => d.file), ["src/agent.ts"]);
  assert.equal(g.steps[3].evidence.length, 0);
  assert.equal(g.steps[3].screen.lines[0].text, "[removed]");
});

test("with-fix comparison appears only with a fix and never claims the vulnerability is resolved", () => {
  assert.equal(ground(base, a, new Set(), null).with_fix, null);
  const tested = ground(base, a, new Set(), { runner: { tests: { executed: true, exit_code: 0 } } } as unknown as Fix).with_fix!;
  assert.match(tested.label, /not verified/);
  const untested = ground(base, a, new Set(), { runner: null } as unknown as Fix).with_fix!;
  assert.match(untested.label, /not tested/);
});

test("a scenario with no user-facing evidence is reported as not applicable", () => {
  const g = ground({ ...base, applicable: false, not_applicable_reason: "library-only code", steps: [] }, a, new Set(), null);
  assert.equal(g.applicable, false);
  assert.equal(g.not_applicable_reason, "library-only code");
});
