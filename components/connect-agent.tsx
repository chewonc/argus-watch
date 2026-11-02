"use client";
// "Connect AI agent": creates a personal token once and shows the one command to paste into the user's agent.
import { useState } from "react";

const AGENTS = ["Claude Code", "Codex", "Other"] as const;

export function ConnectAgent({ endpoint, create }: { endpoint: string; create: (label: string) => Promise<string> }) {
  const [agent, setAgent] = useState<(typeof AGENTS)[number]>("Claude Code");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const cmd = !token ? "" : agent === "Claude Code"
    ? `claude mcp add --transport http argus-watch ${endpoint} --header "Authorization: Bearer ${token}"`
    : agent === "Codex"
      ? `# ~/.codex/config.toml\n[mcp_servers.argus-watch]\nurl = "${endpoint}"\nbearer_token_env_var = "ARGUS_WATCH_TOKEN"\n\n# then, in your shell:\nexport ARGUS_WATCH_TOKEN=${token}`
      : `URL:    ${endpoint}\nHeader: Authorization: Bearer ${token}\n(Streamable HTTP MCP server)`;
  return (
    <div className="grid gap-4">
      <div className="seg w-fit" role="tablist" aria-label="Your AI agent">
        {AGENTS.map((a) => <a key={a} role="tab" href="#" aria-selected={a === agent} aria-current={a === agent ? "page" : undefined} onClick={(e) => { e.preventDefault(); setAgent(a); setCopied(false); }}>{a}</a>)}
      </div>
      {!token ? (
        <button type="button" className="btn w-fit" disabled={busy} onClick={async () => { setBusy(true); try { setToken(await create(agent)); } finally { setBusy(false); } }}>{busy ? "Creating…" : `Connect ${agent === "Other" ? "an agent" : agent}`}</button>
      ) : (
        <div className="grid gap-2">
          <p className="text-[13px]">{agent === "Claude Code" ? "Run this once in your terminal:" : agent === "Codex" ? "Add this to your Codex config:" : "Use these settings in your agent:"}</p>
          <pre className="mono text-[12px] whitespace-pre-wrap break-all border hair rounded-[8px] bg-[var(--sunken)] p-3">{cmd}</pre>
          <div className="flex items-center gap-3">
            <button type="button" className="btn-ghost" onClick={() => navigator.clipboard.writeText(cmd).then(() => setCopied(true)).catch(() => {})}>{copied ? "Copied" : "Copy"}</button>
            <span className="text-[12px] text-ink2">This key is shown only once. It can only read your alerts and report results, never change your code.</span>
          </div>
        </div>
      )}
    </div>
  );
}
