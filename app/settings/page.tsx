// Settings: repositories, AI agent connection, remediation, notifications, language. (Sign-out is in the user menu;
// GitHub access is managed per installation under Repositories, so there is no separate Account section.)
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
import { RemediationWindows } from "@/components/remediation-windows";
import { RepositoriesPanel } from "../repos/panel";
import { createAgentTokenAction, revokeAgentTokenAction, saveDemoPrefs, saveRemediationMode, saveSettings } from "./actions";

export const dynamic = "force-dynamic";

function Section({ id, title, desc, children }: { id?: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 grid sm:grid-cols-[220px_1fr] gap-x-8 gap-y-3 py-8 border-t hair first:border-0 first:pt-0">
      <div className="grid gap-1 content-start"><h2 className="text-[calc(15px*var(--ui))] font-semibold leading-7">{title}</h2>{desc && <p className="text-[calc(13px*var(--ui))] text-ink2">{desc}</p>}</div>
      <div className="grid gap-4 min-w-0">{children}</div>
    </section>
  );
}

/** Optional detail, collapsed by default (native disclosure). */
function More({ label = "Learn more", children }: { label?: string; children: React.ReactNode }) {
  return <details className="disclose text-[calc(13px*var(--ui))] text-ink2"><summary>{label}</summary><div className="mt-2">{children}</div></details>;
}

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/settings");
  const sp = await searchParams;
  const locale = await getLocale();
  const [d, langs, subs, tokens] = await Promise.all([getDict(locale), languages(locale), store.listPush(user.id), listAgentTokens(user.id)]);
  const masked = user.settings.webhook_url ? `${user.settings.webhook_url.slice(0, 28)}…` : "";
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");
  return (
    <div className="mx-auto max-w-[calc(860px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid gap-8">
      <div className="grid gap-1"><h1 className="text-[calc(28px*var(--ui))] font-semibold tracking-[-0.02em]">{d.settings_title}</h1><p className="text-[calc(15px*var(--ui))] text-ink2">Signed in as {user.login}</p></div>
      <div>
        <Section id="repositories" title="Repositories" desc="Which repositories SaveBell monitors.">
          <RepositoriesPanel sp={sp} embedded />
        </Section>

        <Section id="connect-agent" title="Connect AI agent" desc="Connect your coding agent via MCP.">
          <ConnectAgent endpoint={`${env.APP_URL}/api/mcp`} create={createAgentTokenAction} />
          {tokens.length > 0 && (
            <ul className="border hair rounded-[8px] text-[calc(13px*var(--ui))]">
              {tokens.map((t) => (
                <li key={t.hash} className="flex items-center justify-between gap-3 px-3 py-2 border-b hair last:border-0">
                  <span><span className="font-medium">{t.label}</span> <span className="text-ink2">· connected {fmt(t.created_at)} · last used {fmt(t.last_used_at)}</span></span>
                  <form action={revokeAgentTokenAction}><input type="hidden" name="hash" value={t.hash} /><button type="submit" className="btn-ghost btn-danger">Disconnect</button></form>
                </li>
              ))}
            </ul>
          )}
          <More><p>Works with Meta Muse Code, Claude Code, Codex or any MCP-capable agent, using your own AI plan. Through MCP your agent can read alerts and the cited code and report what it finds; SaveBell re-checks every line it cites. It cannot push code: changes stay in your editor until you approve them there. The connection key is shown once and can be revoked here with Disconnect.</p></More>
        </Section>

        <Section id="remediation" title="Automatic remediation">
          <form action={saveRemediationMode} className="grid gap-2 text-[calc(14px*var(--ui))]">
            <fieldset className="grid gap-2"><legend className="sr-only">After a fix is validated</legend>
              {REMEDIATION_MODES.map((m) => (
                <label key={m.id} className="flex items-start gap-2"><input type="radio" name="remediation_mode" value={m.id} defaultChecked={modeOf(user.settings) === m.id} className="mt-1" /><span><b>{m.title}</b>{m.id === "pr" ? " (default)" : ""}<span className="block text-[calc(13px*var(--ui))] text-ink2">{m.short}</span></span></label>
              ))}
            </fieldset>
            <button type="submit" className="btn w-fit">Save</button>
          </form>
          <More label="How it works"><ul className="list-disc pl-5 grid gap-1">
            <li>This setting only chooses the destination. Every repository change still needs your explicit approval of the exact patch.</li>
            <li>Muse Code prepares and validates the patch in an isolated runner first; nothing is written before you approve.</li>
            <li>Draft PRs are never merged automatically.</li>
            <li>Push to branch creates a new branch, respects branch protection, and never modifies your default branch.</li>
            <li>The repository must also allow changes on Repositories, and the GitHub App needs write access; with &quot;No repository writes&quot; neither is needed.</li>
          </ul></More>
        </Section>

        <span id="windows" aria-hidden />
        <Section id="runs" title="Automatic fix runs" desc="SaveBell checks issues and prepares fixes on a schedule. Start one now from Threats.">
          <RemediationWindows userId={user.id} />
          <More label="Safety limits"><ul className="list-disc pl-5 grid gap-1">
            <li>Check issues and Prepare fixes never write to your repositories. Each fix waits for your approval.</li>
            <li>Create draft PRs needs your authorization for each run. GitHub write access and passing tests are re-checked before every PR. PRs are never merged.</li>
            <li>Issue count, fixes at once, spending limit and end time are enforced on the server.</li>
            <li>Runs start and stop on the scheduler, about every 5 minutes.</li>
          </ul></More>
        </Section>

        <Section title={d.notifications}>
          <form action={saveSettings} className="grid gap-3 text-[calc(14px*var(--ui))]">
            <label className="flex items-center gap-2"><input type="checkbox" name="inapp" defaultChecked={user.settings.inapp !== false} /> {d.inapp_label}</label>
            <label className="grid gap-1">{d.webhook_label}
              <input name="webhook_url" defaultValue={masked} placeholder="https://hooks.slack.com/services/…" aria-describedby="webhook-help" className="border hair rounded-[6px] px-3 h-9 bg-transparent text-[calc(14px*var(--ui))]" />
            </label>
            <label className="grid gap-1 w-fit">{d.push_threshold_label}
              <select name="push_min_severity" defaultValue={user.settings.push_min_severity ?? "low"} className="border hair rounded-[6px] px-2 h-9 bg-transparent text-[calc(14px*var(--ui))]">
                <option value="low">{d.push_threshold_all}</option><option value="moderate">{d.push_threshold_moderate}</option><option value="high">{d.push_threshold_high}</option><option value="critical">{d.push_threshold_critical}</option>
              </select>
            </label>
            <button className="btn w-fit" type="submit">{d.save}</button>
          </form>
          <div className="grid gap-1 text-[calc(14px*var(--ui))]"><div className="font-medium">{d.browser_push}</div><PushToggle vapidPublicKey={env.VAPID_PUBLIC_KEY} enabled={user.settings.push && subs.length > 0} />{subs.length > 0 && <p className="text-[calc(12px*var(--ui))] text-ink2">{subs.length} {d.devices_subscribed}</p>}</div>
          <More><div id="webhook-help" className="grid gap-1"><p>The webhook is optional, stored server-side and shown masked; only Slack and Discord incoming-webhook URLs are accepted.</p><p>Browser push needs VAPID keys on this deployment{env.VAPID_PUBLIC_KEY ? "" : " (not set here)"}. Once enabled, alerts arrive while the browser is running, even with the tab in the background. If the browser is fully closed, the notification is delivered the next time it starts, as long as that is within one hour; after that it is dropped and the alert stays in SaveBell.</p></div></More>
        </Section>

        {env.DEMO_SHARED_REPOS && (
          <Section id="demo" title="Shared demo">
            <form action={saveDemoPrefs} className="grid gap-2 text-[calc(14px*var(--ui))]">
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

      </div>
    </div>
  );
}
