// Manual / backup trigger for one poller (QStash-signed, or admin token). The regular schedule is /api/poll/tick.
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { isAdminAuth, hasQStash } from "@/lib/env";
import { POLLERS, runSource, tick } from "@/lib/poll";
import { store } from "@/lib/store";

export const maxDuration = 300;

async function handler(req: Request, ctx?: { params?: Promise<{ source: string }> }) {
  const { source } = (await ctx?.params) ?? { source: new URL(req.url).pathname.split("/").pop()! };
  if (!POLLERS.some((p) => p.id === source)) return Response.json({ error: "unknown source", known: POLLERS.map((p) => p.id) }, { status: 404 });
  const r = await runSource(source);
  // Resilience: a legacy per-source schedule also runs every other poller whose interval has elapsed, so sources
  // without a schedule of their own (ghadv, rss-slow) are never starved when the tick schedule is missing.
  // The source just run is skipped by the tick because its last_run is fresh.
  const t = await tick().catch(async (e) => { await store.log({ kind: "error", source: "tick", detail: `tick after ${source} failed: ${String(e).slice(0, 160)}` }); return null; });
  if (t) await store.log({ kind: "poll", source, detail: `legacy schedule hit; also_ran: ${t.ran.join(", ") || "nothing due"}` });
  return Response.json({ ...r, also_ran: t?.ran ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ source: string }> }) {
  const auth = req.headers.get("authorization");
  if (isAdminAuth(auth)) return handler(req, ctx);
  if (hasQStash()) return verifySignatureAppRouter(handler)(req, ctx);
  if (process.env.NODE_ENV !== "production") return handler(req, ctx);
  return new Response("unauthorized", { status: 401 });
}
