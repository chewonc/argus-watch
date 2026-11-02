// Polling orchestrator. One QStash schedule hits /api/poll/tick every 5 minutes; the tick runs every
// source whose own interval has elapsed. Per-source classes and intervals are declared here so that
// the UI can label each source by how it is really monitored (and the measured interval, not the nominal one).
import { ingest } from "./pipeline";
import { fetchAdvisories, itemFromAdvisory } from "./sources/ghadv";
import { fetchKEV, itemsFromKEV } from "./sources/kev";
import { FEEDS, fetchFeed, itemFromEntry, type Feed } from "./sources/rss";
import { store } from "./store";

export type SourceClass = "push" | "near_realtime" | "periodic";
export type Poller = { id: string; name: string; cls: SourceClass; interval_min: number };
export const POLLERS: Poller[] = [
  { id: "ghadv", name: "GitHub Advisory Database (REST)", cls: "near_realtime", interval_min: 5 },
  { id: "rss", name: `Fast feeds (${FEEDS.filter((f) => f.cadence === "fast").length})`, cls: "near_realtime", interval_min: 5 },
  { id: "kev", name: "CISA Known Exploited Vulnerabilities", cls: "periodic", interval_min: 10 },
  { id: "rss-slow", name: `Slow feeds (${FEEDS.filter((f) => f.cadence === "slow").length})`, cls: "periodic", interval_min: 60 },
];
export const TICK_MIN = 5;

export type PollState = {
  last_run: string; last_ok: string | null; first_ok: string | null; cursor: string | null; etag?: string | null;
  runs: number; errors: number; last_error: string | null; intervals_ms: number[];
};
type SeenDoc = Record<string, { etag: string | null; last_modified: string | null; guids: string[]; first_ok: string | null }>;
const SEEN_KEY = "seen:rss";
const sha8 = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

async function loadState(id: string, now: string): Promise<PollState> {
  const st = (await store.getPollState<PollState>(id)) ?? { last_run: now, last_ok: null, first_ok: null, cursor: null, runs: 0, errors: 0, last_error: null, intervals_ms: [] };
  if (st.runs > 0) { st.intervals_ms.unshift(Date.now() - Date.parse(st.last_run)); st.intervals_ms = st.intervals_ms.slice(0, 50); }
  st.last_run = now; st.runs++; st.first_ok ??= null;
  return st;
}

/** Fetch the given feeds concurrently (bounded), dedupe against one shared seen-document (2 Redis commands per run instead of one per entry). */
async function pollFeeds(feeds: Feed[], now: string, firstRun: boolean): Promise<{ ingested: number; created: number; errors: string[]; not_modified: number }> {
  const seen = ((await store.getSeenDoc<SeenDoc>(SEEN_KEY)) ?? {}) as SeenDoc;
  let ingested = 0, created = 0, not_modified = 0; const errors: string[] = [];
  const work = feeds.map((f) => async () => {
    const s = (seen[f.id] ??= { etag: null, last_modified: null, guids: [], first_ok: null });
    try {
      const r = await fetchFeed(f, { etag: s.etag, last_modified: s.last_modified });
      if (r.not_modified) { not_modified++; return; }
      s.etag = r.etag; s.last_modified = r.last_modified;
      const fresh = s.first_ok === null;
      for (const e of r.entries.slice(0, 40)) {
        const g = sha8(e.guid);
        if (s.guids.includes(g)) continue;
        const remember = () => { s.guids.unshift(g); s.guids = s.guids.slice(0, 200); };
        // first run per feed: only items from the last 2 days (no backlog floods, and backlog never counts as latency)
        if ((fresh || firstRun) && e.published && Date.parse(e.published) < Date.now() - 2 * 86400e3) { remember(); continue; }
        // The guid is remembered only after a successful ingest, so a transient store/queue failure retries next poll.
        try { const res = await ingest(itemFromEntry(f, e, now)); ingested++; if (res.created) created++; remember(); }
        catch (err) { errors.push(`${f.id} ingest: ${String(err).slice(0, 80)}`); }
      }
      s.first_ok ??= now;
    } catch (e) { errors.push(`${f.id}: ${String(e).slice(0, 80)}`); }
  });
  for (let i = 0; i < work.length; i += 6) await Promise.all(work.slice(i, i + 6).map((w) => w()));
  await store.setSeenDoc(SEEN_KEY, seen);
  return { ingested, created, errors, not_modified };
}

