"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="btn-ghost" disabled={busy} onClick={async () => { setBusy(true); await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) }); setBusy(false); router.refresh(); }}>Mark all read</button>;
}
