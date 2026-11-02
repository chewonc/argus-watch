// Settings: notifications, language, AI agent connection, account.
import { ConnectAgent } from "@/components/connect-agent";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PushToggle } from "@/components/push-toggle";
import { listAgentTokens } from "@/lib/agent-token";
import { env } from "@/lib/env";
import { getDict, getLocale } from "@/lib/i18n";
import { languages } from "@/lib/i18n/translate";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";
import { createAgentTokenAction, revokeAgentTokenAction, saveSettings } from "./actions";

export const dynamic = "force-dynamic";

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="grid sm:grid-cols-[220px_1fr] gap-x-8 gap-y-3 py-8 border-t hair first:border-0 first:pt-0">
      <div className="grid gap-1 content-start"><h2 className="text-[15px] font-semibold">{title}</h2>{desc && <p className="text-[13px] text-ink2">{desc}</p>}</div>
      <div className="grid gap-4 min-w-0">{children}</div>
    </section>
  );
}

export default async function Settings() {
  const user = await requireUser("/settings");
  const locale = await getLocale();
  const [d, langs, subs, tokens] = await Promise.all([getDict(locale), languages(locale), store.listPush(user.id), listAgentTokens(user.id)]);
  const masked = user.settings.webhook_url ? `${user.settings.webhook_url.slice(0, 28)}…` : "";
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");
  return (
    <div className="mx-auto max-w-[860px] px-4 sm:px-6 py-8 sm:py-10 grid gap-8">
      <div className="grid gap-1"><h1 className="text-[28px] font-semibold tracking-[-0.02em]">{d.settings_title}</h1><p className="text-[15px] text-ink2">Signed in as {user.login}</p></div>
      <div>
        <Section title="Connect AI agent" desc="Let Claude Code, Codex or another AI coding agent look into your alerts and help fix them in your editor, using your own AI plan.">
          <ConnectAgent endpoint={`${env.APP_URL}/api/mcp`} create={createAgentTokenAction} />
          {tokens.length > 0 && (
            <ul className="border hair rounded-[8px] text-[13px]">
              {tokens.map((t) => (
                <li key={t.hash} className="flex items-center justify-between gap-3 px-3 py-2 border-b hair last:border-0">
                  <span><span className="font-medium">{t.label}</span> <span className="text-ink2">· connected {fmt(t.created_at)} · last used {fmt(t.last_used_at)}</span></span>
                  <form action={revokeAgentTokenAction}><input type="hidden" name="hash" value={t.hash} /><button type="submit" className="btn-ghost btn-danger">Disconnect</button></form>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] text-ink2">Uses the Model Context Protocol (MCP). Your agent can read alerts and the cited code and report what it finds; Argus re-checks every line it cites. It cannot push code: changes stay in your editor until you approve them there.</p>
        </Section>

        <Section title={d.notifications} desc="How Argus Watch tells you about new security alerts.">
          <form action={saveSettings} className="grid gap-3 text-[14px]">
            <label className="flex items-center gap-2"><input type="checkbox" name="inapp" defaultChecked={user.settings.inapp !== false} /> {d.inapp_label}</label>
            <label className="grid gap-1">{d.webhook_label}
              <input name="webhook_url" defaultValue={masked} placeholder="https://hooks.slack.com/services/…" className="border hair rounded-[6px] px-3 h-9 bg-transparent text-[14px]" />
            </label>
            <button className="btn w-fit" type="submit">{d.save}</button>
          </form>
          <div className="grid gap-1 text-[14px]"><div className="font-medium">{d.browser_push}</div><PushToggle vapidPublicKey={env.VAPID_PUBLIC_KEY} enabled={user.settings.push && subs.length > 0} /><p className="text-[12px] text-ink2">{subs.length} {d.devices_subscribed}</p></div>
        </Section>

        <Section title={d.language}>
          <LanguageSwitcher current={locale} languages={langs} />
        </Section>

        <Section title={d.account}>
          <p className="text-[14px]">{d.account_text} <a href="/repos">{d.nav_repos}</a>{d.account_text_2}</p>
        </Section>
      </div>
    </div>
  );
}
