"use client";
// AI Agent tab of the Fix modal: one copyable request for the user's coding agent (Meta Muse Code, Claude Code, Codex, ...)
// connected to Argus Watch over MCP. The agent reads the finding through the Argus MCP tools (list_findings, get_finding,
// get_file_context), checks the user's checkout and reports back with report_result. The request text depends on the
// assessment: confirmed findings may get a proposed fix (nothing changes until the user approves); unconfirmed ones get
// read-only verification only. Setup (endpoint, token, per-agent commands) lives on Settings → Connect AI agent.
import { useId, useState } from "react";

export type AskAgentLabels = { title: string; lead: string; copy: string; copied: string; mcp: string; setup: string; foot: string };
const DEFAULT: AskAgentLabels = { title: "Use your own AI agent", lead: "Use Claude Code, Codex, or Muse Code to verify this finding or propose a fix in your repository.", copy: "Copy instructions", copied: "Copied", mcp: "You can also connect your AI agent to Argus Watch through MCP.", setup: "How to connect MCP", foot: "Your agent works in your repository. No code changes without your approval." };

export function agentPrompt(id: string, verified: boolean) {
  return verified
    ? `Use Argus Watch to look at alert ${id}. Check the affected code in this repository, explain the problem, and propose a fix. Don't change or commit anything until I approve it. Then report your result back to Argus Watch.`
    : `Use Argus Watch to check alert ${id}: does it really affect this repository? Read the relevant code, cite the exact lines, and report your result back to Argus Watch. Don't change any code.`;
}

export function AskAgent({ id, verified, labels = DEFAULT }: { id: string; connected?: boolean; verified: boolean; labels?: AskAgentLabels }) {
  const [copied, setCopied] = useState(false);
  const pid = useId();
  const prompt = agentPrompt(id, verified);
  return (
    <div className="grid gap-3 text-[calc(13px*var(--ui))]">
      <div className="grid gap-1">
        <h3 className="text-[calc(14px*var(--ui))] font-semibold">{labels.title}</h3>
        <p className="text-ink2">{labels.lead}</p>
      </div>
      <div>
        <button type="button" className="btn" aria-describedby={pid} onClick={() => navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => {})}>
          {copied ? labels.copied : labels.copy}
        </button>
        <span className="sr-only" role="status" aria-live="polite">{copied ? labels.copied : ""}</span>
      </div>
      {/* Exactly the text Copy puts on the clipboard (same variable), always visible and selectable. */}
      <pre id={pid} className="mono text-[calc(12px*var(--ui))] whitespace-pre-wrap [overflow-wrap:anywhere] border hair rounded-[8px] bg-[var(--sunken)] p-3 max-h-[calc(160px*var(--ui))] overflow-auto">{prompt}</pre>
      <p className="text-ink2">{labels.mcp} <a href="/settings#connect-agent" target="_blank" rel="noreferrer">{labels.setup} <span aria-hidden>↗</span><span className="sr-only"> (opens in a new tab)</span></a></p>
      <p className="text-ink2">{labels.foot}</p>
    </div>
  );
}
