// Web Push (VAPID). Node runtime only. Dead subscriptions (404/410) are pruned. `pushed_at` is recorded for L5;
// the service worker acknowledges receipt via /api/push/ack for L6. Each user can set a minimum severity in Settings.
import webpush from "web-push";
import { env, hasPush } from "./env";
import type { Notification, User } from "./schema";
import { store } from "./store";

let configured = false;
function setup() { if (!configured && hasPush()) { webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY); configured = true; } return configured; }

const RANK: Record<string, number> = { unknown: 0, none: 0, low: 1, moderate: 2, medium: 2, high: 3, critical: 4 };
/** Push only alerts at or above the user's threshold. Fix notifications and tests always pass; unknown severity passes only at "low". */
export function meetsThreshold(n: Pick<Notification, "kind" | "severity">, min: User["settings"]["push_min_severity"] | undefined): boolean {
  if (n.kind === "fix_pr_created" || n.kind === "fix_failed" || n.kind === "window_report") return true;
  return (RANK[n.severity?.level ?? "unknown"] ?? 0) >= (RANK[min ?? "low"] ?? 1) || (min ?? "low") === "low";
}

/** The notification as the operating system shows it: plain words, no internal labels. */
export function pushPayload(n: Pick<Notification, "id" | "kind" | "verdict" | "repo" | "title" | "assessment_id" | "withdrawn">, appUrl: string, opts: { test?: boolean } = {}) {
  const repo = n.repo.split("/").slice(0, 2).join("/");
  const url = `${appUrl}/case/${n.assessment_id.split("/").map(encodeURIComponent).join("/")}`;
  const base = { nid: n.id, tag: n.id, icon: "/icon-192.png", badge: "/icon-192.png", actions: [{ action: "view", title: "View alert" }] };
  if (opts.test) return { ...base, nid: null, title: "Argus Watch: test notification", body: "Notifications work on this device. Real alerts look like this.", url: `${appUrl}/settings` };
  if (n.kind === "window_report") return { ...base, actions: [{ action: "view", title: "View report" }], title: "Argus Watch: remediation window report", body: n.title, url: `${appUrl}/runs/${encodeURIComponent(n.assessment_id.replace(/^run:/, ""))}` };
  if (n.kind === "fix_pr_created") return { ...base, title: "Argus Watch: fix ready to review", body: `A pull request with a proposed fix was opened in ${repo}.`, url };
  if (n.kind === "fix_failed") return { ...base, title: "Argus Watch: fix stopped", body: `The automated fix for ${repo} did not finish. Nothing was merged.`, url };
  if (n.withdrawn) return { ...base, title: "Argus Watch: advisory withdrawn", body: `An advisory that affected ${repo} was withdrawn by its publisher.`, url };
  const body = n.verdict === "Affected"
    ? `Vulnerability confirmed in ${repo}. A newly discovered security threat affects your code.`
    : `Possible vulnerability detected in ${repo}. A newly discovered AI security threat may affect your code.`;
  return { ...base, title: "Argus Watch: new security alert", body, url };
}

async function deliver(uid: string, payload: string, urgent: boolean): Promise<number> {
  const subs = await store.listPush(uid);
  let sent = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600, urgency: urgent ? "high" : "normal" }); sent++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await store.removePush(uid, s.endpoint); }
  }
  return sent;
}

export async function sendPushTo(uid: string, n: Notification): Promise<number> {
  if (!setup()) return 0;
  const user = await store.getUser(uid);
  if (!meetsThreshold(n, user?.settings.push_min_severity)) return 0;
  const sent = await deliver(uid, JSON.stringify(pushPayload(n, env.APP_URL)), n.severity.level === "critical" || n.severity.level === "high");
  if (sent) { const fresh = await store.getNotification(n.id); if (fresh && !fresh.pushed_at) await store.putNotification({ ...fresh, pushed_at: new Date().toISOString() }, false); }
  return sent;
}

/** Settings → "Send test notification": proves delivery to this user's devices without waiting for a real alert. */
export async function sendTestPush(uid: string): Promise<{ configured: boolean; devices: number; sent: number }> {
  if (!setup()) return { configured: false, devices: 0, sent: 0 };
  const devices = (await store.listPush(uid)).length;
  const p = pushPayload({ id: `test-${Date.now()}`, kind: "alert", verdict: "Unclear", repo: "", title: "", assessment_id: "", withdrawn: false }, env.APP_URL, { test: true });
  return { configured: true, devices, sent: devices ? await deliver(uid, JSON.stringify(p), false) : 0 };
}
