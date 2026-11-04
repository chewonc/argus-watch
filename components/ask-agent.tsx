"use client";
// "Fix or verify with your AI agent": one copyable request for the user's connected agent (Meta Muse Code, Claude Code, Codex, ...).
// The agent reads this alert through the Argus connection, checks the user's checkout, and reports back. The request text
// depends on the assessment: confirmed findings may get a proposed fix (nothing changes until the user approves);
// unconfirmed ones get read-only verification only. The full request is hidden behind Preview; Copy always copies all of it.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type AskAgentLabels = { title: string; leadFix: string; leadVerify: string; copy: string; copied: string; preview: string };
const DEFAULT: AskAgentLabels = { title: "Fix or verify with your AI agent", leadFix: "Your coding agent reads this finding through Argus, checks your copy of the code and proposes a fix. Nothing is changed until you approve it.", leadVerify: "Your coding agent reads this finding through Argus and checks whether it really affects your code. It does not change any code.", copy: "Copy instructions", copied: "Copied", preview: "Preview" };

export function agentPrompt(id: string, verified: boolean) {
  return verified
    ? `Use Argus Watch to look at alert ${id}. Check the affected code in this repository, explain the problem, and propose a fix. Don't change or commit anything until I approve it. Then report your result back to Argus Watch.`
    : `Use Argus Watch to check alert ${id}: does it really affect this repository? Read the relevant code, cite the exact lines, and report your result back to Argus Watch. Don't change any code.`;
}

export function AskAgent({ id, connected, verified, labels = DEFAULT }: { id: string; connected: boolean; verified: boolean; labels?: AskAgentLabels }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const pid = useId();
  const copyBtn = useRef<HTMLButtonElement>(null);
  const prompt = agentPrompt(id, verified);
  // Arriving from a "Verify" action (?verify=1): show the read-only request and put focus on Copy.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("verify") !== "1") return;
    const r = requestAnimationFrame(() => { setOpen(true); copyBtn.current?.closest("details")?.setAttribute("open", ""); copyBtn.current?.scrollIntoView({ block: "center" }); copyBtn.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <section className="border hair rounded-[10px] bg-raised p-4 grid gap-2" aria-labelledby={`${pid}-h`}>
      <h3 id={`${pid}-h`} className="text-[14px] font-semibold">{labels.title}</h3>
      <p className="text-[13px] text-ink2">{verified ? labels.leadFix : labels.leadVerify}</p>
      {connected ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button ref={copyBtn} type="button" className="btn-ghost" onClick={() => navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => {})}>
              {copied ? labels.copied : labels.copy}
            </button>
            <span className="sr-only" role="status" aria-live="polite">{copied ? labels.copied : ""}</span>
            <button type="button" className="btn-ghost" aria-expanded={open} aria-controls={`${pid}-p`} onClick={() => setOpen((o) => !o)}>
              {labels.preview} <span aria-hidden className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
            </button>
          </div>
          <pre id={`${pid}-p`} hidden={!open} className="mono text-[12px] whitespace-pre-wrap [overflow-wrap:anywhere] border hair rounded-[8px] bg-[var(--sunken)] p-3">{prompt}</pre>
          <p className="text-[12px] text-ink2">Works with Meta Muse Code, Claude Code or Codex, opened in your copy of the repository.</p>
        </>
      ) : (
        <p className="text-[13px] text-ink2"><Link href="/settings#connect-agent" className="text-ink underline">Connect an AI agent</Link> once to use it here.</p>
      )}
    </section>
  );
}
