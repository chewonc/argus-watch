"use client";
// Completion confirmation for Verify and Fix: what happened, whether it worked, what happens next. Closes only with OK
// (or Escape, which the browser treats the same way); results and the underlying UI state stay as they were.
import { useEffect, useId, useRef } from "react";

import type { ResultInfo } from "@/lib/fix-summary";
export type { ResultInfo };

export function ResultDialog({ info, onOk }: { info: ResultInfo; onOk: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const okCb = useRef(onOk);
  useEffect(() => { okCb.current = onOk; });
  useEffect(() => {
    const d = ref.current; if (!d) return;
    const h = () => okCb.current();
    d.addEventListener("close", h); d.showModal();
    return () => d.removeEventListener("close", h);
  }, []);
  const glyph = info.tone === "ok" ? "✓" : info.tone === "bad" ? "✗" : "⚠";
  return (
    <dialog ref={ref} aria-labelledby={titleId} role="alertdialog"
      className="modal m-auto w-[min(calc(440px*var(--ui)),calc(100vw-32px))] rounded-[12px] border hair bg-raised text-ink p-0 backdrop:bg-black/40">
      <div className="grid gap-3 px-5 pt-5 pb-4 text-[calc(13px*var(--ui))]">
        <h2 id={titleId} className={`text-[calc(16px*var(--ui))] font-semibold tone-${info.tone}`}><span aria-hidden>{glyph}</span> {info.title}</h2>
        <p>{info.summary}</p>
        {info.points && info.points.length > 0 && <ul className="list-disc pl-5 grid gap-0.5 text-ink2">{info.points.map((p) => <li key={p}>{p}</li>)}</ul>}
        {info.next && <p className="text-ink2"><span className="font-medium text-ink">Next: </span>{info.next}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {info.link && <a className="btn-ghost no-underline" href={info.link.href} target="_blank" rel="noreferrer">{info.link.label} ↗</a>}
          <button type="button" className="btn" autoFocus onClick={() => ref.current?.close()}>OK</button>
        </div>
      </div>
    </dialog>
  );
}