export async function runSource(id: string): Promise<{ ok: boolean; source: string; ingested: number; created: number; ms: number; state: PollState; note?: string }> {
  const t0 = Date.now();
  const now = new Date().toISOString();
  const st = await loadState(id, now);
  let ingested = 0, created = 0, note: string | undefined;
  const errors: string[] = [];
  try {
    if (id === "kev") {
      const r = await fetchKEV(st.etag);
      if (r.not_modified) note = "not modified (304)";
      else {
        st.etag = r.etag;
        const items = itemsFromKEV(r.kev!, st.cursor, now);
        const cutoff = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
        for (const it of items.filter((i) => st.cursor || i.published_at!.slice(0, 10) >= cutoff)) {
          if (!(await store.markSeen("kev", it.id))) continue;
          // One failing item must not abort the whole source run (the item is logged; the cursor still advances).
          try { const res = await ingest(it); ingested++; if (res.created) created++; }
          catch (err) { await store.log({ kind: "error", source: "kev", detail: `ingest failed for ${it.ids[0] ?? it.id}: ${String(err).slice(0, 160)}`, ref: it.id }); }
        }
        st.cursor = r.kev!.vulnerabilities.reduce((m, v) => (v.dateAdded > m ? v.dateAdded : m), st.cursor ?? "");
      }
    } else if (id === "ghadv") {
      const r = await fetchAdvisories(st.cursor, st.etag);
      if (r.not_modified) note = "not modified (304)";
      else {
        st.etag = r.etag;
        // first run: last 24 h only
        const floor = st.cursor ?? new Date(Date.now() - 86400e3).toISOString();
        const fresh = r.advisories.filter((a) => a.updated_at >= floor);
        for (const a of fresh.reverse()) {
          const it = itemFromAdvisory(a, now);
          if (!(await store.markSeen("ghadv", it.id))) continue;
          try { const res = await ingest(it); ingested++; if (res.created) created++; }
          catch (err) { await store.log({ kind: "error", source: "ghadv", detail: `ingest failed for ${a.ghsa_id}: ${String(err).slice(0, 160)}`, ref: it.id }); }
        }
        st.cursor = r.advisories.reduce((m, a) => (a.updated_at > m ? a.updated_at : m), st.cursor ?? floor);
      }
    } else if (id === "rss" || id === "rss-slow") {
      const r = await pollFeeds(FEEDS.filter((f) => (id === "rss" ? f.cadence === "fast" : f.cadence === "slow")), now, !st.last_ok);
      ingested = r.ingested; created = r.created;
      note = `${r.not_modified} feed(s) unchanged${r.errors.length ? `; ${r.errors.length} feed(s) failed: ${r.errors.join("; ")}` : ""}`.slice(0, 300);
      if (r.errors.length) await store.log({ kind: "error", source: id, detail: `feeds failed: ${r.errors.join("; ")}`.slice(0, 300) });
      // The source is degraded only when most of its feeds fail; a single flaky feed is reported in the note and the log.
      const total = FEEDS.filter((f) => (id === "rss" ? f.cadence === "fast" : f.cadence === "slow")).length;
      if (r.errors.length * 2 > total) errors.push(...r.errors);
    } else throw new Error(`unknown source ${id}`);
    st.last_ok = now; st.first_ok ??= now; st.last_error = errors.length ? errors.join("; ").slice(0, 200) : null;
  } catch (e) { st.errors++; st.last_error = String(e).slice(0, 200); }
  await store.setPollState(id, st);
  const ms = Date.now() - t0;
  await store.log({ kind: "poll", source: id, detail: `ingested ${ingested} (new findings ${created})${note ? `; ${note}` : ""}${st.last_error ? `; errors: ${st.last_error}` : ""}`, ms });
  return { ok: !st.last_error, source: id, ingested, created, ms, state: st, note };
}

export type TickState = { last_run: string; ran: string[]; forced?: boolean; scheduled_runs?: number; last_scheduled?: string | null };

/** The 5-minute tick: run each poller whose interval has elapsed (with 1 minute of slack for scheduler jitter).
 *  `scheduled` marks a run that came from the QStash tick schedule itself (not a forced call, not a legacy schedule hit),
 *  so /api/status can say whether that schedule has ever fired. */
export async function tick(force = false, scheduled = false): Promise<{ ran: string[]; skipped: string[]; results: Awaited<ReturnType<typeof runSource>>[] }> {
  const ran: string[] = [], skipped: string[] = [], results: Awaited<ReturnType<typeof runSource>>[] = [];
  for (const p of POLLERS) {
    const st = await store.getPollState<PollState>(p.id);
    const due = force || !st || Date.now() - Date.parse(st.last_run) >= (p.interval_min - 1) * 60e3;
    if (!due) { skipped.push(p.id); continue; }
    ran.push(p.id);
    results.push(await runSource(p.id));
  }
  const prev = (await store.getPollState<TickState>("tick")) ?? null;
  const now = new Date().toISOString();
  await store.setPollState("tick", { last_run: now, ran, forced: force, scheduled_runs: (prev?.scheduled_runs ?? 0) + (scheduled ? 1 : 0), last_scheduled: scheduled ? now : prev?.last_scheduled ?? null });
  return { ran, skipped, results };
}
