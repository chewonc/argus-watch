// Web Push (VAPID). Node runtime only. Dead subscriptions (404/410) are pruned. `pushed_at` is recorded for L5;
// the service worker acknowledges receipt via /api/push/ack for L6.
import webpush from "web-push";
import { env, hasPush } from "./env";
import type { Notification } from "./schema";
import { store } from "./store";

let configured = false;
function setup() { if (!configured && hasPush()) { webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY); configured = true; } return configured; }

export async function sendPushTo(uid: string, n: Notification): Promise<number> {
  if (!setup()) return 0;
  const subs = await store.listPush(uid);
  if (!subs.length) return 0;
  const payload = JSON.stringify({ nid: n.id, title: `${n.severity.level.toUpperCase()} · ${n.verdict} · ${n.repo}`, body: n.title.slice(0, 120), url: `${env.APP_URL}/case/${n.assessment_id.split("/").map(encodeURIComponent).join("/")}`, tag: n.id });
  let sent = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600, urgency: n.severity.level === "critical" || n.severity.level === "high" ? "high" : "normal" }); sent++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await store.removePush(uid, s.endpoint); }
  }
  if (sent) { const fresh = await store.getNotification(n.id); if (fresh && !fresh.pushed_at) await store.putNotification({ ...fresh, pushed_at: new Date().toISOString() }, false); }
  return sent;
}
