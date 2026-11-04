"use client";
// AI Agent tab of the Fix modal: one copyable request for the user's coding agent (Meta Muse Code, Claude Code, Codex, ...)
// connected to Argus Watch over MCP. The agent reads the finding through the Argus MCP tools (list_findings, get_finding,
// get_file_context), checks the user's checkout and reports back with report_result. The request text depends on the
// assessment: confirmed findings may get a proposed fix (nothing changes until the user approves); unconfirmed ones get
// read-only verification only. Setup (endpoint, token, per-agent commands) lives on Settings → Connect AI agent.
import { useState } from "react";

export type AskAgentLabels = { lead: string; copy: string; copied: string; setup: string; foot: string };
const DEFAULT: AskAgentLabels = { lead: "Connect your coding agent to Argus Watch via MCP to read findings and the affected code, verify them in your repository, and report results or proposed fixes back.", copy: "Copy instructions", copied: "Copied", setup: "Set up MCP", foot: "Your agent works in your repository. No code changes without your approval." };

export function agentPrompt(id: string, verified: boolean) {
  return verified
    ? `Use Argus Watch to look at alert ${id}. Check the affected code in this repository, explain the problem, and propose a fix. Don't change or commit anything until I approve it. Then report your result back to Argus Watch.`
    : `Use Argus Watch to check alert ${id}: does it really affect this repository? Read the relevant code, cite the exact lines, and report your result back to Argus Watch. Don't change any code.`;
}

export function AskAgent({ id, connected, verified, labels = DEFAULT }: { id: string; connected: boolean; verified: boolean; labels?: AskAgentLabels }) {
  const [copied, setCopied] = useState(false);
  const prompt = agentPrompt(id, verified);
  return (
    <div className="grid gap-3 text-[13px]">
      <p className="text-[14px]">{labels.lead}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => {})}>
          {copied ? labels.copied : labels.copy}
        </button>
        <span className="sr-only" role="status" aria-live="polite">{copied ? labels.copied : ""}</span>
        {/* New tab, so the modal stays as it is here. */}
        <a href="/settings#connect-agent" target="_blank" rel="noreferrer" className="btn-ghost no-underline">{labels.setup} <span aria-hidden>↗</span><span className="sr-only"> (opens in a new tab)</span></a>
      </div>
      {!connected && <p className="text-ink2">No agent is connected yet: set up MCP once, then paste the instructions into your agent.</p>}
      <p className="text-ink2">{labels.foot}</p>
    </div>
  );
}
