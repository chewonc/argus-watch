"use client";
// Notification bell: unread badge (polled every 30 s and on tab focus), a compact panel with the latest alerts,
// per-item and all-read actions, and a link to the full history. Opening an item marks it read.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type N = { id: string; display_title: string; title: string; repo: string; notified_at: string; read_at: string | null; href: string; status: { label: string; glyph: string; tone: string } | null };

const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const post = (body: unknown) => fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : null));

export function NotificationBell({ label }: { label: string }) {
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<N[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const count = useCallback(() => fetch("/api/notifications?count=1").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setUnread(j.unread ?? 0); }).catch(() => {}), []);
  const load = useCallback(() => fetch("/api/notifications?n=8").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { setList(j.notifications); setUnread(j.unread ?? 0); } }).catch(() => setList([])), []);

  useEffect(() => {
    count();
    const t = setInterval(() => { if (document.visibilityState === "visible") (open ? load : count)(); }, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") count(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [count, load, open, path]);
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) { setSeenPath(path); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    load();
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, load]);

  const markOne = async (n: N) => { if (n.read_at) return; setList((l) => l?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null); const j = await post({ nids: [n.id] }); if (j) setUnread(j.unread); };
  const markAll = async () => { setList((l) => l?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null); const j = await post({ all: true }); if (j) setUnread(j.unread); router.refresh(); };

  return (
    <div ref={wrap} className="relative">
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={unread ? `${label}: ${unread} unread` : label} onClick={() => setOpen((o) => !o)}
        className="relative inline-flex items-center justify-center w-8 h-8 rounded-full text-ink2 hover:text-ink hover:bg-[var(--sunken)] cursor-pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="badge-quiet absolute top-0 right-0 translate-x-1/4 -translate-y-1/4" aria-hidden>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={label} className="menu !p-0 w-[380px] max-sm:!fixed max-sm:!left-3 max-sm:!right-3 max-sm:!top-[60px] max-sm:!w-auto flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b hair">
            <span className="text-[14px] font-semibold">{label}</span>
            {unread > 0 && <button type="button" onClick={markAll} className="text-[12px] text-ink2 hover:text-ink cursor-pointer">Mark all as read</button>}
          </div>
          <ul className="max-h-[min(420px,calc(100vh-180px))] overflow-auto overscroll-contain">
            {list === null && <li className="px-4 py-6 text-[13px] text-ink2">Loading…</li>}
            {list?.length === 0 && <li className="px-4 py-6 text-[13px] text-ink2">You&apos;re all caught up. New security alerts will show up here.</li>}
            {list?.map((n) => (
              <li key={n.id} className="border-b hair last:border-0">
                <Link href={n.href} onClick={() => { markOne(n); setOpen(false); }} className="flex gap-3 px-4 py-3 no-underline hover:bg-[var(--sunken)]">
                  <span aria-hidden className={`mt-[7px] w-2 h-2 rounded-full shrink-0 ${n.read_at ? "" : "bg-[var(--accent)]"}`} />
                  <span className="grid gap-0.5 min-w-0">
                    <span className={`text-[13px] leading-snug [overflow-wrap:anywhere] ${n.read_at ? "text-ink2" : "font-semibold"}`}>{n.display_title}</span>
                    <span className="text-[12px] text-ink2 flex flex-wrap gap-x-2">
                      {n.status && <span className={`tone-${n.status.tone}`}>{n.status.glyph} {n.status.label}</span>}
                      <span>{n.repo.split("/").slice(0, 2).join("/")}</span><span>{ago(n.notified_at)}</span>
                    </span>
                    {!n.read_at && <span className="sr-only">Unread</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block text-center text-[13px] py-3 border-t hair no-underline text-ink2 hover:text-ink">See all notifications</Link>
        </div>
      )}
    </div>
  );
}
