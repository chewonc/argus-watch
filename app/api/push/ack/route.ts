// Service-worker receipt: records received_at (latency stage L6). Unauthenticated by necessity (no cookies in a
// push event); the notification id is unguessable and only the timestamp is written, once.
import { store } from "@/lib/store";

export async function POST(req: Request) {
  const { nid } = (await req.json().catch(() => ({}))) as { nid?: string };
  if (!nid) return Response.json({ ok: false }, { status: 400 });
  const n = await store.getNotification(nid);
  if (n && !n.received_at) await store.putNotification({ ...n, received_at: new Date().toISOString() }, false);
  return Response.json({ ok: true });
}
