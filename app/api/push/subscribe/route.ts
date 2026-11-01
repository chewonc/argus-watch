// Store / remove the browser's push subscription for the signed-in user.
import { currentUser } from "@/lib/session";
import { PushSubscription } from "@/lib/schema";
import { store } from "@/lib/store";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { subscription?: object } | null;
  const parsed = PushSubscription.safeParse({ ...(body?.subscription ?? {}), ua: req.headers.get("user-agent")?.slice(0, 120), added_at: new Date().toISOString() });
  if (!parsed.success) return Response.json({ error: "invalid subscription" }, { status: 400 });
  await store.addPush(user.id, parsed.data);
  await store.putUser({ ...user, settings: { ...user.settings, push: true } });
  return Response.json({ ok: true, subscriptions: (await store.listPush(user.id)).length });
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await store.removePush(user.id, endpoint);
  const left = (await store.listPush(user.id)).length;
  if (!left) await store.putUser({ ...user, settings: { ...user.settings, push: false } });
  return Response.json({ ok: true, subscriptions: left });
}
