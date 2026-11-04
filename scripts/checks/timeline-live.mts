// Live check for lib/timeline.ts: real registries (GitHub Advisory DB, NVD, OSV), real Meta Muse Spark extraction and
// summary, and (case C) a real Meta Muse Wonder review of a date conflict. Read-only against the local store.
// Run: AW_NO_PERSIST=1 node --env-file=.env.local --import tsx scripts/checks/timeline-live.mts AB   (costs cents)
//      AW_NO_PERSIST=1 WONDER_ESCALATION=1 node --env-file=.env.local --import tsx scripts/checks/timeline-live.mts C
import { env } from "../../lib/env";
import type { Finding, Item } from "../../lib/schema";
import { store } from "../../lib/store";
import { buildTimeline, type ThreatTimeline } from "../../lib/timeline";

const show = (name: string, t: ThreatTimeline, ms: number) => {
  console.log(`\n=== ${name} (${(ms / 1000).toFixed(0)} s) ===`);
  console.log(`summary [${t.summary_basis}]: ${t.summary}`);
  console.log(`model ${t.model.name}: proposed ${t.model.proposed}, accepted ${t.model.accepted}, rejected ${t.model.rejected.length}${t.model.rejected.length ? " (" + t.model.rejected.map((r) => `${r.reason}: ${r.title}`).join(" | ") + ")" : ""}${t.model.error ? `, error ${t.model.error}` : ""}`);
  console.log(`registry: ${t.registry.map((r) => `${r.id}@${r.registry}=${r.status}`).join(", ") || "none"}`);
  for (const e of t.events) console.log(`  ${e.at.slice(0, 10)} ${e.precision.padEnd(5)} ${e.confidence.padEnd(9)} ${e.basis.padEnd(16)} ${e.kind.padEnd(18)} ${e.title.slice(0, 80)} <${e.sources.map((s) => s.url ?? s.publisher).join(" ")}>${e.conflicts_with.length ? " [CONFLICT]" : ""}${e.quote ? `\n      quote: "${e.quote.slice(0, 120)}" date: "${e.date_quote}"` : ""}${e.detail ? `\n      detail: ${e.detail.slice(0, 220)}` : ""}`);
  console.log(`wonder enabled=${t.wonder.enabled} reviews=${JSON.stringify(t.wonder.reviews)}`);
  const bad = t.events.filter((e) => !e.at || !e.sources.length || (e.basis === "model_extracted" && (!e.quote || !e.date_quote)));
  console.log(bad.length ? `CHECK FAIL: ${bad.length} event(s) without date/source/quote` : "CHECK PASS: every event has a timestamp and a source; every model event has verbatim quotes");
};
const load = async (id: string) => { const f = (await store.getFinding(id))!; const items = (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x): x is Item => !!x); return { f, items }; };

const which = process.argv[2] ?? "ABC";
if (which.includes("A")) { const { f, items } = await load("4868b51cf8557de8bafe2acc"); const t0 = Date.now(); show("A: CVE-2025-29927 (GHSA + NVD + model)", await buildTimeline(f, items, { force: true }), Date.now() - t0); }
if (which.includes("B")) { const { f, items } = await load("ec55fa9f5bf1e8902eb76a04"); const t0 = Date.now(); show("B: CVE-free AI-security write-up (GitHub MCP)", await buildTimeline(f, items, { force: true }), Date.now() - t0); }
if (which.includes("C")) {
  // A real, documented disagreement: Vercel's postmortem says the issue was reported on Feb 27, 2025; registries list Mar 21.
  if (!env.WONDER_ESCALATION) console.log("NOTE: run case C with WONDER_ESCALATION=1 in the environment to exercise Muse Wonder");
  const item = { id: "live-c", source: "rss", sourceClass: "polled", url: "https://vercel.com/blog/postmortem-on-next-js-middleware-bypass", title: "Postmortem on Next.js middleware bypass (CVE-2025-29927)",
    text: "On February 27, 2025, the vulnerability was disclosed to the Next.js team through GitHub's private vulnerability reporting. The issue allowed middleware to be bypassed using the x-middleware-subrequest header. Patches were released for Next.js 15 and 14 and the advisory was published on March 21, 2025.",
    ids: ["CVE-2025-29927"], packages: [], published_at: "2025-03-22T00:00:00Z", discovered_at: new Date().toISOString(), author: null } as unknown as Item;
  const f = { id: "live-c-finding", ids: ["GHSA-F82V-JWR5-MFFW", "CVE-2025-29927"], items: [item.id], discovered_at: new Date().toISOString(), title: item.title } as unknown as Finding;
  const t0 = Date.now(); show("C: date conflict, WONDER_ESCALATION=1", await buildTimeline(f, [item], { force: true, fetchPages: false }), Date.now() - t0);
}
