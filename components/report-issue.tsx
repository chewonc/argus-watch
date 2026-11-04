"use client";
// "Report an issue" (user menu): a bug report about Argus Watch itself, separate from "Report a threat". The current
// page URL is filled in automatically; a screenshot is optional and is downscaled in the browser before upload.
import { useEffect, useId, useRef, useState } from "react";

async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}

export function ReportIssueDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [page] = useState(() => (typeof window === "undefined" ? "" : window.location.href));
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const closeCb = useRef(onClose);
  useEffect(() => { closeCb.current = onClose; });
  useEffect(() => { const d = ref.current; if (!d) return; const h = () => closeCb.current(); d.addEventListener("close", h); d.showModal(); return () => d.removeEventListener("close", h); }, []);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      const file = f.get("screenshot");
      let screenshot: string | null = null;
      if (file instanceof File && file.size > 0) {
        if (!/^image\//.test(file.type)) throw new Error("The screenshot must be an image.");
        if (file.size > 10_000_000) throw new Error("The screenshot is too large (10 MB maximum).");
        screenshot = await shrink(file);
      }
      const r = await fetch("/api/issues", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: f.get("description"), steps: f.get("steps"), page_url: page, screenshot, website: f.get("website") }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Couldn't send the report.");
      setDone(j.id);
    } catch (x) { setErr(String((x as Error).message)); }
    setBusy(false);
  };
  return (
    <dialog ref={ref} aria-labelledby={id} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      className="m-auto w-[min(calc(500px*var(--ui)),calc(100vw-32px))] rounded-[12px] border hair bg-raised text-ink p-0 backdrop:bg-black/40">
      <div className="grid gap-3 p-5 text-[calc(13px*var(--ui))]">
        <div className="flex items-center justify-between gap-3"><h2 id={id} className="text-[calc(16px*var(--ui))] font-semibold">Report an issue</h2><button type="button" aria-label="Close" className="text-ink2 text-[calc(22px*var(--ui))] w-10 h-10 -mr-2 grid place-items-center" onClick={() => ref.current?.close()}>×</button></div>
        {done ? (
          <div className="grid gap-3" role="status">
            <p className="text-[calc(15px*var(--ui))] font-semibold tone-ok">✓ Thanks, your report was sent</p>
            <p className="text-ink2">Reference {done}. The Argus Watch team reviews every report.</p>
            <div className="flex justify-end"><button type="button" className="btn" autoFocus onClick={() => ref.current?.close()}>OK</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <p className="text-ink2">Something not working in Argus Watch? Tell us what happened. To report a security threat instead, use &quot;Report a threat&quot; on the home page.</p>
            <label className="grid gap-1">What went wrong?<textarea name="description" required minLength={5} maxLength={3000} rows={3} className="border hair rounded-[6px] px-3 py-2 bg-transparent text-[calc(14px*var(--ui))]" /></label>
            <label className="grid gap-1">Steps to reproduce (optional)<textarea name="steps" maxLength={3000} rows={2} placeholder={"1. Open…\n2. Click…"} className="border hair rounded-[6px] px-3 py-2 bg-transparent text-[calc(14px*var(--ui))]" /></label>
            <label className="grid gap-1">Screenshot (optional)<input name="screenshot" type="file" accept="image/*" className="text-[calc(13px*var(--ui))]" /></label>
            <p className="text-[calc(12px*var(--ui))] text-ink2 [overflow-wrap:anywhere]">Page: {page}</p>
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
            {err && <p role="alert" className="tone-bad">{err}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => ref.current?.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send report"}</button></div>
          </form>
        )}
      </div>
    </dialog>
  );
}
