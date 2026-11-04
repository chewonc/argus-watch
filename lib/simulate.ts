// "What happens if you don't fix this?" — a hypothetical, user-centred walkthrough of how an end user of the
// repository's application could experience the threat. Meta Muse Spark proposes the scenario as structured screens;
// code then grounds it: every step that claims to be demonstrated or inferred must cite a condition Argus marked
// Observed/Inferred or a verified file:line from the assessment, otherwise it is downgraded to hypothetical. The
// "application surface" must cite real repository files or it is labelled generic. Nothing is executed, and all
// people, data and transactions are synthetic.
import { createHash } from "node:crypto";
import type { Assessment, Finding, Fix } from "./schema";
import { readFile } from "./repo";
import { READ_ONLY, UNTRUSTED, sparkJSON } from "./spark";
import { kv } from "./store";

export type Basis = "demonstrated" | "inferred" | "hypothetical";
export type Screen = { kind: "chat" | "agent_log" | "checkout" | "notification" | "form" | "page" | "terminal" | "email"; title: string; lines: { who: "user" | "app" | "agent" | "attacker" | "system"; text: string; tone: "normal" | "danger" | "success" | "muted" }[] };
export type Step = { n: number; actor: "user" | "app" | "agent" | "attacker"; screen: Screen; narration: string; basis: Basis; evidence: { condition_id: string | null; file: string | null; line: number | null }[] };
export type Simulation = {
  applicable: boolean; not_applicable_reason: string | null;
  persona: string; surface: { kind: string; name: string; derived_from: { file: string; line: number | null }[]; generic: boolean };
  steps: Step[];
  consequence: { summary: string; basis: Basis; evidence: Step["evidence"] };
  with_fix: { available: boolean; blocked_at_step: number | null; changed_behavior: string; remaining_uncertainty: string[]; label: string } | null;
  downgraded: number; model: string; ms: number; created_at: string; version: string;
};

const SCREEN = { type: "object", additionalProperties: false, required: ["kind", "title", "lines"], properties: {
  kind: { type: "string", enum: ["chat", "agent_log", "checkout", "notification", "form", "page", "terminal", "email"] }, title: { type: "string" },
  lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["who", "text", "tone"], properties: { who: { type: "string", enum: ["user", "app", "agent", "attacker", "system"] }, text: { type: "string" }, tone: { type: "string", enum: ["normal", "danger", "success", "muted"] } } } } } };
const EVID = { type: "array", items: { type: "object", additionalProperties: false, required: ["condition_id", "file", "line"], properties: { condition_id: { type: ["string", "null"] }, file: { type: ["string", "null"] }, line: { type: ["integer", "null"] } } } };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["applicable", "not_applicable_reason", "persona", "surface", "steps", "consequence", "with_fix"],
  properties: {
    applicable: { type: "boolean" }, not_applicable_reason: { type: ["string", "null"] }, persona: { type: "string" },
    surface: { type: "object", additionalProperties: false, required: ["kind", "name", "derived_from"], properties: { kind: { type: "string" }, name: { type: "string" }, derived_from: { type: "array", items: { type: "object", additionalProperties: false, required: ["file", "line"], properties: { file: { type: "string" }, line: { type: ["integer", "null"] } } } } } },
    steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "actor", "screen", "narration", "basis", "evidence"], properties: { n: { type: "integer" }, actor: { type: "string", enum: ["user", "app", "agent", "attacker"] }, screen: SCREEN, narration: { type: "string" }, basis: { type: "string", enum: ["demonstrated", "inferred", "hypothetical"] }, evidence: EVID } } },
    consequence: { type: "object", additionalProperties: false, required: ["summary", "basis", "evidence"], properties: { summary: { type: "string" }, basis: { type: "string", enum: ["demonstrated", "inferred", "hypothetical"] }, evidence: EVID } },
    with_fix: { type: ["object", "null"], additionalProperties: false, required: ["blocked_at_step", "changed_behavior", "remaining_uncertainty"], properties: { blocked_at_step: { type: ["integer", "null"] }, changed_behavior: { type: "string" }, remaining_uncertainty: { type: "array", items: { type: "string" } } } },
  },
};

