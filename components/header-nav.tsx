"use client";
// Header: Alerts, the notification bell, and the account menu (avatar + login). Signed out: sign in.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { signInWithGitHub, signOut } from "@/lib/auth-client";

export type HeaderUser = { id: string; login: string; avatar: string | null } | null;
export type HeaderLabels = { alerts: string; repos: string; monitoring: string; activity: string; settings: string; notifications: string; signIn: string; signOut: string; notConfigured: string };

export function HeaderNav({ user, authReady, labels, locale = "en", languages = [] }: { user: HeaderUser; authReady: boolean; labels: HeaderLabels; locale?: string; languages?: { code: string; name: string }[] }) {
  const path = usePathname();
  const active = path.startsWith("/alerts") || path.startsWith("/case");
  return (
    <nav className="flex items-center gap-3 sm:gap-4 text-[13px]">
      {languages.length > 1 && <LanguageSwitcher current={locale} languages={languages} compact />}
      {user && <Link href="/alerts" aria-current={active ? "page" : undefined} className={`no-underline ${active ? "font-semibold" : "text-ink2 hover:text-ink"}`}>{labels.alerts}</Link>}
      {user && <NotificationBell label={labels.notifications} />}
      {user ? <AccountMenu user={user} labels={labels} /> : authReady ? (
        <button type="button" className="btn" onClick={() => signInWithGitHub(path === "/" ? "/alerts" : path)}>{labels.signIn}</button>
      ) : (
        <span className="text-ink2 text-[12px]" title="Set BETTER_AUTH_SECRET, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET">{labels.notConfigured}</span>
      )}
    </nav>
  );
}

function AccountMenu({ user, labels }: { user: NonNullable<HeaderUser>; labels: HeaderLabels }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) { setSeenPath(path); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const list = items(); const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div ref={wrap} className="relative" onKeyDown={onKey}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${user.login}`} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-[var(--sunken)] cursor-pointer">
        {user.avatar ? <img src={user.avatar} alt="" width={24} height={24} className="rounded-full" /> /* eslint-disable-line @next/next/no-img-element -- GitHub avatar */
          : <span aria-hidden className="w-6 h-6 rounded-full bg-[var(--sunken)] grid place-items-center text-[11px] font-semibold">{user.login.slice(0, 1).toUpperCase()}</span>}
        <span className="text-[13px] max-sm:hidden">{user.login}</span>
        <span aria-hidden className="text-ink2 text-[10px]">▾</span>
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="menu">
          <div className="px-[10px] py-2 text-[12px] text-ink2 border-b hair mb-1">Signed in as <span className="text-ink font-medium">{user.login}</span></div>
          <Item href="/repos">{labels.repos}</Item>
          <Item href="/monitoring">{labels.monitoring}</Item>
          <Item href="/activity">{labels.activity}</Item>
          <Item href="/settings#connect-agent">Connect AI agent</Item>
          <Item href="/settings">{labels.settings}</Item>
          <div className="border-t hair my-1" />
          <button role="menuitem" tabIndex={-1} type="button" onClick={() => signOut().then(() => { router.push("/"); router.refresh(); })}>{labels.signOut}</button>
        </div>
      )}
    </div>
  );
}

function Item({ href, children }: { href: string; children: React.ReactNode }) { return <Link role="menuitem" tabIndex={-1} href={href}>{children}</Link>; }
