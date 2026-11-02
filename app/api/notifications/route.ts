// Per-user notifications: `?count=1` for the header badge, otherwise the latest list (plain titles, see lib/notif-view.ts).
import { viewNotifications } from "@/lib/notif-view";
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("count") === "1") return Response.json({ unread: await store.unreadCount(user.id) });
  const n = Math.min(200, Number(url.searchParams.get("n") ?? 50));
  const notifications = await viewNotifications(user.id, await store.listNotifications(user.id, n));
  return Response.json({ unread: await store.unreadCount(user.id), notifications });
}
