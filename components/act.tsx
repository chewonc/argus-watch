"use client";
// Act section controls: copy the brief to the clipboard, download it, show the Codex command.
import { useState } from "react";

export function ActControls({ briefPath, verdict, codexCmd }: { briefPath: string; verdict: string; codexCmd: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [agent, setAgent] = useState<"claude" | "codex">("claude");
  const [fallback, setFallback] = useState<string | null>(null);
  async function copy() {
    setState("copying"); setFallback(null);
    let md = "";
    try {
      const r = await fetch(`${briefPath}?agent=${agent}`);
      if (!r.ok) throw new Error(`brief ${r.status}`);
      md = await r.text();
    } catch { setState("failed"); return; }
    try {
      await navigator.clipboard.writeText(md);
      setState("copied"); setTimeout(() => setState("idle"), 2500);
    } catch {
      // Clipboard blocked (permissions / non-secure context): show the text selected for manual copy.
      setFallback(md); setState("idle");
    }
  }
  const primary = verdict === "Affected" ? "Copy remediation prompt" : "Copy prompt to confirm conditions";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={copy} disabled={state === "copying"} className="px-3 py-1.5 rounded-[4px] text-[13px] font-medium text-white" style={{ background: "var(--accent)" }}>
          {state === "copied" ? "Copied" : state === "copying" ? "Preparing…" : state === "failed" ? "Copy failed. Use Download" : `${primary} for ${agent === "claude" ? "Claude Code" : "Codex"}`}
        </button>
        <select value={agent} onChange={(e) => setAgent(e.target.value as "claude" | "codex")} className="px-2 py-1.5 rounded-[4px] border hair bg-raised text-[13px]" aria-label="Target agent">
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
        <a href={`${briefPath}?agent=${agent}&download=1`} className="px-3 py-1.5 rounded-[4px] border hair text-[13px] no-underline">Download REMEDIATION.md</a>
      </div>
      {fallback && (
        <div>
          <div className="text-[12px] text-ink2 mb-1">Clipboard access was blocked by the browser. The prompt is selected below; press Ctrl/Cmd+C.</div>
          <textarea readOnly value={fallback} ref={(el) => el?.select()} className="mono text-[12px] w-full h-48 p-3 border hair rounded-[4px] bg-raised" />
        </div>
      )}
      <details>
        <summary className="label cursor-pointer">Run it from a terminal</summary>
        <pre className="mono text-[12px] mt-2 p-3 border hair rounded-[4px] bg-raised overflow-auto">{agent === "claude"
          ? `# in your checkout of the repository\nclaude -p "$(cat REMEDIATION.md)"   # review each change before accepting`
          : codexCmd}</pre>
        <p className="text-[12px] text-ink2 mt-1">The prompt is prefilled, never auto-sent. The agent runs on your machine under your permissions; Argus Watch holds no write access to your repository.</p>
      </details>
    </div>
  );
}
