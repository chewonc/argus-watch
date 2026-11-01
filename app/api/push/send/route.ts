// QStash-invoked fan-out for larger recipient sets (small sets are pushed inline from the pipeline).
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { env, hasQStash } from "@/lib/env";
import { sendPushTo } from "@/lib/push";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

async function handler(req: Request) {
  const { nids } = (await req.json().catch(() => ({}))) as { nids?: string[] };
  let sent = 0;
  for (const nid of nids ?? []) { const n = await store.getNotification(nid); if (n) sent += await sendPushTo(n.user_id, n); }
  return Response.json({ ok: true, sent });
}

export async function POST(req: Request) {
  if (env.ADMIN_TOKEN && req.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`) return handler(req);
  if (hasQStash()) return verifySignatureAppRouter(handler)(req);
  if (process.env.NODE_ENV !== "production") return handler(req);
  return new Response("unauthorized", { status: 401 });
}
