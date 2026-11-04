// Live integration check for lib/verify.ts: real registry lookups + Meta Muse Spark web search.
// Run: node --env-file=.env.local --import tsx scripts/checks/verify-live.mts   (costs a few cents of Meta API usage)
import { verifyFinding } from "../../lib/verify";
import type { Finding, Item } from "../../lib/schema";

const mk = (title: string, text: string, url: string, source: Item["source"] = "rss"): { f: Finding; items: Item[]; text: string } => {
  const item = { id: "i-" + title.slice(0, 8), source, sourceClass: "polled", url, title, author: null, text, ids: [], packages: [], published_at: null, discovered_at: new Date().toISOString() } as unknown as Item;
  const f = { id: "f-" + title.slice(0, 8), ids: [], title, tier: "signal", items: [item.id], sources: [source], published_at: null, discovered_at: item.discovered_at, claim: null, claim_version: null, status: "new", relevant_repos: [] } as unknown as Finding;
  return { f, items: [item], text: `${title}\n${text}` };
};
const cases = [
  { name: "A real CVE, secondary blog", expect: ["corroborated", "verified"], ...mk("Next.js middleware auth bypass explained", "CVE-2025-29927 lets attackers skip Next.js middleware by sending the x-middleware-subrequest header. Fixed in 14.2.25 and 15.2.3.", "https://www.herodevs.com/blog-posts/authorization-bypass-in-next-js-middleware-cve-2025-29927-what-you-need-to-know") },
  { name: "C fabricated CVE", expect: ["likely_false", "disputed"], ...mk("Critical RCE in every LangChain agent (CVE-2026-9123456)", "An anonymous researcher says CVE-2026-9123456 allows remote code execution in all LangChain agents through a crafted tool description. No patch exists.", "https://totally-real-ai-sec.example/langchain-rce") },
  { name: "C rumour without identifiers", expect: ["unverified", "disputed", "likely_false"], ...mk("Rumour: MCP servers leak Claude API keys", "A post claims that any MCP server can read the Claude API key of the client that connects to it, via a hidden protocol message. No advisory, no CVE, no code.", "https://social.example/@anon/1") },
];
for (const c of cases) {
  const t0 = Date.now();
  const v = await verifyFinding(c.f, c.items, c.text, "live", { useModel: true });
  const pass = c.expect.includes(v.label);
  console.log(`\n[${pass ? "PASS" : "FAIL"}] ${c.name}: ${v.label} (${((Date.now() - t0) / 1000).toFixed(0)} s) — ${v.reason}`);
  console.log(`  artefacts: ${v.artefacts.map((a) => `${a.id}=${a.status}@${a.registry}`).join(", ") || "none"}`);
  console.log(`  model: used=${v.model.used} suggested=${v.model.suggested} searches=${v.model.searches} discarded_urls=${v.model.discarded_urls} tokens=${v.model.tokens} err=${v.model.error}`);
  console.log(`  queries: ${v.model.queries.join(" | ")}`);
  for (const e of v.evidence.filter((x) => x.kind !== "publisher").slice(0, 8)) console.log(`  - ${e.kind}: ${e.text.slice(0, 120)} ${e.url ?? ""}`);
}
