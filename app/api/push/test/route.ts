// POST: send a test notification to the signed-in user's own subscribed devices (Settings → Send test notification).
import { sendTestPush } from "@/lib/push";
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  // At most one test per user per 30 seconds.
  if (!(await store.markSeen("pushtest", `${user.id}:${Math.floor(Date.now() / 30_000)}`))) return Response.json({ error: "please wait a few seconds before sending another test" }, { status: 429 });
  const r = await sendTestPush(user.id);
  if (!r.configured) return Response.json({ ...r, error: "browser push is not configured on this deployment" }, { status: 503 });
  if (!r.devices) return Response.json({ ...r, error: "no device is subscribed; enable browser push first" }, { status: 409 });
  return Response.json({ ok: r.sent > 0, ...r });
}
