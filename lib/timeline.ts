// Threat Timeline: a chronological, evidence-grounded history of one threat (disclosure → updates → exploitation →
// patches → SaveBell detection in your repository). Built from the same items the pipeline already ingested (no new
// intelligence pipeline). Three layers, each checked by code:
//  1. Deterministic events from source timestamps (GHSA / OSV / NVD / KEV / feeds) and SaveBell's own records.
//  2. Registry dates for the cited ids (GitHub Advisory Database, NVD incl. CISA KEV date, OSV): facts, not model output.
//  3. Meta Muse Spark reads the report texts and proposes dated developments. Each proposal must quote the date and the
//     claim verbatim from that source; anything not found in the text, undated or in the future is rejected.
// Conflicting dates between sources are kept side by side. Optionally (WONDER_ESCALATION=1) Meta Muse Wonder reviews a
// conflict; its preference is shown only when it quotes the supplied source text, and it never removes an event.
import { createHash } from "node:crypto";
import { env } from "./env";
import type { Assessment, Finding, Fix, Item } from "./schema";
import { fetchPageText } from "./fetchpage";
import { READ_ONLY, UNTRUSTED, sparkJSON } from "./spark";
import { kv } from "./store";
import { USER_AGENT } from "./ua";

export type TLKind = "disclosure" | "advisory_published" | "advisory_updated" | "withdrawn" | "patch" | "exploitation" | "research" | "report"
  | "argus_discovered" | "argus_assessed" | "argus_notified" | "fix_drafted" | "fix_pr" | "fix_merged" | "agent_report";
