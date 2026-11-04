import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { HeaderNav } from "@/components/header-nav";
import { hasAuth } from "@/lib/env";
import { getDict, getLocale } from "@/lib/i18n";
import { languages } from "@/lib/i18n/translate";
import { isRtl } from "@/lib/i18n/translate";
import { currentUser } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Argus Watch",
  description: "Continuous, read-only security impact analysis for your repositories",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const [user, d, langs] = await Promise.all([currentUser(), getDict(locale), languages(locale)]);
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b hair bg-[var(--bg)] sticky top-0 z-20">
          <div className="mx-auto max-w-[1080px] px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 no-underline text-[15px] font-semibold tracking-[-0.01em]"><span aria-hidden className="w-2 h-2 rounded-full bg-[var(--accent)]" />Argus Watch</Link>
            <HeaderNav locale={locale} languages={langs} user={user ? { id: user.id, login: user.login, avatar: user.avatar } : null} authReady={hasAuth()} labels={{ alerts: d.nav_alerts, repos: d.nav_repos, monitoring: d.nav_monitoring, activity: d.nav_activity, settings: d.nav_settings, notifications: d.notifications, signIn: d.sign_in, signOut: d.sign_out, notConfigured: d.sign_in_not_configured }} />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t hair">
          <div className="mx-auto max-w-[1080px] px-4 sm:px-6 py-4 text-[12px] text-ink2">{d.read_only_footer}</div>
        </footer>
      </body>
    </html>
  );
}
