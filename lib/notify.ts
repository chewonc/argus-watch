// Per-user notifications for alerts. One record per (user, finding, repo): a re-assessment with a changed verdict
// or severity updates that record (and marks it unread again) instead of creating a duplicate; the same article
// arriving from several sources never notifies twice because findings are already deduplicated upstream.
// Delivery: in-app record (L4) -> per-user Slack/Discord webhook -> Web Push (L5), inline for small fan-outs.
import { createHash } from "node:crypto";
import { fmtAlert } from "./alert";
import { env, hasPush, hasQStash } from "./env";
import { sendPushTo } from "./push";
import type { Assessment, Finding, Item, Notification, Severity } from "./schema";
import { deriveSeverity } from "./severity";
import { SYSTEM_USER, store } from "./store";

export async function recipientsFor(repoKey: string): Promise<string[]> {
  const users = await store.activeRepoUsers(repoKey); // users who paused monitoring of this repository are not notified
  // Shared demo repositories notify only users who opted in (Settings) and have not hidden them; never everyone (V5).
  if (users.includes(SYSTEM_USER) && env.DEMO_SHARED_REPOS) {
    const optedIn = [];
    for (const uid of await store.listUserIds()) { const u = await store.getUser(uid); if (u?.settings?.demo_alerts && !u.settings.hide_demo) optedIn.push(uid); }
    return [...new Set([...users.filter((u) => u !== SYSTEM_USER), ...optedIn])];
  }
  return users.filter((u) => u !== SYSTEM_USER);
}

export async function notifyAssessment(a: Assessment, f: Finding | null, items: Item[]): Promise<{ created: number; updated: number; skipped: number }> {
  const sev: Severity = a.severity ?? deriveSeverity(a, items);
  const title = f?.title ?? a.finding_id;
  let created = 0, updated = 0, skipped = 0;
  const pushTargets: { uid: string; n: Notification }[] = [];
  for (const uid of await recipientsFor(a.repo)) {
    const user = await store.getUser(uid);
    if (!user) continue;
    const prevId = await store.notifDedupGet(uid, a.finding_id, a.repo);
    const prev = prevId ? await store.getNotification(prevId) : null;
    const now = new Date().toISOString();
    if (prev) {
      const changed = prev.verdict !== a.verdict || prev.severity.level !== sev.level || !!a.withdrawn_at !== !!prev.withdrawn;
      if (!changed) { skipped++; continue; }
      if (a.verdict === "Not Affected" && prev.verdict === "Not Affected") { skipped++; continue; }
      const n: Notification = { ...prev, credibility: f?.credibility?.label ?? null, withdrawn: !!a.withdrawn_at, kind: prev.verdict !== a.verdict || !!a.withdrawn_at !== !!prev.withdrawn ? "verdict_changed" : "severity_changed", assessment_id: a.id, title, verdict: a.verdict, severity: sev, updated_at: now, read_at: null, published_at: a.timestamps.published_at, notified_at: now, pushed_at: null, received_at: null };
      await store.putNotification(n, false); updated++;
      if (user.settings.inapp !== false) pushTargets.push({ uid, n });
      continue;
    }
    if (a.verdict === "Not Affected" || a.withdrawn_at) { skipped++; continue; } // a first assessment that is Not Affected or withdrawn is not an alert
    if (user.settings.inapp === false) { skipped++; continue; } // in-app alerts turned off in Settings: no record, no push, no webhook
    const id = createHash("sha256").update(`${uid}:${a.finding_id}:${a.repo}:${a.id}`).digest("hex").slice(0, 20);
    const n: Notification = { id, user_id: uid, kind: "alert", credibility: f?.credibility?.label ?? null, assessment_id: a.id, finding_id: a.finding_id, repo: a.repo, title, verdict: a.verdict, severity: sev, created_at: now, updated_at: now, read_at: null, published_at: a.timestamps.published_at, notified_at: now, pushed_at: null, received_at: null };
    await store.putNotification(n, true); await store.notifDedupSet(uid, a.finding_id, a.repo, id); created++;
    pushTargets.push({ uid, n });
    // per-user chat webhook (in addition to the global one handled in sendAlert)
    if (user.settings.webhook_url) {
      const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(user.settings.webhook_url);
      const text = fmtAlert(a);
      // Bounded: a slow or dead webhook must not hold up the pipeline (the in-app record is already stored).
      await fetch(user.settings.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isDiscord ? { content: text.slice(0, 1900) } : { text }), signal: AbortSignal.timeout(8000) }).catch((e) => store.log({ kind: "error", source: "notify", detail: `user webhook failed: ${String(e).slice(0, 120)}`, ref: a.id }));
    }
  }
  // Web Push: inline when the fan-out is small (one process call), else one QStash job
  const withPush: { uid: string; n: Notification }[] = [];
  for (const t of pushTargets) { const u = await store.getUser(t.uid); if (u?.settings.push && hasPush() && (await store.listPush(t.uid)).length) withPush.push(t); }
  if (withPush.length && withPush.length <= 20) { for (const t of withPush) await sendPushTo(t.uid, t.n).catch(() => {}); }
  else if (withPush.length && hasQStash()) {
    const { Client } = await import("@upstash/qstash");
    const client = new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}) });
    await client.publishJSON({ url: `${env.APP_URL}/api/push/send`, body: { nids: withPush.map((t) => t.n.id) }, retries: 1 }).catch(() => {});
    await store.countMessage();
  }
  await store.log({ kind: "notify", source: "inapp", detail: `${title.slice(0, 50)}: ${created} new, ${updated} updated, ${skipped} unchanged; push ${withPush.length}`, ref: a.id });
  return { created, updated, skipped };
}

export async function notifyFix(uid: string, kind: "fix_pr_created" | "fix_failed", a: Assessment, f: Finding | null, detail: string) {
  const user = await store.getUser(uid);
  if (user?.settings.inapp === false) return; // in-app notifications turned off in Settings
  const now = new Date().toISOString();
  const id = createHash("sha256").update(`${uid}:fix:${a.id}:${kind}:${now}`).digest("hex").slice(0, 20);
  const n: Notification = { id, user_id: uid, kind, assessment_id: a.id, finding_id: a.finding_id, repo: a.repo, title: `${kind === "fix_pr_created" ? "Pull request opened" : "Fix stopped"}: ${detail}`.slice(0, 160), verdict: a.verdict, severity: a.severity ?? deriveSeverity(a, []), created_at: now, updated_at: now, read_at: null, published_at: a.timestamps.published_at, notified_at: now, pushed_at: null, received_at: null };
  await store.putNotification(n, true);
}