const RULES = `Task: show a developer what an END USER of their application could experience if this vulnerability were exploited, as 3-6 short steps rendered as screens of the app.
Ground rules (code verifies them; violations are downgraded or removed):
- Derive the application surface (chatbot, agent, shop, API, CLI...) ONLY from the repository files shown. Cite the files/lines in surface.derived_from. If the files do not show a user-facing surface, set applicable=false and explain why; do not invent features.
- Each step's basis: "demonstrated" only if a cited condition was Observed by Argus; "inferred" if Inferred; otherwise "hypothetical". Cite condition ids and/or file:line for every non-hypothetical step.
- Use fictional people and data only (e.g. "Mina", "order #4821", "mina@example.com"). Never real names, secrets, URLs or identifiers from the repository's users.
- Describe consequences, never attack instructions: no payloads, no exploit strings, no step-by-step technique. The attacker step is described in plain words ("a product description contains hidden instructions").
- The consequence must follow from the conditions; if impact beyond what the code shows is plausible, mark it hypothetical.
- If a FIX is provided, fill with_fix: at which step the change is expected to stop the chain, what the user sees instead, and what remains uncertain. Never claim the vulnerability is resolved. If no fix is provided, with_fix = null.
- Short, concrete text. Screens have 1-5 lines.`;

const FAKE_DATA = /(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{12,}|-----BEGIN|password\s*[:=]\s*\S{6,})/i;

/** Pure: enforce grounding on the model output. */
export function ground(sim: Omit<Simulation, "downgraded" | "model" | "ms" | "created_at" | "version" | "surface" | "with_fix"> & { surface: { kind: string; name: string; derived_from: { file: string; line: number | null }[] }; with_fix: { blocked_at_step: number | null; changed_behavior: string; remaining_uncertainty: string[] } | null }, a: Assessment, repoFiles: Set<string>, fix: Fix | null): Omit<Simulation, "model" | "ms" | "created_at" | "version"> {
  const states = new Map(a.conditions.map((c) => [c.id, c.state]));
  const cited = new Set([...a.locations.map((l) => `${l.file}:${l.line}`), ...a.conditions.flatMap((c) => c.evidence.filter((e) => e.line != null).map((e) => `${e.file}:${e.line}`))]);
  const citedFiles = new Set([...a.locations.map((l) => l.file), ...a.conditions.flatMap((c) => c.evidence.map((e) => e.file))]);
  let downgraded = 0;
  const support = (ev: Step["evidence"]): Basis | null => {
    let best: Basis | null = null;
    for (const e of ev) {
      const st = e.condition_id ? states.get(e.condition_id) : undefined;
      if (st === "Observed") return "demonstrated";
      if (st === "Inferred") best = "inferred";
      if (e.file && e.line != null && cited.has(`${e.file}:${e.line}`)) best = best ?? "inferred";
    }
    return best;
  };
  const fixBasis = (claimed: Basis, ev: Step["evidence"]): Basis => {
    const s = support(ev);
    if (claimed === "hypothetical") return "hypothetical";
    if (claimed === "demonstrated" && s === "demonstrated") return "demonstrated";
    if (s) { if (claimed === "demonstrated") downgraded++; return "inferred"; }
    downgraded++; return "hypothetical";
  };
  const cleanEv = (ev: Step["evidence"]) => ev.filter((e) => (e.condition_id && states.has(e.condition_id)) || (e.file && (citedFiles.has(e.file) || repoFiles.has(e.file)))).slice(0, 4);
  const scrub = (t: string) => (FAKE_DATA.test(t) ? "[removed]" : t).slice(0, 300);
  const steps: Step[] = sim.steps.slice(0, 6).map((s, i) => {
    const evidence = cleanEv(s.evidence);
    return { ...s, n: i + 1, evidence, basis: fixBasis(s.basis, evidence), narration: scrub(s.narration), screen: { ...s.screen, title: scrub(s.screen.title), lines: s.screen.lines.slice(0, 5).map((l) => ({ ...l, text: scrub(l.text) })) } };
  });
  const derived = sim.surface.derived_from.filter((d) => repoFiles.has(d.file) || citedFiles.has(d.file)).slice(0, 4);
  const cEv = cleanEv(sim.consequence.evidence);
  const consequence = { summary: scrub(sim.consequence.summary), evidence: cEv, basis: fixBasis(sim.consequence.basis, cEv) };
  const testsRan = !!fix?.runner?.tests?.executed && fix.runner.tests.exit_code === 0;
  const with_fix = fix && sim.with_fix ? {
    available: true, blocked_at_step: sim.with_fix.blocked_at_step && sim.with_fix.blocked_at_step <= steps.length ? sim.with_fix.blocked_at_step : null,
    changed_behavior: scrub(sim.with_fix.changed_behavior), remaining_uncertainty: sim.with_fix.remaining_uncertainty.slice(0, 4).map(scrub),
    label: testsRan ? "Expected to block (repository tests passed after the fix; the vulnerability itself is not verified as fixed)" : "Expected to block (static review of the proposed change; not tested)",
  } : null;
  return { applicable: sim.applicable && steps.length > 0, not_applicable_reason: sim.applicable ? null : scrub(sim.not_applicable_reason ?? "Not enough evidence for a user-facing scenario."), persona: scrub(sim.persona),
    surface: { kind: sim.surface.kind, name: scrub(sim.surface.name), derived_from: derived, generic: derived.length === 0 }, steps, consequence, with_fix, downgraded };
}

