"use client";
// "Found something we missed? Report a threat": a small modal that posts to /api/threat-report. Reports are reviewed
// before they can become alerts; nothing is published or verified automatically.
import { useEffect, useId, useRef, useState } from "react";

export function ReportThreat() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { if (open) ref.current?.showModal(); }, [open]);
  const close = () => { ref.current?.close(); setOpen(false); setMsg(null); };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/threat-report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: f.get("url"), description: f.get("description"), website: f.get("website") }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, text: j.message ?? "Thanks. We'll review it." } : { ok: false, text: j.error ?? "Couldn't send the report. Try again." });
    } catch { setMsg({ ok: false, text: "Couldn't send the report. Check your connection and try again." }); }
    setBusy(false);
  };
  return (
    <>
      <p className="text-[calc(14px*var(--ui))] text-ink2">Found something we missed? <button type="button" className="underline text-ink" onClick={() => setOpen(true)}>Report a threat →</button></p>
      {open && (
        <dialog ref={ref} aria-labelledby={id} onClose={close} onClick={(e) => { if (e.target === ref.current) close(); }}
          className="m-auto w-[min(480px,calc(100vw-32px))] rounded-[12px] border hair bg-raised text-ink p-0 backdrop:bg-black/40">
          <form onSubmit={submit} className="grid gap-3 p-5">
            <div className="flex items-center justify-between gap-3"><h2 id={id} className="text-[calc(16px*var(--ui))] font-semibold">Report a threat</h2><button type="button" aria-label="Close" className="text-ink2 text-[calc(22px*var(--ui))] w-10 h-10 -mr-2 grid place-items-center" onClick={close}>×</button></div>
            <p className="text-[calc(13px*var(--ui))] text-ink2">Help us track emerging security and AI-related threats.</p>
            <label className="grid gap-1 text-[calc(13px*var(--ui))]">Threat URL
              <input name="url" type="url" required maxLength={2000} placeholder="Paste a link to an advisory, research paper, or report" className="border hair rounded-[6px] px-3 h-10 bg-transparent text-[calc(14px*var(--ui))]" />
            </label>
            <label className="grid gap-1 text-[calc(13px*var(--ui))]">Description (optional)
              <textarea name="description" maxLength={1000} rows={3} placeholder="Briefly describe the threat" className="border hair rounded-[6px] px-3 py-2 bg-transparent text-[calc(14px*var(--ui))]" />
            </label>
            {/* honeypot: hidden from people, filled by bots */}
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
            {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[calc(13px*var(--ui))] ${msg.ok ? "tone-ok" : "tone-bad"}`}>{msg.text}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={close}>{msg?.ok ? "Close" : "Cancel"}</button>
              {!msg?.ok && <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Submit report"}</button>}
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
