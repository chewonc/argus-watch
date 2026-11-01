// Manual / backup trigger for one poller (QStash-signed, or admin token). The regular schedule is /api/poll/tick.
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { env, hasQStash } from "@/lib/env";
import { POLLERS, runSource } from "@/lib/poll";

export const maxDuration = 120;

async function handler(req: Request, ctx?: { params?: Promise<{ source: string }> }) {
  const { source } = (await ctx?.params) ?? { source: new URL(req.url).pathname.split("/").pop()! };
  if (!POLLERS.some((p) => p.id === source)) return Response.json({ error: "unknown source", known: POLLERS.map((p) => p.id) }, { status: 404 });
  return Response.json(await runSource(source));
}

export async function POST(req: Request, ctx: { params: Promise<{ source: string }> }) {
  const auth = req.headers.get("authorization");
  if (env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`) return handler(req, ctx);
  if (hasQStash()) return verifySignatureAppRouter(handler)(req, ctx);
  if (process.env.NODE_ENV !== "production") return handler(req, ctx);
  return new Response("unauthorized", { status: 401 });
}
