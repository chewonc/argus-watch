// S2/S3 pollers, invoked by QStash schedules (signature-verified) or by the heartbeat/admin token.
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { env, hasQStash } from "@/lib/env";
import { ingest } from "@/lib/pipeline";
import { fetchKEV, itemsFromKEV } from "@/lib/sources/kev";
import { FEEDS, fetchFeed, itemFromEntry } from "@/lib/sources/rss";
import { store } from "@/lib/store";

export const maxDuration = 120;

type PollState = { last_run: string; last_ok: string | null; cursor: string | null; runs: number; errors: number; last_error: string | null; intervals_ms: number[] };

async function runPoll(source: string) {
  const t0 = Date.now();
  const now = new Date().toISOString();
  const st: PollState = (await store.getPollState<PollState>(source)) ?? { last_run: now, last_ok: null, cursor: null, runs: 0, errors: 0, last_error: null, intervals_ms: [] };
  if (st.runs > 0) { st.intervals_ms.unshift(Date.now() - Date.parse(st.last_run)); st.intervals_ms = st.intervals_ms.slice(0, 50); }
  st.last_run = now; st.runs++;
  let ingested = 0, created = 0;
  const errors: string[] = [];
  try {
    if (source === "kev") {
      const k = await fetchKEV();
      const items = itemsFromKEV(k, st.cursor, now);
      // first run: only take the last 3 days so we don't flood the queue
      const cutoff = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
      for (const it of items.filter((i) => st.cursor || i.published_at!.slice(0, 10) >= cutoff)) {
        if (!(await store.markSeen("kev", it.id))) continue; // cursor day is re-read every run; skip items already ingested
        const r = await ingest(it); ingested++; if (r.created) created++;
      }
      st.cursor = k.vulnerabilities.reduce((m, v) => (v.dateAdded > m ? v.dateAdded : m), st.cursor ?? "");
    } else if (source === "rss") {
      for (const f of FEEDS) {
        try {
          const entries = await fetchFeed(f);
          for (const e of entries.slice(0, 40)) {
            if (!(await store.markSeen(`rss:${f.id}`, e.guid))) continue;
            // first run per feed: only items from the last 2 days
            if (!st.last_ok && e.published && Date.parse(e.published) < Date.now() - 2 * 86400e3) continue;
            const r = await ingest(itemFromEntry(f, e, now)); ingested++; if (r.created) created++;
          }
        } catch (e) { errors.push(`${f.id}: ${String(e).slice(0, 80)}`); }
      }
      if (errors.length) await store.log({ kind: "error", source: "rss", detail: `feeds failed: ${errors.join("; ")}`.slice(0, 300) });
    } else return Response.json({ error: "unknown source" }, { status: 404 });
    st.last_ok = now; st.last_error = errors.length ? errors.join("; ").slice(0, 200) : null;
  } catch (e) { st.errors++; st.last_error = String(e).slice(0, 200); }
  await store.setPollState(source, st);
  await store.log({ kind: "poll", source, detail: `ingested ${ingested} (new findings ${created})${st.last_error ? `; errors: ${st.last_error}` : ""}`, ms: Date.now() - t0 });
  return Response.json({ ok: !st.last_error, source, ingested, created, ms: Date.now() - t0, state: st });
}

async function handler(req: Request, ctx?: { params?: Promise<{ source: string }> }) {
  const { source } = (await ctx?.params) ?? { source: new URL(req.url).pathname.split("/").pop()! };
  return runPoll(source);
}

// QStash-signed in production; admin token allowed for manual/heartbeat triggers.
export async function POST(req: Request, ctx: { params: Promise<{ source: string }> }) {
  const auth = req.headers.get("authorization");
  if (env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`) return handler(req, ctx);
  if (hasQStash()) return verifySignatureAppRouter(handler)(req, ctx);
  if (process.env.NODE_ENV !== "production") return handler(req, ctx);
  return new Response("unauthorized", { status: 401 });
}
