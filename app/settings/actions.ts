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
