"use client";
// Any server error on a page: say what happened in plain words and offer a retry. Details stay in the server log.
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 grid gap-4">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Something went wrong loading this page</h1>
      <p className="text-[15px] text-ink2">Your repositories and alerts are safe; nothing was changed. This is usually a temporary problem reaching GitHub or our storage.</p>
      {error.digest && <p className="mono text-[12px] text-ink2">Reference: {error.digest}</p>}
      <div className="flex gap-2"><button className="btn" onClick={() => reset()}>Try again</button><Link href="/alerts" className="btn-ghost">Go to alerts</Link></div>
    </div>
  );
}
