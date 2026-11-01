// Mark notifications read: by notification ids, by assessment id (opening a case), or all.
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { nids?: string[]; assessment?: string; all?: boolean };
  let n = 0;
  if (body.all) { for (const nid of await store.unreadIds(user.id)) { await store.markNotificationRead(user.id, nid); n++; } }
  for (const nid of body.nids ?? []) { await store.markNotificationRead(user.id, nid); n++; }
  if (body.assessment) {
    await store.markRead(user.id, body.assessment);
    for (const nid of await store.unreadIds(user.id)) { const x = await store.getNotification(nid); if (x?.assessment_id === body.assessment) { await store.markNotificationRead(user.id, nid); n++; } }
  }
  return Response.json({ ok: true, marked: n, unread: await store.unreadCount(user.id) });
}
