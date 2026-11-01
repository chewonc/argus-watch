// The single scheduler entry point: QStash calls this every 5 minutes (`*/5 * * * *`); the GitHub Actions heartbeat
// calls it as a backup. Each source runs on its own interval (lib/poll.ts POLLERS). `?force=1` runs everything.
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { env, hasQStash } from "@/lib/env";
import { tick } from "@/lib/poll";
import { store } from "@/lib/store";

export const maxDuration = 300;

async function handler(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const r = await tick(force);
  return Response.json({ ok: r.results.every((x) => x.ok), ...r });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`) return handler(req);
  if (hasQStash()) {
    const res = await verifySignatureAppRouter(handler)(req);
    // Diagnostics: a schedule that reaches us with a bad or missing signature would otherwise be invisible.
    if (res.status === 401 || res.status === 403) await store.log({ kind: "error", source: "tick", detail: `rejected ${res.status}: signature ${req.headers.get("upstash-signature") ? "present but invalid (different QStash project/keys?)" : "missing"}; message ${req.headers.get("upstash-message-id") ?? "-"}; schedule ${req.headers.get("upstash-schedule-id") ?? "-"}` });
    return res;
  }
  if (process.env.NODE_ENV !== "production") return handler(req);
  return new Response("unauthorized", { status: 401 });
}
