"use client";
// Language selector: every language the translation service supports. Switching sets a cookie (server action),
// mirrors it to localStorage, and refreshes the server tree in place: the current page, open alert and client state stay.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { setLocale } from "@/app/actions/locale";

export function LanguageSwitcher({ current, languages, compact = false }: { current: string; languages: { code: string; name: string }[]; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current);
  useEffect(() => {
    // first visit without a cookie: restore a previously chosen language from this browser
    try { const saved = localStorage.getItem("aw_locale"); if (saved && saved !== current && current === "en" && !document.cookie.includes("aw_locale=")) start(async () => { await setLocale(saved); router.refresh(); }); } catch { /* storage unavailable */ }
  }, [current, router]);
  const list = languages.some((l) => l.code === current) ? languages : [{ code: current, name: current }, ...languages];
  return (
    <label className="flex items-center gap-1 text-[14px]" aria-busy={pending} title="Language / 언어">
      <span className="sr-only">Language</span>{compact && <span aria-hidden className="text-ink2 text-[13px] max-sm:hidden">🌐</span>}
      <select value={value} onChange={(e) => { const code = e.target.value; setValue(code); try { localStorage.setItem("aw_locale", code); } catch { /* ignore */ } start(async () => { await setLocale(code); router.refresh(); }); }} className={`border hair rounded-[6px] bg-transparent ${compact ? "px-1 h-8 text-[13px] max-w-[84px] sm:max-w-[150px]" : "px-2 h-9 text-[14px] max-w-[260px]"}`} disabled={pending}>
        {list.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}
