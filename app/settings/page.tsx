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
import { REMEDIATION_MODES, modeOf } from "@/lib/remediation-mode";
import { RepositoriesPanel } from "../repos/panel";
import { createAgentTokenAction, revokeAgentTokenAction, saveDemoPrefs, saveRemediationMode, saveSettings } from "./actions";

export const dynamic = "force-dynamic";

function Section({ id, title, desc, children }: { id?: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 grid sm:grid-cols-[220px_1fr] gap-x-8 gap-y-3 py-8 border-t hair first:border-0 first:pt-0">
      <div className="grid gap-1 content-start"><h2 className="text-[15px] font-semibold">{title}</h2>{desc && <p className="text-[13px] text-ink2">{desc}</p>}</div>
      <div className="grid gap-4 min-w-0">{children}</div>
    </section>
  );
}

/** Optional detail, collapsed by default (native disclosure). */
function More({ label = "Learn more", children }: { label?: string; children: React.ReactNode }) {
  return <details className="disclose text-[13px] text-ink2"><summary>{label}</summary><div className="mt-2">{children}</div></details>;
}

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/settings");
  const sp = await searchParams;
  const locale = await getLocale();
  const [d, langs, subs, tokens] = await Promise.all([getDict(locale), languages(locale), store.listPush(user.id), listAgentTokens(user.id)]);
  const masked = user.settings.webhook_url ? `${user.settings.webhook_url.slice(0, 28)}…` : "";
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");
  return (
    <div className="mx-auto max-w-[860px] px-4 sm:px-6 py-8 sm:py-10 grid gap-8">
      <div className="grid gap-1"><h1 className="text-[28px] font-semibold tracking-[-0.02em]">{d.settings_title}</h1><p className="text-[15px] text-ink2">Signed in as {user.login}</p></div>
      <div>
        <Section id="repositories" title="Repositories" desc="Which repositories Argus Watch monitors.">
          <RepositoriesPanel sp={sp} embedded />
        </Section>

        <Section id="connect-agent" title="Connect AI agent" desc="Connect your coding agent via MCP.">
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
          <More><p>Works with Meta Muse Code, Claude Code, Codex or any MCP-capable agent, using your own AI plan. Through MCP your agent can read alerts and the cited code and report what it finds; Argus re-checks every line it cites. It cannot push code: changes stay in your editor until you approve them there. The connection key is shown once and can be revoked here with Disconnect.</p></More>
        </Section>

        <Section id="remediation" title="Automatic remediation">
          <form action={saveRemediationMode} className="grid gap-2 text-[14px]">
            <fieldset className="grid gap-2"><legend className="sr-only">After a fix is validated</legend>
              {REMEDIATION_MODES.map((m) => (
                <label key={m.id} className="flex items-start gap-2"><input type="radio" name="remediation_mode" value={m.id} defaultChecked={modeOf(user.settings) === m.id} className="mt-1" /><span><b>{m.title}</b>{m.id === "pr" ? " (default)" : ""}<span className="block text-[13px] text-ink2">{m.short}</span></span></label>
              ))}
            </fieldset>
            <button type="submit" className="btn w-fit">Save</button>
          </form>
          <More label="How it works"><ul className="list-disc pl-5 grid gap-1">
            <li>This setting only chooses the destination. Every repository change still needs your explicit approval of the exact patch.</li>
            <li>Muse Code prepares and validates the patch in an isolated runner first; nothing is written before you approve.</li>
            <li>Draft PRs are never merged automatically.</li>
            <li>Push to branch creates a new branch (argus/fix-…), respects branch protection, and never modifies your default branch.</li>
            <li>The repository must also allow changes on Repositories, and the GitHub App needs write access; with &quot;No repository writes&quot; neither is needed.</li>
          </ul></More>
        </Section>

        <Section title={d.notifications}>
          <form action={saveSettings} className="grid gap-3 text-[14px]">
            <label className="flex items-center gap-2"><input type="checkbox" name="inapp" defaultChecked={user.settings.inapp !== false} /> {d.inapp_label}</label>
            <label className="grid gap-1">{d.webhook_label}
              <input name="webhook_url" defaultValue={masked} placeholder="https://hooks.slack.com/services/…" aria-describedby="webhook-help" className="border hair rounded-[6px] px-3 h-9 bg-transparent text-[14px]" />
            </label>
            <button className="btn w-fit" type="submit">{d.save}</button>
          </form>
          <div className="grid gap-1 text-[14px]"><div className="font-medium">{d.browser_push}</div><PushToggle vapidPublicKey={env.VAPID_PUBLIC_KEY} enabled={user.settings.push && subs.length > 0} />{subs.length > 0 && <p className="text-[12px] text-ink2">{subs.length} {d.devices_subscribed}</p>}</div>
          <More><div id="webhook-help" className="grid gap-1"><p>The webhook is optional, stored server-side and shown masked; only Slack and Discord incoming-webhook URLs are accepted.</p><p>Browser push needs VAPID keys on this deployment{env.VAPID_PUBLIC_KEY ? "" : " (not set here)"}. Once enabled, alerts arrive while the browser is running, even with the tab in the background.</p></div></More>
        </Section>

        {env.DEMO_SHARED_REPOS && (
          <Section id="demo" title="Shared demo">
            <form action={saveDemoPrefs} className="grid gap-2 text-[14px]">
              <label className="flex items-center gap-2"><input type="checkbox" name="show_demo" defaultChecked={!user.settings.hide_demo} /> Show shared demo repositories</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="demo_alerts" defaultChecked={!!user.settings.demo_alerts} /> Notify me about demo findings</label>
              <button type="submit" className="btn w-fit">Save</button>
            </form>
            <More><p>Demo repositories are public example folders shown to every user who keeps them visible. They are read-only for everyone: no fixes, no repository changes, and your AI agent&apos;s reports on them are visible only to you.</p></More>
          </Section>
        )}

        <Section title={d.language}>
          <LanguageSwitcher current={locale} languages={langs} />
        </Section>

        <Section title={d.account}>
          <p className="text-[14px]">{d.account_text} <a href="#repositories">{d.nav_repos}</a>{d.account_text_2}</p>
          <More><p>Sign-in uses GitHub. Repository access is granted only through the GitHub App installations you connect on Repositories; revoke it there or on GitHub (Settings → Applications).</p></More>
        </Section>
      </div>
    </div>
  );
}
