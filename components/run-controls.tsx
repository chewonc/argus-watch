"use client";
// Live controls for an active remediation window: pause, resume, cancel, check now. Refreshes the page every 30
// seconds while the run is active so progress shows without reloading.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function RunControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const active = status === "running" || status === "paused" || status === "finishing";
  useEffect(() => { if (!active) return; const t = setInterval(() => router.refresh(), 30e3); return () => clearInterval(t); }, [active, router]);
  async function act(action: string) {
    if (action === "cancel" && !confirm("Cancel this window? Running tests are stopped. Patches already validated stay available for review.")) return;
    setBusy(action); setMsg(null);
    const r = await fetch(`/api/windows/runs/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; did?: string[] };
    setBusy(null);
    if (!r.ok) setMsg(j.error ?? "That did not work.");
    else if (action === "step") setMsg(j.did?.length ? `Done: ${j.did.join("; ")}` : "Nothing new to do right now.");
    router.refresh();
  }
  if (!active) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "running" && <button type="button" className="btn" disabled={!!busy} onClick={() => act("pause")}>{busy === "pause" ? "Pausing…" : "Pause"}</button>}
      {status === "paused" && <button type="button" className="btn" disabled={!!busy} onClick={() => act("resume")}>{busy === "resume" ? "Resuming…" : "Resume"}</button>}
      <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => act("step")}>{busy === "step" ? "Checking…" : "Check now"}</button>
      <button type="button" className="btn btn-ghost btn-danger" disabled={!!busy} onClick={() => act("cancel")}>{busy === "cancel" ? "Cancelling…" : "Cancel window"}</button>
      {msg && <span role="status" className="text-[calc(13px*var(--ui))] text-ink2">{msg}</span>}
    </div>
  );
}
