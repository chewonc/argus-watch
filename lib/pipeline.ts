// Orchestrator: ingest(item) -> finding -> enqueue; processFinding(id) -> extract -> prefilter -> match -> assess -> alert.
import { sendAlert } from "./alert";
import { assess } from "./analyze";
import { sha, upsertFinding } from "./dedup";
import { extractClaim } from "./extract";
import { fetchPageText } from "./fetchpage";
import { notifyAssessment } from "./notify";
import { enqueueProcess } from "./queue";
import { refreshRepo } from "./repo";
import type { Finding, Item, WatchedRepo } from "./schema";
import { store } from "./store";
import { chargeHosted, hostedBudgetLeft } from "./usage";
import { verifyFinding } from "./verify";

/** Stage 1 entry for every source. Returns whether a (new or changed) finding was queued. */
export async function ingest(item: Item, opts: { enqueue?: boolean; replayed?: boolean } = {}): Promise<{ finding: Finding; queued: boolean; created: boolean }> {
  await store.putItem(item);
  const { finding, changed, created } = await upsertFinding(item);
  if (changed && opts.enqueue !== false) {
    await store.log({ kind: "process", source: item.source, detail: `${created ? "new finding" : "finding updated"}: ${finding.title.slice(0, 80)}`, ref: finding.id });
    await enqueueProcess(finding.id, { replayed: !!opts.replayed });
  }
  return { finding, queued: changed && opts.enqueue !== false, created };
}

/** Cheap deterministic relevance: does the text mention anything in the union of watched stacks? */
export function prefilter(text: string, repos: WatchedRepo[]): { relevant: boolean; hits: string[] } {
  const l = text.toLowerCase();
  const names = new Set<string>();
  for (const r of repos) { r.packages.forEach((p) => names.add(p.name.toLowerCase())); r.tech_tags.forEach((t) => names.add(t)); }
  const generic = new Set(["react", "next", "docker", "vercel", "jwt", "axios", "express"]); // still count, but require word boundary
  const hits = [...names].filter((n) => n.length >= 3 && (generic.has(n) ? new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.js)?\\b`, "i").test(l) : l.includes(n)));
  // AI-agent / prompt-injection reports are relevant to any repo tagged with an LLM/MCP SDK
  const aiTerms = /prompt injection|tool[- ]use|mcp server|model context protocol|agent(ic)? (framework|sdk)|function calling/i.test(l);
  if (aiTerms && repos.some((r) => r.tech_tags.some((t) => /mcp|openai-sdk|anthropic-sdk|langchain/.test(t)))) hits.push("ai-agent");
  return { relevant: hits.length > 0, hits };
}

export async function processFinding(id: string, opts: { replayed?: boolean } = {}) {
  const t0 = Date.now();
  const f = await store.getFinding(id);
  if (!f) return;
  try {
    const items = (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x): x is Item => !!x);
    let text = items.map((i) => `[${i.source}] ${i.title}\n${i.text}`).join("\n\n---\n\n");
    // S4: fetch the linked page for feed items whose summary is short
    for (const i of items) if (i.source === "rss" && i.url && i.text.length < 1500) {
      const p = await fetchPageText(i.url);
      if (p.ok) text += `\n\n[page ${i.url}]\n${p.text}`; else await store.log({ kind: "process", source: "fetchpage", detail: `skipped ${i.url}: ${p.reason}`, ref: f.id });
    }
    const repos = await store.listRepos();
    const pre = prefilter(text, repos);
    if (!pre.relevant) {
      f.status = "not_relevant"; await store.putFinding(f);
      await store.log({ kind: "process", source: "prefilter", detail: `checked, not relevant to watched stacks: ${f.title.slice(0, 60)}`, ref: f.id, ms: Date.now() - t0 });
      return;
    }
    // Credibility of the report (artefact lookups + Meta web-search adjudication), cached per text version.
    const version = sha(text);
    if (f.credibility?.version !== version) {
      f.credibility = await verifyFinding(f, items, text, version, { useModel: !!process.env.META_API_KEY && process.env.AW_VERIFY_MODEL !== "0" }).catch((e) => { void store.log({ kind: "error", source: "verify", detail: String(e).slice(0, 200), ref: f.id }); return f.credibility ?? null; });
      if (f.credibility) await store.log({ kind: "process", source: "verify", detail: `credibility ${f.credibility.label}: ${f.credibility.reason}`.slice(0, 200), ref: f.id });
    }
    // Claim extraction, cached by text hash
    if (f.claim_version !== version || !f.claim) {
      const { claim } = await extractClaim(text);
      f.claim = claim; f.claim_version = version; f.extracted_at = new Date().toISOString();
      if (!claim.actionable) {
        f.status = "not_actionable"; await store.putFinding(f);
        await store.log({ kind: "process", source: "extract", detail: `not actionable: ${claim.not_actionable_reason ?? ""}`.slice(0, 160), ref: f.id, ms: Date.now() - t0 });
        return;
      }
    }
    f.status = "analyzing"; await store.putFinding(f);
    // Stack matching per repo
    const matched: WatchedRepo[] = [];
    for (const r0 of repos) {
      const r = await refreshRepo(r0); if (r !== r0) await store.putRepo(r);
      const pkgHit = f.claim!.packages.some((p) => r.packages.some((q) => q.ecosystem === p.ecosystem && q.name === p.name));
      const tagHit = f.claim!.tech_tags.some((t) => r.tech_tags.includes(t));
      if (pkgHit || tagHit) matched.push(r);
    }
    f.relevant_repos = matched.map((r) => store.repoKey(r));
    if (!matched.length) { f.status = "not_relevant"; await store.putFinding(f); await store.log({ kind: "process", source: "match", detail: "claim extracted; no watched repo matches", ref: f.id, ms: Date.now() - t0 }); return; }
    // Stages 3–6 + alert, per matched repo (skip if an identical assessment exists)
    // Assess matched repos with bounded concurrency (3): the model call dominates L3, so repos no longer wait in line.
    const todo = matched;
    const runOne = async (r: WatchedRepo) => {
      const aid = `${f.id}:${r.repo}${r.subdir ? "/" + r.subdir : ""}:${r.sha!.slice(0, 12)}:${f.claim_version}`;
      if (!opts.replayed && (await store.getAssessment(aid))) return;
      const key = store.repoKey(r);
      // A disputed or likely-false report is assessed at the lowest tier: it can never become "Affected".
      const cred = f.credibility?.label;
      const fx = cred === "disputed" || cred === "likely_false" || (cred === "unverified" && f.tier === "corroborated") ? { ...f, tier: "signal" as const } : f;
      let a = await assess(fx, f.claim!, r, { replayed: opts.replayed, items, budget: await hostedBudgetLeft(key) });
      if (a.hosted === "model" && a.model !== "none") await chargeHosted(key);
      if (a.verdict === "Affected" || a.verdict === "Unclear") a = await sendAlert(a); else await store.putAssessment(a);
      await notifyAssessment(a, f, items).catch((e) => store.log({ kind: "error", source: "notify", detail: String(e).slice(0, 200), ref: a.id }));
    };
    for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(runOne));
    f.status = "assessed"; await store.putFinding(f);
    await store.log({ kind: opts.replayed ? "replay" : "process", source: "pipeline", detail: `assessed ${matched.length} repo(s)`, ref: f.id, ms: Date.now() - t0 });
  } catch (e) {
    f.status = "error"; f.error = String(e).slice(0, 300); await store.putFinding(f);
    await store.log({ kind: "error", source: "pipeline", detail: f.error, ref: f.id, ms: Date.now() - t0 });
    throw e;
  }
}
