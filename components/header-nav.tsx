"use client";
// Header, signed in:  [brand]  Threats(●)  ·········  🔔  chewonc ▾   (● while an automatic fix run is active)
//   Repositories: what code is monitored. Threats: security findings for that code (/alerts). The bell: what changed
//   (unread notifications). The account menu: other pages, settings, language, session.
// On phones the two primary links move into the account menu, whose trigger becomes ☰: [brand] ······ 🔔 ☰
// Signed out: the compact language selector (public pages stay switchable) and Sign in.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher, useLocaleSwitch, withCurrent, type Lang } from "@/components/language-switcher";
import { signInWithGitHub, signOut } from "@/lib/auth-client";
import { ReportIssueDialog } from "@/components/report-issue";

export type HeaderUser = { id: string; login: string; avatar: string | null } | null;
export type HeaderLabels = { threats: string; report: string; repos: string; monitoring: string; activity: string; settings: string; language: string; notifications: string; signIn: string; signOut: string; notConfigured: string };

const isThreats = (p: string) => p.startsWith("/alerts") || p.startsWith("/case") || p.startsWith("/runs");

export function HeaderNav({ user, authReady, labels, locale = "en", languages = [], windowActive = false }: { user: HeaderUser; authReady: boolean; labels: HeaderLabels; locale?: string; languages?: Lang[]; windowActive?: boolean }) {
  const path = usePathname();
  if (!user) return (
    <div className="flex items-center gap-3 text-[calc(13px*var(--ui))]">
      {languages.length > 1 && <LanguageSwitcher current={locale} languages={languages} compact />}
      {authReady ? <button type="button" className="btn" onClick={() => signInWithGitHub(path === "/" ? "/alerts" : path)}>{labels.signIn}</button>
        : <span className="text-ink2 text-[calc(12px*var(--ui))]" title="Set BETTER_AUTH_SECRET, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET">{labels.notConfigured}</span>}
    </div>
  );
  return (
    <div className="flex flex-1 items-center min-w-0 gap-6 sm:gap-8">
      <nav aria-label="Primary" className="max-sm:hidden flex items-center gap-6 text-[calc(13px*var(--ui))]">
        <Link href="/alerts" className="nav-link inline-flex items-center gap-1.5" aria-current={isThreats(path) ? "page" : undefined}>{labels.threats}{windowActive && <><span aria-hidden className="tone-ok text-[calc(9px*var(--ui))]">●</span><span className="sr-only">(a fix run is active)</span></>}</Link>
      </nav>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <NotificationBell label={labels.notifications} />
        <AccountMenu user={user} labels={labels} locale={locale} languages={languages} />
      </div>
    </div>
  );
}

function AccountMenu({ user, labels, locale, languages }: { user: NonNullable<HeaderUser>; labels: HeaderLabels; locale: string; languages: Lang[] }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "lang">("main");
  const [issue, setIssue] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const { value: lang, pending, choose } = useLocaleSwitch(locale);
  const langs = withCurrent(locale, languages);
  const langName = langs.find((l) => l.code === lang)?.name ?? lang;
  // Only items that are actually visible (the phone-only links are display:none on desktop) take part in arrow keys.
  const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]') ?? [])].filter((el) => el.getClientRects().length > 0);
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) { setSeenPath(path); setOpen(false); setView("main"); }
  const close = (focusButton = false) => { setOpen(false); setView("main"); if (focusButton) btn.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const list = items();
    (view === "lang" ? list.find((el) => el.getAttribute("aria-checked") === "true") ?? list[1] : list[0])?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, view]);
  const openLang = () => setView("lang");
  const backToMain = () => { setView("main"); requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>("[data-lang-item]")?.focus()); };
  const onKey = (e: React.KeyboardEvent) => {
    const list = items(); const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); if (view === "lang") backToMain(); else close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "ArrowRight" && (document.activeElement as HTMLElement)?.hasAttribute("data-lang-item")) { e.preventDefault(); openLang(); }
    else if (e.key === "ArrowLeft" && view === "lang") { e.preventDefault(); backToMain(); }
    else if (e.key === "Tab") close();
  };
  return (
    <div ref={wrap} className="relative" onKeyDown={onKey}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Menu and account for ${user.login}`} onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
        className="flex items-center gap-1.5 h-9 rounded-[6px] px-2 text-[calc(14px*var(--ui))] font-medium text-ink hover:bg-[var(--sunken)] cursor-pointer">
        <span className="max-sm:hidden max-w-[calc(160px*var(--ui))] truncate">{user.login}</span>
        <svg aria-hidden className="max-sm:hidden text-ink2" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
        <svg aria-hidden className="sm:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {open && view === "main" && (
        <div role="menu" aria-label="Account" className="menu">
          <div className="px-[calc(10px*var(--ui))] py-2 text-[calc(12px*var(--ui))] text-ink2 border-b hair mb-1">Signed in as <span className="text-ink font-medium">{user.login}</span></div>
          <Item href="/settings" current={path.startsWith("/settings")}>{labels.settings}</Item>
          <div className="sm:hidden">
            <Item href="/alerts" current={isThreats(path)}>{labels.threats}</Item>
          </div>
          <Item href="/monitoring" current={path.startsWith("/monitoring")}>{labels.monitoring}</Item>
          <Item href="/activity" current={path.startsWith("/activity")}>{labels.activity}</Item>
          <button role="menuitem" tabIndex={-1} type="button" onClick={() => { close(); setIssue(true); }}>{labels.report}</button>
          {langs.length > 1 && (
            <button role="menuitem" tabIndex={-1} type="button" data-lang-item aria-haspopup="menu" onClick={openLang} className="!flex items-center justify-between gap-3">
              <span>{labels.language}</span>
              <span className="text-ink2 text-[calc(12px*var(--ui))] flex items-center gap-1" aria-label={`current: ${langName}`}><span className="uppercase">{lang.split("-")[0]}</span><span aria-hidden>›</span></span>
            </button>
          )}
          <div className="border-t hair my-1" />
          <button role="menuitem" tabIndex={-1} type="button" onClick={() => signOut().then(() => { router.push("/"); router.refresh(); })}>{labels.signOut}</button>
        </div>
      )}
      {open && view === "lang" && (
        <div role="menu" aria-label={labels.language} className="menu" aria-busy={pending}>
          <button role="menuitem" tabIndex={-1} type="button" onClick={backToMain} className="!flex items-center gap-2 text-ink2 border-b hair !rounded-none mb-1"><span aria-hidden>‹</span>{labels.language}</button>
          <div className="max-h-[min(360px,60vh)] overflow-auto">
            {langs.map((l) => (
              <button key={l.code} role="menuitemradio" aria-checked={l.code === lang} tabIndex={-1} type="button" lang={l.code}
                onClick={() => { choose(l.code); close(true); }} className="!flex items-center justify-between gap-3">
                <span>{l.name}</span>{l.code === lang && <span aria-hidden className="text-ink">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {issue && <ReportIssueDialog onClose={() => setIssue(false)} />}
    </div>
  );
}

function Item({ href, current = false, children }: { href: string; current?: boolean; children: React.ReactNode }) {
  return <Link role="menuitem" tabIndex={-1} href={href} aria-current={current ? "page" : undefined} className={current ? "font-medium" : undefined}>{children}</Link>;
}