const simLang = (locale?: string) => (/^[a-z]{2}(-[a-z]{2})?$/i.test(locale ?? "") ? locale!.toLowerCase() : "en");
const simVersion = (a: Assessment, fix: Fix | null, lang: string) => createHash("sha256").update(`${a.id}|${fix?.id ?? ""}|${fix?.status ?? ""}|${lang}|v1`).digest("hex").slice(0, 20);
/** Read-only: the simulation already built for this assessment/fix/language, if any (no model call). */
export async function cachedSimulation(a: Assessment, fix: Fix | null, locale?: string): Promise<Simulation | null> { return kv.get<Simulation>(`sim:${simVersion(a, fix, simLang(locale))}`); }

export async function simulate(a: Assessment, f: Finding | null, fix: Fix | null, opts: { force?: boolean; locale?: string } = {}): Promise<Simulation> {
  const lang = simLang(opts.locale);
  const version = simVersion(a, fix, lang);
  const key = `sim:${version}`;
  if (!opts.force) { const c = await kv.get<Simulation>(key); if (c) return c; }
  const repoFull = a.repo.split("/").slice(0, 2).join("/");
  const files = [...new Set([...a.locations.map((l) => l.file), ...a.conditions.flatMap((c) => c.evidence.map((e) => e.file))])].filter((p) => !/(^|\/)\.env|\.pem$|\.key$|lock/.test(p)).slice(0, 5);
  const texts = new Map<string, string>();
  for (const p of files) { const t = await readFile(repoFull, a.sha, p).catch(() => null); if (t) texts.set(p, t); }
  const listing = [...texts].map(([p, t]) => `=== ${p} ===\n${t.split("\n").slice(0, 300).map((l, i) => `${i + 1}| ${FAKE_DATA.test(l) ? "[credential-like line withheld]" : l}`).join("\n")}`).join("\n\n");
  const conds = a.conditions.map((c) => `- ${c.id} [${c.state}] ${c.text}${c.evidence[0] ? ` (${c.evidence[0].file}:${c.evidence[0].line ?? "?"})` : ""}`).join("\n");
  const fixText = fix && fix.files.length ? `FIX (${fix.agent === "muse-code" ? "made by Muse Code" : "proposed"}; status ${fix.status}${fix.runner?.tests?.executed ? `; tests ${fix.runner.tests.exit_code === 0 ? "passed" : "failed"}` : "; not tested"}):\n${fix.files.map((x) => x.patch).join("\n").slice(0, 12000)}` : "FIX: none provided";
  const langRule = lang !== "en" ? `\n- Write persona, narration, screen text, consequence and with_fix text in the language with code "${lang}". Keep file paths, identifiers and code in English.` : "";
  const r = await sparkJSON<Parameters<typeof ground>[0]>({ system: `${READ_ONLY}\n${UNTRUSTED}\n${RULES}${langRule}`, name: "simulate", schema: SCHEMA, temperature: 0.2,
    user: `THREAT (untrusted): ${f?.title ?? a.finding_id}\nSUMMARY (untrusted): ${f?.claim?.summary ?? ""}\nARGUS VERDICT: ${a.verdict} (${a.verdict_reason})\nCONDITIONS AS ASSESSED BY ARGUS:\n${conds}\n\n${fixText}\n\nREPOSITORY FILES (untrusted, numbered):\n${listing.slice(0, 60000)}` });
  const g = ground(r.out, a, new Set(texts.keys()), fix);
  const sim: Simulation = { ...g, model: r.model, ms: r.ms, created_at: new Date().toISOString(), version };
  await kv.set(key, sim);
  return sim;
}
