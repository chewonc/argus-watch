"use client";
// "Suggest a source" (Sources page): name, URL, optional description. The server checks it automatically and answers
// with the outcome and each check, so the user sees exactly why a source was added, queued or refused.
import { useEffect, useId, useRef, useState } from "react";

type Check = { name: string; ok: boolean | null; detail: string };
type Result = { status: "registered" | "needs_review" | "rejected" | "duplicate"; reason: string; checks: Check[]; name: string };
const HEAD: Record<Result["status"], { text: string; tone: string }> = {
  registered: { text: "Added to monitoring", tone: "tone-ok" },
  needs_review: { text: "Sent for review", tone: "tone-warn" },
  rejected: { text: "Not added", tone: "tone-bad" },
  duplicate: { text: "Already covered", tone: "text-ink2" },
};

export function SuggestSource({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { if (open) ref.current?.showModal(); }, [open]);
  const close = () => { ref.current?.close(); setOpen(false); setErr(null); setRes(null); };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/sources/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.get("name"), url: f.get("url"), description: f.get("description"), website: f.get("website") }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? "Couldn't send the suggestion."); else setRes(j.suggestion);
    } catch { setErr("Couldn't send the suggestion. Check your connection and try again."); }
    setBusy(false);
  };
  if (!signedIn) return <p className="text-[calc(13px*var(--ui))] text-ink2">Sign in to suggest a source.</p>;
  return (
    <>
      <button type="button" className="btn w-fit" onClick={() => setOpen(true)}>Suggest a source</button>
      {open && (
        <dialog ref={ref} aria-labelledby={id} onClose={close} onClick={(e) => { if (e.target === ref.current) close(); }}
          className="m-auto w-[min(calc(500px*var(--ui)),calc(100vw-32px))] rounded-[12px] border hair bg-raised text-ink p-0 backdrop:bg-black/40">
          <div className="grid gap-3 p-5 text-[calc(13px*var(--ui))]">
            <div className="flex items-center justify-between gap-3"><h2 id={id} className="text-[calc(16px*var(--ui))] font-semibold">Suggest a source</h2><button type="button" aria-label="Close" className="text-ink2 text-[calc(22px*var(--ui))] w-10 h-10 -mr-2 grid place-items-center" onClick={close}>×</button></div>
            {res ? (
              <div className="grid gap-3" role="status">
                <p className={`text-[calc(15px*var(--ui))] font-semibold ${HEAD[res.status].tone}`}>{HEAD[res.status].text}: {res.name}</p>
                <p>{res.reason}</p>
                <ul className="grid gap-1">{res.checks.map((c) => <li key={c.name} className="flex gap-2"><span aria-hidden className={c.ok === true ? "tone-ok" : c.ok === false ? "tone-bad" : "text-ink2"}>{c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}</span><span>{c.name} <span className="text-ink2">({c.detail})</span></span></li>)}</ul>
                <div className="flex justify-end"><button type="button" className="btn" onClick={close}>OK</button></div>
              </div>
            ) : (
              <form onSubmit={submit} className="grid gap-3">
                <p className="text-ink2">Security research, AI-safety feeds, vulnerability databases or advisories. Sources with an RSS or Atom feed that allow automated reading are added automatically; others are reviewed.</p>
                <label className="grid gap-1">Source name<input name="name" required maxLength={120} placeholder="e.g. Example Lab security blog" className="border hair rounded-[6px] px-3 h-10 bg-transparent text-[calc(14px*var(--ui))]" /></label>
                <label className="grid gap-1">URL<input name="url" type="url" required maxLength={2000} placeholder="Feed or website address" className="border hair rounded-[6px] px-3 h-10 bg-transparent text-[calc(14px*var(--ui))]" /></label>
                <label className="grid gap-1">Description (optional)<textarea name="description" maxLength={1000} rows={2} className="border hair rounded-[6px] px-3 py-2 bg-transparent text-[calc(14px*var(--ui))]" /></label>
                <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
                {err && <p role="alert" className="tone-bad">{err}</p>}
                <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={close}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Checking the source…" : "Submit"}</button></div>
              </form>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
