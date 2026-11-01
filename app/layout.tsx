import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { HeaderNav } from "@/components/header-nav";
import { hasAuth } from "@/lib/env";
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
  const user = await currentUser();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b hair">
          <div className="mx-auto max-w-[1480px] px-6 h-12 flex items-center justify-between gap-4">
            <Link href="/" className="serif text-[20px] !text-[var(--ink)] no-underline">Argus Watch</Link>
            <HeaderNav user={user ? { id: user.id, login: user.login, avatar: user.avatar } : null} authReady={hasAuth()} />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t hair">
          <div className="mx-auto max-w-[1480px] px-6 py-3 text-[12px] text-ink2">
            Read-only analysis. Argus Watch does not run, reproduce, or test any vulnerability. Evidence-supported impact prediction is not experimentally confirmed exploitability. Repository changes happen only as draft pull requests you explicitly approve.
          </div>
        </footer>
      </body>
    </html>
  );
}
