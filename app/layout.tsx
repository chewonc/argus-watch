import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Argus Watch",
  description: "Continuous, read-only security impact analysis for your repositories",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b hair">
          <div className="mx-auto max-w-[1480px] px-6 h-12 flex items-center justify-between">
            <Link href="/" className="serif text-[20px] !text-[var(--ink)] no-underline">Argus Watch</Link>
            <nav className="flex gap-6 text-[13px]">
              <Link href="/">Watch</Link>
              <Link href="/sources">Sources</Link>
              <a href="/api/status">Status JSON</a>
              <a href="https://github.com/chewonc/argus-watch">Repo</a>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t hair">
          <div className="mx-auto max-w-[1480px] px-6 py-3 text-[12px] text-ink2">
            Read-only analysis. Argus Watch does not run, reproduce, or test any vulnerability. Evidence-supported impact prediction is not experimentally confirmed exploitability.
          </div>
        </footer>
      </body>
    </html>
  );
}
