"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";

export async function saveSettings(formData: FormData) {
  const user = await requireUser("/settings");
  const raw = String(formData.get("webhook_url") ?? "").trim();
  // An unchanged masked value keeps the stored URL; empty clears it; a new value must be a Slack/Discord webhook.
  const webhook = raw.endsWith("…") ? user.settings.webhook_url : raw && /^https:\/\/(hooks\.slack\.com|discord(app)?\.com)\//.test(raw) ? raw : null;
  await store.putUser({ ...user, settings: { ...user.settings, inapp: formData.get("inapp") === "on", webhook_url: webhook } });
  revalidatePath("/settings");
}

/** Create a personal agent token (returned once; only its hash is stored). */
export async function createAgentTokenAction(label: string): Promise<string> {
  const user = await requireUser("/settings");
  const { createAgentToken } = await import("@/lib/agent-token");
  const t = await createAgentToken(user.id, label);
  revalidatePath("/settings");
  return t;
}

export async function revokeAgentTokenAction(formData: FormData) {
  const user = await requireUser("/settings");
  const { revokeAgentToken } = await import("@/lib/agent-token");
  await revokeAgentToken(user.id, String(formData.get("hash") ?? ""));
  revalidatePath("/settings");
}
