"use client";
// Language selection. Switching sets a cookie (server action), mirrors it to localStorage, and refreshes the server tree
// in place: the current page, open alert and client state stay. Signed-out pages show the compact <select>; signed-in
// users pick the language from the account menu (components/header-nav.tsx), which uses the same hook.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { setLocale } from "@/app/actions/locale";

export type Lang = { code: string; name: string };

/** Shared switching logic: restores a previously chosen language on first visit, and switches on demand. */
export function useLocaleSwitch(current: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current);
  useEffect(() => {
    // first visit without a cookie: restore a previously chosen language from this browser
    try { const saved = localStorage.getItem("aw_locale"); if (saved && saved !== current && current === "en" && !document.cookie.includes("aw_locale=")) start(async () => { await setLocale(saved); router.refresh(); }); } catch { /* storage unavailable */ }
  }, [current, router]);
  const choose = (code: string) => { setValue(code); try { localStorage.setItem("aw_locale", code); } catch { /* ignore */ } start(async () => { await setLocale(code); router.refresh(); }); };
  return { value, pending, choose };
}

/** The current language first if the list lacks it (e.g. a cookie set before a language list change). */
export const withCurrent = (current: string, languages: Lang[]) => (languages.some((l) => l.code === current) ? languages : [{ code: current, name: current }, ...languages]);

export function LanguageSwitcher({ current, languages, compact = false }: { current: string; languages: Lang[]; compact?: boolean }) {
  const { value, pending, choose } = useLocaleSwitch(current);
  return (
    <label className="flex items-center gap-1 text-[calc(14px*var(--ui))]" aria-busy={pending} title="Language / 언어">
      <span className="sr-only">Language</span>
      <select value={value} onChange={(e) => choose(e.target.value)} className={`border hair rounded-[6px] bg-transparent ${compact ? "px-1 h-8 text-[calc(13px*var(--ui))] max-w-[calc(110px*var(--ui))] sm:max-w-[calc(150px*var(--ui))]" : "px-2 h-9 text-[calc(14px*var(--ui))] max-w-[calc(260px*var(--ui))]"}`} disabled={pending}>
        {withCurrent(current, languages).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}
