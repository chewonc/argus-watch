// Alerts: in-app inbox (stored assessment) + optional Slack/Discord incoming webhook.
import { env } from "./env";
import type { Assessment } from "./schema";
import { store } from "./store";

export function fmtAlert(a: Assessment): string {
  const lat = a.timestamps.published_at ? `${Math.round((Date.parse(a.timestamps.processed_at) - Date.parse(a.timestamps.published_at)) / 1000)}s since publication` : "publication time unknown";
  const tag = a.replayed ? " [REPLAYED]" : "";
  const conds = a.conditions.map((c) => `• ${c.state}: ${c.text}`).join("\n");
  return `Argus Watch${tag} — ${a.verdict} (${a.tier})\nRepo: ${a.repo}@${a.sha.slice(0, 7)}\n${a.verdict_qualifier}\n${conds}\nMissing evidence: ${a.missing_evidence.length ? a.missing_evidence.join("; ") : "none identified"}\nRecommended: ${a.recommendations.map((r) => r.text).join(" | ") || "monitor"}\n${lat}\n${env.APP_URL}/case/${a.id.split("/").map(encodeURIComponent).join("/")}\nRead-only analysis; nothing was executed or tested.`;
}

export async function sendAlert(a: Assessment): Promise<Assessment> {
  const text = fmtAlert(a);
  let delivered = "inbox";
  if (env.ALERT_WEBHOOK_URL) {
    const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(env.ALERT_WEBHOOK_URL);
    const body = isDiscord ? { content: text.slice(0, 1900) } : { text };
    // A chat-webhook outage must never fail the assessment itself (the inbox record is the source of truth).
    try {
      const r = await fetch(env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      delivered = r.ok ? (isDiscord ? "discord+inbox" : "slack+inbox") : `inbox (webhook ${r.status})`;
    } catch (e) { delivered = `inbox (webhook error: ${String(e).slice(0, 60)})`; }
  }
  const notified = { ...a, timestamps: { ...a.timestamps, notified_at: new Date().toISOString() } };
  await store.putAssessment(notified);
  await store.log({ kind: "alert", source: delivered, detail: `${a.verdict} for ${a.repo} (${a.tier}${a.replayed ? ", replayed" : ""})`, ref: a.id });
  return notified;
}
