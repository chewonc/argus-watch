// The single scheduler entry point: QStash calls this every 5 minutes (`*/5 * * * *`); the GitHub Actions heartbeat
// calls it as a backup. Each source runs on its own interval (lib/poll.ts POLLERS). `?force=1` runs everything.
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { env, hasQStash } from "@/lib/env";
import { tick } from "@/lib/poll";

export const maxDuration = 300;

async function handler(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const r = await tick(force);
  return Response.json({ ok: r.results.every((x) => x.ok), ...r });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`) return handler(req);
  if (hasQStash()) return verifySignatureAppRouter(handler)(req);
  if (process.env.NODE_ENV !== "production") return handler(req);
  return new Response("unauthorized", { status: 401 });
}
