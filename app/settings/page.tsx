// Notification and account preferences. Email notifications are planned, not available.
import { PushToggle } from "@/components/push-toggle";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";
import { saveSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = await requireUser("/settings");
  const subs = (await store.listPush(user.id)).length;
  const masked = user.settings.webhook_url ? `${user.settings.webhook_url.slice(0, 28)}…` : "";
  return (
    <div className="mx-auto max-w-[760px] px-6 py-8 grid gap-8">
      <div><h1 className="serif text-[36px]">Settings</h1><p className="text-ink2 text-[13px]">Signed in as <span className="mono">{user.login}</span> ({user.id}).</p></div>
      <section className="grid gap-3">
        <h2 className="label">Notifications</h2>
        <form action={saveSettings} className="grid gap-3 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" name="inapp" defaultChecked={user.settings.inapp !== false} /> In-app notifications and header badge</label>
          <label className="grid gap-1">Slack or Discord incoming webhook (optional; stored server-side and shown masked)
            <input name="webhook_url" defaultValue={masked} placeholder="https://hooks.slack.com/services/… or https://discord.com/api/webhooks/…" className="border hair rounded-[4px] px-2 py-1 bg-transparent" />
          </label>
          <button className="btn w-fit" type="submit">Save</button>
        </form>
        <div className="grid gap-1"><div className="label">Browser push</div><PushToggle vapidPublicKey={env.VAPID_PUBLIC_KEY} enabled={user.settings.push && subs > 0} /><p className="text-[12px] text-ink2">{subs} device(s) subscribed.</p></div>
        <div className="grid gap-1"><div className="label">Email</div><p className="text-[13px] text-ink2">Planned; not available in this version.</p></div>
      </section>
      <section className="grid gap-2 text-[13px]">
        <h2 className="label">Account</h2>
        <p>Sign-in uses GitHub. Repository access is granted only through the GitHub App installations you connect on <a href="/repos">Repos</a>; revoke it there or on GitHub (Settings → Applications).</p>
      </section>
    </div>
  );
}
