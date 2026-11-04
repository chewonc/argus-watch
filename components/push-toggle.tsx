"use client";
// Browser push opt-in with a pre-prompt (the browser permission dialog only opens after the user clicks).
import { useEffect, useState } from "react";

function b64ToU8(b64: string) { const pad = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }

export function PushToggle({ vapidPublicKey, enabled }: { vapidPublicKey: string; enabled: boolean }) {
  const [state, setState] = useState<"unsupported" | "denied" | "off" | "on" | "busy">("off");
  useEffect(() => {
    let alive = true;
    const detect = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const sub = await navigator.serviceWorker.getRegistration("/sw.js").then((r) => r?.pushManager.getSubscription()).catch(() => null);
      return sub && enabled ? ("on" as const) : ("off" as const);
    };
    detect().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, [enabled]);
  async function enable() {
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(vapidPublicKey) as BufferSource });
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      setState(r.ok ? "on" : "off");
    } catch { setState("off"); }
  }
  async function disable() {
    setState("busy");
    try { const reg = await navigator.serviceWorker.getRegistration("/sw.js"); const sub = await reg?.pushManager.getSubscription(); if (sub) { await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); } } finally { setState("off"); }
  }
  const [test, setTest] = useState<string | null>(null);
  async function sendTest() {
    setTest("Sending…");
    try { const r = await fetch("/api/push/test", { method: "POST" }); const j = await r.json().catch(() => ({})); setTest(r.ok ? `Sent to ${j.sent} device${j.sent === 1 ? "" : "s"}. It should appear in a few seconds.` : (j.error ?? "Could not send a test notification.")); }
    catch { setTest("Could not send a test notification."); }
  }
  if (!vapidPublicKey) return <p className="text-[13px] text-ink2">Not configured</p>;
  if (state === "unsupported") return <p className="text-[13px] text-ink2">This browser does not support Web Push. On iOS, add the site to the Home Screen first (iOS 16.4+).</p>;
  if (state === "denied") return <p className="text-[13px] text-ink2">Notifications are blocked for this site in the browser settings; allow them there to enable push.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      {state === "on" && <button className="btn" onClick={sendTest}>Send test notification</button>}
      {state === "on" ? <button className="btn-ghost" onClick={disable}>Disable browser push on this device</button> : <button className="btn" onClick={enable} disabled={state === "busy"}>{state === "busy" ? "…" : "Enable browser push on this device"}</button>}
      {test && <span role="status" className="text-ink2">{test}</span>}
      <span className="text-ink2">The browser asks once. One notification per new alert; a changed verdict re-notifies.</span>
    </div>
  );
}
