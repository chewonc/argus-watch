// Claim / condition extraction from an item's text (cached per claim_version). Version-in-range is
// never extracted: it is computed in code from lockfiles and ranges (gate finding F1).
import { Claim, ConditionDef } from "./schema";
import { READ_ONLY, UNTRUSTED, sparkJSON } from "./spark";

const CLAIM_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["actionable", "claim_type", "summary", "plain_title", "packages", "tech_tags", "conditions", "not_actionable_reason"],
  properties: {
    actionable: { type: "boolean" },
    claim_type: { type: "string", enum: ["dependency_vulnerability", "framework_misconfiguration", "ai_agent_tool_use", "prompt_injection", "supply_chain", "other"] },
    summary: { type: "string" },
    plain_title: { type: "string" },
    packages: { type: "array", items: { type: "object", additionalProperties: false, required: ["ecosystem", "name", "affected_ranges"],
      properties: { ecosystem: { type: "string" }, name: { type: "string" }, affected_ranges: { type: "array", items: { type: "string" } } } } },
    tech_tags: { type: "array", items: { type: "string" } },
    conditions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text", "role", "mitigation_kind", "source_quote"],
      properties: { id: { type: "string" }, text: { type: "string" }, role: { type: "string", enum: ["required", "mitigation"] },
        mitigation_kind: { type: "string", enum: ["environment", "workaround", "not_applicable"] }, source_quote: { type: "string" } } } },
    not_actionable_reason: { type: ["string", "null"] },
  },
};

const SYSTEM = `${READ_ONLY}
${UNTRUSTED}
Task: turn a security report into a testable claim about software systems.
- actionable=false (with not_actionable_reason) when the text names no specific software component, mechanism or precondition that could be checked in a repository or its configuration (e.g. general commentary, policy news, a paper with no concrete affected software).
- packages: concrete package coordinates only when the text states them (ecosystem lowercased: npm, pypi, go, maven, cargo, rubygems, nuget). affected_ranges as written in the text, or [] if not stated.
- plain_title: at most 8 everyday words saying what could go wrong for an affected project, for a non-technical reader (e.g. "Attackers could run code on your server", "Your login tokens could be forged"). No product names unless essential, no IDs, no jargon, no claim that any specific project is affected.
- tech_tags: lowercase technologies the issue concerns (e.g. "next.js", "express", "react-server-components", "mcp", "openai-agents-sdk", "langchain", "docker", "github-actions", "jwt").
- conditions: each a statement that must be TRUE for a system to be affected (attack-enabling form).
  role="required" if the report says the issue only applies when it holds.
  role="mitigation" for the ABSENCE of a protection or workaround the report names (true when the protection is missing).
  mitigation_kind: "environment" when the protection depends on where/how the system is deployed or hosted (may or may not be present); "workaround" when someone must deliberately add it (absent by default); "not_applicable" for required conditions.
- NEVER create a condition about the dependency version being in an affected range; that is computed separately.
- source_quote must be copied verbatim from the text. Do not invent conditions. Keep the list minimal.`;

export type ExtractResult = { claim: Claim; ms: number; model: string };

export async function extractClaim(text: string): Promise<ExtractResult> {
  const { out, ms, model } = await sparkJSON<unknown>({ system: SYSTEM, user: `REPORT (untrusted):\n${text.slice(0, 60000)}`, schema: CLAIM_SCHEMA, name: "claim" });
  const claim = Claim.parse(out);
  // Merge duplicate package entries (advisories list one range per entry): one package, all ranges.
  const merged = new Map<string, { ecosystem: string; name: string; affected_ranges: string[] }>();
  for (const p of claim.packages) {
    const k = `${p.ecosystem.toLowerCase()}:${p.name}`;
    const m = merged.get(k) ?? { ecosystem: p.ecosystem.toLowerCase(), name: p.name, affected_ranges: [] };
    for (const r of p.affected_ranges) if (!m.affected_ranges.includes(r)) m.affected_ranges.push(r);
    merged.set(k, m);
  }
  claim.packages = [...merged.values()];
  // Defensive: drop any condition that smuggles a version check back in.
  claim.conditions = claim.conditions.filter((c: ConditionDef) => !/\bversion\b|>=\s*\d|<\s*\d|\d+\.\d+\.\d+/.test(c.text) || /header|config|setting|host|deploy|enabled|disabled|flag/i.test(c.text));
  return { claim, ms, model };
}