export type TLConfidence = "confirmed" | "reported" | "inferred";
export type TLBasis = "registry" | "source_timestamp" | "model_extracted" | "argus_record";
export type TLSource = { url: string | null; publisher: string };
export type TLEvent = {
  id: string; at: string; precision: "time" | "day" | "month"; kind: TLKind; title: string; detail: string | null;
  sources: TLSource[]; confidence: TLConfidence; basis: TLBasis; quote: string | null; date_quote: string | null;
  conflicts_with: string[]; lane: "threat" | "repo";
};
export type WonderReview = { model?: string | null; a: string; b: string; resolution: "prefer_a" | "prefer_b" | "unresolved"; reason: string; evidence_quote: string | null; grounded: boolean; error: string | null };
export type ThreatTimeline = {
  finding_id: string; version: string; built_at: string; events: TLEvent[]; summary: string; summary_basis: "model" | "template";
  limited: boolean;
  model: { name: string | null; calls: number; tokens_ms: number; proposed: number; accepted: number; rejected: { reason: string; title: string }[]; error: string | null };
  registry: { id: string; registry: string; status: "ok" | "not_found" | "error"; url: string }[];
  wonder: { enabled: boolean; reviews: WonderReview[] };
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const DAY = 86400e3;
const RANK: Record<TLConfidence, number> = { confirmed: 3, reported: 2, inferred: 1 };
const FAMILY: Partial<Record<TLKind, string>> = { disclosure: "disclosure", advisory_published: "disclosure", patch: "patch", exploitation: "exploitation", withdrawn: "withdrawn", advisory_updated: "updated" };
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const hostOf = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const iso = (s: string | null | undefined): string | null => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const precisionOf = (s: string): TLEvent["precision"] => (/T\d{2}:\d{2}/.test(s) && !/T00:00:00(\.000)?Z?$/.test(s) ? "time" : "day");

function ev(p: Omit<TLEvent, "id" | "conflicts_with" | "lane" | "date_quote" | "quote" | "detail"> & Partial<Pick<TLEvent, "detail" | "quote" | "date_quote" | "lane">>): TLEvent {
  return { detail: null, quote: null, date_quote: null, lane: "threat", ...p, id: hash(`${p.kind}|${p.at}|${p.title}|${p.sources[0]?.url ?? ""}`), conflicts_with: [] };
}

// ---- 1. Deterministic events from ingested items ---------------------------------------------------------
export function itemEvents(items: Item[], f: Pick<Finding, "discovered_at" | "id">): TLEvent[] {
  const out: TLEvent[] = [];
  for (const it of items) {
    const raw = (it.raw ?? {}) as Record<string, unknown>;
    const src = (publisher: string): TLSource[] => [{ url: it.url, publisher }];
    const pub = iso(it.published_at);
    if (it.source === "ghsa" || it.source === "ghadv") {
      if (pub) out.push(ev({ at: pub, precision: precisionOf(pub), kind: "advisory_published", title: "GitHub security advisory published", detail: it.title, sources: src("GitHub Advisory Database"), confidence: "confirmed", basis: "source_timestamp" }));
      const upd = iso(raw.updated_at as string);
      if (upd && pub && Date.parse(upd) - Date.parse(pub) > DAY) out.push(ev({ at: upd, precision: precisionOf(upd), kind: "advisory_updated", title: "GitHub security advisory updated", detail: null, sources: src("GitHub Advisory Database"), confidence: "confirmed", basis: "source_timestamp" }));
      const wd = iso(raw.withdrawn_at as string);
      if (wd) out.push(ev({ at: wd, precision: precisionOf(wd), kind: "withdrawn", title: "Advisory withdrawn by GitHub", detail: null, sources: src("GitHub Advisory Database"), confidence: "confirmed", basis: "source_timestamp" }));
      const vulns = (raw.vulnerabilities as { package?: { name?: string }; first_patched_version?: string | null }[] | undefined) ?? [];
      const patched = vulns.filter((v) => v.first_patched_version).map((v) => `${v.package?.name ?? "package"} ${v.first_patched_version}`);
      if (patched.length && pub) out.push(ev({ at: pub, precision: "day", kind: "patch", title: `Patched version listed: ${[...new Set(patched)].slice(0, 4).join(", ")}`, detail: "Listed in the advisory. The release date of the patch is not stated there; the date shown is the advisory's.", sources: src("GitHub Advisory Database"), confidence: "inferred", basis: "source_timestamp" }));
    } else if (it.source === "kev") {
      if (pub) out.push(ev({ at: pub, precision: "day", kind: "exploitation", title: "Added to CISA's Known Exploited Vulnerabilities catalog", detail: `CISA lists this vulnerability as exploited in the wild${raw.dueDate ? `; federal remediation due ${raw.dueDate}` : ""}.`, sources: src("CISA"), confidence: "confirmed", basis: "source_timestamp" }));
    } else if (it.source === "nvd") {
      if (pub) out.push(ev({ at: pub, precision: precisionOf(pub), kind: "disclosure", title: "CVE published in the National Vulnerability Database", detail: it.title, sources: src("NIST NVD"), confidence: "confirmed", basis: "source_timestamp" }));
    } else if (it.source === "osv") {
      if (pub) out.push(ev({ at: pub, precision: precisionOf(pub), kind: "advisory_published", title: "Published in the OSV vulnerability database", detail: it.title, sources: src("OSV.dev"), confidence: "confirmed", basis: "source_timestamp" }));
      const wd = iso(raw.withdrawn as string);
      if (wd) out.push(ev({ at: wd, precision: precisionOf(wd), kind: "withdrawn", title: "Withdrawn in OSV", detail: null, sources: src("OSV.dev"), confidence: "confirmed", basis: "source_timestamp" }));
    } else {
      const host = hostOf(it.url) ?? it.author ?? it.source;
      const research = /arxiv\.org/.test(it.url ?? "");
      if (pub) out.push(ev({ at: pub, precision: precisionOf(pub), kind: research ? "research" : "report", title: research ? `Research paper: ${it.title}` : `Reported by ${host}: ${it.title}`, detail: null, sources: src(host), confidence: "reported", basis: "source_timestamp" }));
      else out.push(ev({ at: iso(it.discovered_at)!, precision: "day", kind: research ? "research" : "report", title: `Reported by ${host}: ${it.title}`, detail: "The source states no publication date; the date shown is when SaveBell first saw it.", sources: src(host), confidence: "inferred", basis: "argus_record" }));
    }
  }
  const disc = iso(f.discovered_at);
  if (disc) out.push(ev({ at: disc, precision: "time", kind: "argus_discovered", title: "SaveBell picked up this threat", detail: null, sources: [{ url: null, publisher: "SaveBell" }], confidence: "confirmed", basis: "argus_record" }));
  return out;
}

// ---- 2. Registry dates ------------------------------------------------------------------------------------
export async function registryEvents(ids: string[], fetcher: Fetcher = fetch): Promise<{ events: TLEvent[]; registry: ThreatTimeline["registry"] }> {
  const events: TLEvent[] = []; const registry: ThreatTimeline["registry"] = [];
  const get = async (url: string, headers: Record<string, string> = {}) => fetcher(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(12_000) });
  const ghsa = ids.filter((x) => /^GHSA-/i.test(x)).slice(0, 2);
  const cve = ids.filter((x) => /^CVE-/i.test(x)).slice(0, 2);
  for (const id0 of ghsa) {
    const id = "GHSA" + id0.slice(4).toLowerCase();
    const url = `https://github.com/advisories/${id}`;
    try {
      const r = await get(`https://api.github.com/advisories/${id}`, { accept: "application/vnd.github+json", ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) });
      if (r.status === 404) { registry.push({ id, registry: "GitHub Advisory Database", status: "not_found", url }); continue; }
      if (!r.ok) { registry.push({ id, registry: "GitHub Advisory Database", status: "error", url }); continue; }
      const j = await r.json() as { published_at?: string; updated_at?: string; withdrawn_at?: string | null; html_url?: string; vulnerabilities?: { package?: { name?: string }; first_patched_version?: string | null }[] };
      registry.push({ id, registry: "GitHub Advisory Database", status: "ok", url: j.html_url ?? url });
      const src = [{ url: j.html_url ?? url, publisher: "GitHub Advisory Database" }];
      const pub = iso(j.published_at);
      if (pub) events.push(ev({ at: pub, precision: precisionOf(pub), kind: "advisory_published", title: `${id} published in the GitHub Advisory Database`, sources: src, confidence: "confirmed", basis: "registry" }));
      const upd = iso(j.updated_at);
      if (upd && pub && Date.parse(upd) - Date.parse(pub) > DAY) events.push(ev({ at: upd, precision: precisionOf(upd), kind: "advisory_updated", title: `${id} last updated`, sources: src, confidence: "confirmed", basis: "registry" }));
      const wd = iso(j.withdrawn_at);
      if (wd) events.push(ev({ at: wd, precision: precisionOf(wd), kind: "withdrawn", title: `${id} withdrawn`, sources: src, confidence: "confirmed", basis: "registry" }));
      const patched = (j.vulnerabilities ?? []).filter((v) => v.first_patched_version).map((v) => `${v.package?.name ?? "package"} ${v.first_patched_version}`);
      if (patched.length && pub) events.push(ev({ at: pub, precision: "day", kind: "patch", title: `Patched version listed: ${[...new Set(patched)].slice(0, 4).join(", ")}`, detail: "Listed in the advisory. The release date of the patch is not stated there; the date shown is the advisory's.", sources: src, confidence: "inferred", basis: "registry" }));
    } catch { registry.push({ id, registry: "GitHub Advisory Database", status: "error", url }); }
  }
  for (const id0 of cve) {
    const id = id0.toUpperCase();
    const url = `https://nvd.nist.gov/vuln/detail/${id}`;
    try {
      const r = await get(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`, env.NVD_API_KEY ? { apiKey: env.NVD_API_KEY } : {});
      if (!r.ok) { registry.push({ id, registry: "NVD", status: "error", url }); continue; }
      const j = await r.json() as { totalResults?: number; vulnerabilities?: { cve: { published?: string; cisaExploitAdd?: string; cisaVulnerabilityName?: string; vulnStatus?: string } }[] };
      const c = j.vulnerabilities?.[0]?.cve;
      if (!c) { registry.push({ id, registry: "NVD", status: "not_found", url }); continue; }
      registry.push({ id, registry: "NVD", status: "ok", url });
      const src = [{ url, publisher: "NIST NVD" }];
      const pub = iso(c.published?.endsWith("Z") ? c.published : c.published ? `${c.published}Z` : null);
      if (pub) events.push(ev({ at: pub, precision: precisionOf(pub), kind: "disclosure", title: `${id} published in the National Vulnerability Database`, sources: src, confidence: "confirmed", basis: "registry" }));
      if (/reject/i.test(c.vulnStatus ?? "") && pub) events.push(ev({ at: pub, precision: "day", kind: "withdrawn", title: `${id} is marked Rejected in NVD`, sources: src, confidence: "confirmed", basis: "registry" }));
      const kev = iso(c.cisaExploitAdd ? `${c.cisaExploitAdd}T00:00:00Z` : null);
      if (kev) events.push(ev({ at: kev, precision: "day", kind: "exploitation", title: "Added to CISA's Known Exploited Vulnerabilities catalog", detail: "CISA lists this vulnerability as exploited in the wild (date recorded in NVD).", sources: [{ url, publisher: "CISA (via NVD)" }], confidence: "confirmed", basis: "registry" }));
    } catch { registry.push({ id, registry: "NVD", status: "error", url }); }
  }
  // OSV only when nothing else answered for a CVE/GHSA id (avoids duplicate dates for the same record)
  if (!registry.some((x) => x.status === "ok")) for (const id of [...ghsa, ...cve].slice(0, 2)) {
    const url = `https://osv.dev/vulnerability/${id}`;
    try {
      const r = await get(`https://api.osv.dev/v1/vulns/${id}`);
      if (!r.ok) { registry.push({ id, registry: "OSV", status: r.status === 404 ? "not_found" : "error", url }); continue; }
      const j = await r.json() as { published?: string; withdrawn?: string };
      registry.push({ id, registry: "OSV", status: "ok", url });
      const pub = iso(j.published);
      if (pub) events.push(ev({ at: pub, precision: precisionOf(pub), kind: "advisory_published", title: `${id} published in OSV`, sources: [{ url, publisher: "OSV.dev" }], confidence: "confirmed", basis: "registry" }));
      const wd = iso(j.withdrawn);
      if (wd) events.push(ev({ at: wd, precision: precisionOf(wd), kind: "withdrawn", title: `${id} withdrawn in OSV`, sources: [{ url, publisher: "OSV.dev" }], confidence: "confirmed", basis: "registry" }));
    } catch { registry.push({ id, registry: "OSV", status: "error", url }); }
  }
  return { events, registry };
}

// ---- 3. Model-proposed developments, grounded by verbatim quotes ------------------------------------------
export type Proposal = { source_index: number; kind: "disclosure" | "patch" | "exploitation" | "report" | "research" | "advisory_updated" | "withdrawn"; date: string; date_quote: string; claim_quote: string; title: string };
const PROPOSAL_SCHEMA = {
  type: "object", additionalProperties: false, required: ["events"],
  properties: { events: { type: "array", items: { type: "object", additionalProperties: false, required: ["source_index", "kind", "date", "date_quote", "claim_quote", "title"], properties: {
    source_index: { type: "integer" }, kind: { type: "string", enum: ["disclosure", "patch", "exploitation", "report", "research", "advisory_updated", "withdrawn"] },
    date: { type: "string", description: "YYYY-MM-DD or YYYY-MM, exactly as stated in the source" }, date_quote: { type: "string" }, claim_quote: { type: "string" }, title: { type: "string" } } } } },
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Pure: accept a proposal only if both quotes occur verbatim in its source and the quoted date matches the date. */
export function validateProposal(p: Proposal, sources: { text: string }[], now = Date.now()): { ok: true; at: string; precision: "day" | "month" } | { ok: false; reason: string } {
  const src = sources[p.source_index];
  if (!src) return { ok: false, reason: "unknown source" };
  const body = norm(src.text);
  if (!p.date_quote || !body.includes(norm(p.date_quote))) return { ok: false, reason: "date not found in the source text" };
  if (!p.claim_quote || p.claim_quote.length < 12 || !body.includes(norm(p.claim_quote))) return { ok: false, reason: "claim not found in the source text" };
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(p.date.trim());
  if (!m) return { ok: false, reason: "date not in YYYY-MM(-DD) form" };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
  if (mo < 1 || mo > 12 || (d != null && (d < 1 || d > 31)) || y < 1995) return { ok: false, reason: "invalid date" };
  const dq = norm(p.date_quote);
  // the quoted text must actually carry this date: the year, and the month by number or name
  const monthOk = dq.includes(MONTHS[mo - 1].slice(0, 3)) || new RegExp(`(^|\\D)0?${mo}(\\D|$)`).test(dq.replace(String(y), " "));
  if (!dq.includes(String(y)) || !monthOk) return { ok: false, reason: "quoted text does not state this date" };
  const at = new Date(Date.UTC(y, mo - 1, d ?? 1)).toISOString();
  if (Date.parse(at) > now + DAY) return { ok: false, reason: "date is in the future" };
  return { ok: true, at, precision: d == null ? "month" : "day" };
}

async function modelEvents(items: Item[]): Promise<{ events: TLEvent[]; proposed: number; rejected: { reason: string; title: string }[]; tokens_ms: number; name: string | null; error: string | null; calls: number }> {
  const sources = items.filter((i) => i.text && i.text.length >= 120).slice(0, 6).map((i) => ({ item: i, text: `${i.title}\n${i.text}`.slice(0, 8000) }));
  if (!sources.length || !env.META_API_KEY) return { events: [], proposed: 0, rejected: [], tokens_ms: 0, name: null, error: env.META_API_KEY ? null : "META_API_KEY not configured", calls: 0 };
  const user = sources.map((s, i) => `=== SOURCE ${i} (${s.item.source}; ${s.item.url ?? "no url"}; published ${s.item.published_at ?? "not stated"}) ===\n${s.text}`).join("\n\n");
  try {
    const r = await sparkJSON<{ events: Proposal[] }>({ name: "timeline", schema: PROPOSAL_SCHEMA,
      system: `${READ_ONLY}\n${UNTRUSTED}\nTask: list the dated developments of this security threat that the SOURCES state explicitly: first disclosure, advisory updates or withdrawal, patch or fixed-version releases, reports of exploitation in the wild, research publications.
Rules (code verifies each one; violations are discarded):
- Only events whose date is written in the source. Never infer, estimate or use today's date. If a source gives no date for something, omit it.
- date_quote: the exact words from the source that state the date. claim_quote: the exact sentence fragment (>= 12 characters) that states the development. Copy them verbatim.
- "exploitation" only when the source says it is exploited or attacked in the wild; a proof of concept or a theoretical attack is "report".
- title: <= 12 plain words, factual, no speculation. At most 8 events.`,
      user });
    const events: TLEvent[] = []; const rejected: { reason: string; title: string }[] = [];
    for (const p of (r.out.events ?? []).slice(0, 8)) {
      const v = validateProposal(p, sources);
      if (!v.ok) { rejected.push({ reason: v.reason, title: String(p.title ?? "").slice(0, 120) }); continue; }
      const it = sources[p.source_index].item;
      events.push(ev({ at: v.at, precision: v.precision, kind: p.kind, title: String(p.title).slice(0, 140), sources: [{ url: it.url, publisher: hostOf(it.url) ?? it.author ?? it.source }],
        confidence: "reported", basis: "model_extracted", quote: p.claim_quote.slice(0, 300), date_quote: p.date_quote.slice(0, 120),
        detail: p.kind === "exploitation" ? "Reported by this source; not confirmed by CISA's catalog or a registry." : null }));
    }
    return { events, proposed: (r.out.events ?? []).length, rejected, tokens_ms: r.ms, name: r.model, error: null, calls: 1 };
  } catch (e) {
    return { events: [], proposed: 0, rejected: [], tokens_ms: 0, name: env.META_MODEL, error: String((e as Error).message ?? e).slice(0, 200), calls: 1 };
  }
}

// ---- 4. Merge, order, conflicts ---------------------------------------------------------------------------
/** Pure. Same-family events within a day are one development seen by several sources; the strongest record wins. */
export function mergeEvents(events: TLEvent[]): TLEvent[] {
  const out: TLEvent[] = [];
  for (const e of [...events].sort((a, b) => RANK[b.confidence] - RANK[a.confidence])) {
    const fam = FAMILY[e.kind];
    const twin = out.find((o) => o.lane === e.lane && (fam ? FAMILY[o.kind] === fam && Math.abs(Date.parse(o.at) - Date.parse(e.at)) <= DAY
      : o.kind === e.kind && (o.sources[0]?.url ?? "") === (e.sources[0]?.url ?? "") && o.title === e.title));
    if (twin) {
      for (const s of e.sources) if (!twin.sources.some((x) => x.url === s.url && x.publisher === s.publisher)) twin.sources.push(s);
      if (!twin.quote && e.quote) { twin.quote = e.quote; twin.date_quote = e.date_quote; }
      continue;
    }
    out.push({ ...e, sources: [...e.sources] });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || RANK[b.confidence] - RANK[a.confidence]);
}

/** Pure. A source's claimed date that disagrees (> 1 day) with a different source for the same development. */
export function findConflicts(events: TLEvent[]): [TLEvent, TLEvent][] {
  const pairs: [TLEvent, TLEvent][] = [];
  const model = events.filter((e) => e.basis === "model_extracted" && (FAMILY[e.kind] === "disclosure" || FAMILY[e.kind] === "patch"));
  for (const m of model) {
    const other = events.filter((o) => o !== m && FAMILY[o.kind] === FAMILY[m.kind] && o.basis !== "model_extracted" && o.confidence === "confirmed"
      && (o.sources[0]?.url ?? null) !== (m.sources[0]?.url ?? null));
    if (!other.length) continue;
    // conflict only when no confirmed record agrees with the claimed date: the claim is not just a second, later step
    if (other.some((o) => Math.abs(Date.parse(o.at) - Date.parse(m.at)) <= DAY)) continue;
    const nearest = other.sort((x, y) => Math.abs(Date.parse(x.at) - Date.parse(m.at)) - Math.abs(Date.parse(y.at) - Date.parse(m.at)))[0];
    // a later "patch released" claim after the advisory is consistent; only an earlier-than-record or "first disclosure" mismatch conflicts
    if (FAMILY[m.kind] === "patch" && Date.parse(m.at) > Date.parse(nearest.at)) continue;
    m.conflicts_with.push(nearest.id); nearest.conflicts_with.push(m.id);
    pairs.push([nearest, m]);
  }
  return pairs;
}

// ---- 5. Optional Muse Wonder review of a conflict ---------------------------------------------------------
const WONDER_SCHEMA = { type: "object", additionalProperties: false, required: ["resolution", "evidence_quote", "reason"], properties: {
  resolution: { type: "string", enum: ["prefer_a", "prefer_b", "unresolved"] }, evidence_quote: { type: "string" }, reason: { type: "string" } } };

/** Pure: a Wonder preference counts only when its evidence quote occurs verbatim in the material it was given. */
export function groundReview(out: { resolution: WonderReview["resolution"]; evidence_quote: string; reason: string }, material: string): Pick<WonderReview, "resolution" | "reason" | "evidence_quote" | "grounded"> {
  const q = (out.evidence_quote ?? "").trim();
  const grounded = q.length >= 8 && norm(material).includes(norm(q));
  if (out.resolution === "unresolved" || !grounded) return { resolution: "unresolved", reason: grounded ? out.reason.slice(0, 300) : `Not accepted: the stated evidence does not appear in the sources.${out.reason ? ` (Model said: ${out.reason.slice(0, 200)})` : ""}`, evidence_quote: grounded ? q : null, grounded };
  return { resolution: out.resolution, reason: out.reason.slice(0, 300), evidence_quote: q.slice(0, 300), grounded };
}

export async function reviewConflict(a: TLEvent, b: TLEvent, texts: Map<string, string>, opts: { model?: string } = {}): Promise<WonderReview> {
  const excerpt = (e: TLEvent) => { const t = e.sources.map((s) => (s.url ? texts.get(s.url) : null)).find(Boolean) ?? ""; const i = e.quote ? norm(t).indexOf(norm(e.quote)) : -1; return (i >= 0 ? t.slice(Math.max(0, i - 600), i + 900) : t.slice(0, 1500)); };
  const side = (label: string, e: TLEvent) => `${label}: "${e.title}" dated ${e.at.slice(0, 10)} (${e.basis}, ${e.confidence}) from ${e.sources.map((s) => `${s.publisher} ${s.url ?? ""}`).join(", ")}\nSOURCE TEXT (untrusted):\n${excerpt(e)}${e.date_quote ? `\nDATE AS QUOTED: ${e.date_quote}` : ""}`;
  const material = `${side("A", a)}\n\n${side("B", b)}`;
  try {
    const r = await sparkJSON<{ resolution: WonderReview["resolution"]; evidence_quote: string; reason: string }>({ name: "timeline_wonder", schema: WONDER_SCHEMA, model: opts.model ?? process.env.META_WONDER_MODEL ?? "muse-wonder-1.0",
      system: `${READ_ONLY}\n${UNTRUSTED}\nTwo sources give different dates for what may be the same development of a security threat. Decide which date the supplied material supports better, or say "unresolved".
- Use ONLY the material below. evidence_quote must be copied verbatim from it and must be the text that supports your choice.
- Registry records (NVD, GitHub Advisory Database, OSV, CISA) state when the record was published, which can differ from when a researcher or vendor first disclosed the issue; both can be true. If both dates can be true, answer "unresolved" and explain.
- Prefer "unresolved" whenever the material does not settle it.`,
      user: material });
    return { model: r.model, a: a.id, b: b.id, ...groundReview(r.out, material), error: null };
  } catch (e) {
    return { model: opts.model ?? process.env.META_WONDER_MODEL ?? "muse-wonder-1.0", a: a.id, b: b.id, resolution: "unresolved", reason: "Review unavailable; both dates are shown.", evidence_quote: null, grounded: false, error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

/** Pure: apply a review without removing anything. */
export function applyReview(events: TLEvent[], r: WonderReview): void {
  const A = events.find((e) => e.id === r.a), B = events.find((e) => e.id === r.b);
  if (!A || !B) return;
  if (r.resolution === "unresolved") { for (const e of [A, B]) e.detail = [e.detail, "Sources give different dates for this development (for example a private report vs. public disclosure); both are shown.", r.grounded && r.reason ? `Muse Wonder reviewed it: ${r.reason}` : ""].filter(Boolean).join(" "); return; }
  const [win, lose] = r.resolution === "prefer_a" ? [A, B] : [B, A];
  win.detail = [win.detail, `Muse Wonder judged this date better supported: ${r.reason} (quoted: "${r.evidence_quote}")`].filter(Boolean).join(" ");
  lose.detail = [lose.detail, "Another source gives a different date; Muse Wonder judged that one better supported. This entry is kept for review."].filter(Boolean).join(" ");
}

// ---- 6. Summary (Spark, linted against the events; template fallback) ------------------------------------
const fmt = (e: TLEvent) => (e.precision === "month" ? e.at.slice(0, 7) : e.at.slice(0, 10));
export function templateSummary(events: TLEvent[]): string {
  const first = (k: (e: TLEvent) => boolean) => events.find(k);
  const d = first((e) => FAMILY[e.kind] === "disclosure" || e.kind === "research" || e.kind === "report");
  const p = first((e) => e.kind === "patch");
  const x = first((e) => e.kind === "exploitation" && e.confidence === "confirmed");
  const xr = first((e) => e.kind === "exploitation" && e.confidence !== "confirmed");
  const w = first((e) => e.kind === "withdrawn");
  const parts = [d && `First recorded ${fmt(d)} (${d.sources[0]?.publisher}).`, p && `A patched version was listed by ${fmt(p)}.`, x ? `CISA listed it as exploited in the wild on ${fmt(x)}.` : xr ? `Exploitation was reported on ${fmt(xr)} but is not confirmed by CISA.` : "No confirmed exploitation in the sources checked.", w && `Withdrawn ${fmt(w)}.`];
  return parts.filter(Boolean).join(" ");
}
/** Pure: every year and version-like token in the summary must appear in the events. */
export function summaryGrounded(summary: string, events: TLEvent[]): boolean {
  const corpus = events.map((e) => `${e.at} ${e.title} ${e.detail ?? ""} ${e.quote ?? ""}`).join(" ").toLowerCase();
  const tokens = summary.match(/\b(19|20)\d{2}\b|\b\d+\.\d+(\.\d+)*\b/g) ?? [];
  if (tokens.some((t) => !corpus.includes(t.toLowerCase()))) return false;
  if (/exploited in the wild|actively exploited/i.test(summary) && !events.some((e) => e.kind === "exploitation")) return false;
  if (/confirm/i.test(summary) && /exploit/i.test(summary) && !events.some((e) => e.kind === "exploitation" && e.confidence === "confirmed")) return false;
  return true;
}
async function summarize(events: TLEvent[]): Promise<{ text: string; basis: "model" | "template"; error: string | null }> {
  const tpl = templateSummary(events);
  if (!env.META_API_KEY || events.length < 2) return { text: tpl, basis: "template", error: null };
  try {
    const list = events.map((e) => `${fmt(e)} | ${e.kind} | ${e.confidence} | ${e.title} | ${e.sources.map((s) => s.publisher).join(", ")}`).join("\n");
    const r = await sparkJSON<{ summary: string }>({ name: "timeline_summary", schema: { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } },
      system: `${READ_ONLY}\nSummarize this security threat's timeline in at most 3 short sentences for a developer. Use ONLY the events listed. Keep "reported" and "inferred" events hedged ("reported", "listed"); only "confirmed" exploitation may be called confirmed. If nothing says exploitation is confirmed, do not imply it. Copy dates and versions exactly.`,
      user: list });
    const s = String(r.out.summary ?? "").trim().slice(0, 600);
    return summaryGrounded(s, events) && s ? { text: s, basis: "model", error: null } : { text: tpl, basis: "template", error: "model summary rejected by the grounding check" };
  } catch (e) { return { text: tpl, basis: "template", error: String((e as Error).message ?? e).slice(0, 160) }; }
}

// ---- Build + cache ----------------------------------------------------------------------------------------
export const timelineVersion = (f: Pick<Finding, "items" | "ids">, wonder: boolean) => hash(`${[...f.items].sort().join(",")}|${[...f.ids].sort().join(",")}|w${wonder ? 1 : 0}|v1`);
const key = (fid: string) => `timeline:${fid}`;

export async function getTimeline(f: Finding): Promise<ThreatTimeline | null> {
  const t = await kv.get<ThreatTimeline>(key(f.id));
  return t && t.version === timelineVersion(f, env.WONDER_ESCALATION) ? t : null;
}

// One build per finding at a time in this process: concurrent case-page views and the pipeline share it (no duplicate model calls).
const inflight = new Map<string, Promise<ThreatTimeline>>();
export function buildTimeline(f: Finding, items: Item[], opts: { force?: boolean; fetcher?: Fetcher; fetchPages?: boolean } = {}): Promise<ThreatTimeline> {
  const running = inflight.get(f.id);
  if (running) return running;
  const p = buildTimelineOnce(f, items, opts).finally(() => inflight.delete(f.id));
  inflight.set(f.id, p);
  return p;
}

async function buildTimelineOnce(f: Finding, items: Item[], opts: { force?: boolean; fetcher?: Fetcher; fetchPages?: boolean }): Promise<ThreatTimeline> {
  const wonder = env.WONDER_ESCALATION;
  const version = timelineVersion(f, wonder);
  if (!opts.force) { const c = await kv.get<ThreatTimeline>(key(f.id)); if (c && c.version === version) return c; }
  // Feed items often carry only a summary; read the linked page (same fetcher as the pipeline: robots.txt, rate-limited).
  const read = opts.fetchPages === false ? items : await Promise.all(items.map(async (i) => {
    if (i.source !== "rss" || !i.url || i.text.length >= 1500) return i;
    const p = await fetchPageText(i.url).catch(() => null);
    return p?.ok ? { ...i, text: `${i.text}

${p.text}` } : i;
  }));
  const [base, reg, mod] = await Promise.all([Promise.resolve(itemEvents(items, f)), registryEvents(f.ids, opts.fetcher), modelEvents(read)]);
  const events = mergeEvents([...base, ...reg.events, ...mod.events]);
  const pairs = findConflicts(events);
  const reviews: WonderReview[] = [];
  if (wonder && pairs.length) {
    const texts = new Map(read.filter((i) => i.url).map((i) => [i.url!, `${i.title}\n${i.text}`]));
    const r = await reviewConflict(pairs[0][0], pairs[0][1], texts); // one review per build (cost cap)
    applyReview(events, r); reviews.push(r);
  } else for (const [a, b] of pairs) applyReview(events, { a: a.id, b: b.id, resolution: "unresolved", reason: "", evidence_quote: null, grounded: false, error: null });
  const sum = await summarize(events.filter((e) => e.lane === "threat" && e.kind !== "argus_discovered"));
  const dated = events.filter((e) => e.kind !== "argus_discovered");
  const t: ThreatTimeline = {
    finding_id: f.id, version, built_at: new Date().toISOString(), events, summary: sum.text, summary_basis: sum.basis, limited: dated.length <= 1,
    model: { name: mod.name, calls: mod.calls + (sum.basis === "model" || sum.error ? 1 : 0), tokens_ms: mod.tokens_ms, proposed: mod.proposed, accepted: mod.events.length, rejected: mod.rejected, error: mod.error },
    registry: reg.registry, wonder: { enabled: wonder, reviews },
  };
  await kv.set(key(f.id), t);
  return t;
}

// ---- Repository lane (render time; always current, never cached) -----------------------------------------
export function repoEvents(a: Assessment, fixes: Fix[]): TLEvent[] {
  const repo = a.repo.split("/").slice(0, 2).join("/");
  const me = [{ url: null, publisher: "SaveBell" }];
  const out: TLEvent[] = [];
  const proc = iso(a.timestamps.processed_at);
  if (proc) out.push(ev({ lane: "repo", at: proc, precision: "time", kind: "argus_assessed", title: `Checked ${a.repo}@${a.sha.slice(0, 7)}: ${a.verdict === "Affected" ? "affected (confirmed from code evidence)" : a.verdict === "Unclear" ? "possible issue (not confirmed)" : "not affected"}`, sources: me, confidence: "confirmed", basis: "argus_record" }));
  const n = iso(a.timestamps.notified_at);
  if (n && a.verdict !== "Not Affected") out.push(ev({ lane: "repo", at: n, precision: "time", kind: "argus_notified", title: "You were alerted", sources: me, confidence: "confirmed", basis: "argus_record" }));
  for (const fx of fixes) {
    const c = iso(fx.created_at);
    if (c && fx.files?.length) out.push(ev({ lane: "repo", at: c, precision: "time", kind: "fix_drafted", title: `Fix proposed (${fx.agent === "muse-code" ? "by Muse Code" : "preview, not applied"})`, sources: me, confidence: "confirmed", basis: "argus_record" }));
    const fevents = fx.events ?? []; // fixes stored before the audit trail existed have no events
    const pr = fevents.find((e) => /pr|pull/i.test(e.action));
    if (fx.pr_url) out.push(ev({ lane: "repo", at: iso(pr?.at) ?? iso(fx.approved_at) ?? c ?? a.timestamps.processed_at, precision: "time", kind: "fix_pr", title: `Pull request opened${fx.pr_number ? ` #${fx.pr_number}` : ""} (not merged; the fix is not verified)`, sources: [{ url: fx.pr_url, publisher: repo }], confidence: "confirmed", basis: "argus_record" }));
    const mg = fevents.find((e) => /merged/i.test(e.action));
    if (fx.status === "merged" && mg) out.push(ev({ lane: "repo", at: iso(mg.at)!, precision: "time", kind: "fix_merged", title: "Fix merged after your repository's checks passed", sources: [{ url: fx.commit_url, publisher: repo }], confidence: "confirmed", basis: "argus_record" }));
  }
  if (a.agent) out.push(ev({ lane: "repo", at: iso(a.agent.at)!, precision: "time", kind: "agent_report", title: `Your AI agent reported: ${a.agent.status.replace("_", " ")}`, detail: "SaveBell re-read every line the agent cited.", sources: [{ url: a.agent.pr_url, publisher: a.agent.client ?? "your agent" }], confidence: "confirmed", basis: "argus_record" }));
  return out;
}
