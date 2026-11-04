"use client";
// "Check with your AI agent": one copyable request for the user's connected agent (Meta Muse Code, Claude Code, Codex, ...).
// The agent reads this alert through the Argus connection, checks the user's checkout, and reports back.
import Link from "next/link";
import { useState } from "react";

export function AskAgent({ id, connected, verified }: { id: string; connected: boolean; verified: boolean }) {
  const [copied, setCopied] = useState(false);
  const prompt = verified
    ? `Use Argus Watch to look at alert ${id}. Check the affected code in this repository, explain the problem, and propose a fix. Don't change or commit anything until I approve it. Then report your result back to Argus Watch.`
    : `Use Argus Watch to check alert ${id}: does it really affect this repository? Read the relevant code, cite the exact lines, and report your result back to Argus Watch. Don't change any code.`;
  return (
    <section className="border hair rounded-[10px] bg-raised p-4 grid gap-2">
      <h2 className="text-[14px] font-semibold">{verified ? "Fix it with your AI agent" : "Check it with your AI agent"}</h2>
      {connected ? (
        <>
          <p className="text-[13px] text-ink2">Paste this into Meta Muse Code, Claude Code or Codex, opened in your copy of the repository.</p>
          <pre className="mono text-[12px] whitespace-pre-wrap border hair rounded-[8px] bg-[var(--sunken)] p-3">{prompt}</pre>
          <button type="button" className="btn-ghost w-fit" onClick={() => navigator.clipboard.writeText(prompt).then(() => setCopied(true)).catch(() => {})}>{copied ? "Copied" : "Copy request"}</button>
        </>
      ) : (
        <p className="text-[13px] text-ink2">{verified ? "Your AI coding agent can propose a fix in your editor." : "Your AI coding agent can check whether this really affects your code."} <Link href="/settings#connect-agent" className="text-ink underline">Connect an AI agent</Link> once to use it here.</p>
      )}
    </section>
  );
}
