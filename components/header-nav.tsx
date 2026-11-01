"use client";
// Header: navigation, unread badge (polled), sign-in / sign-out. Receives the server-resolved user so the first paint is right.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signInWithGitHub, signOut } from "@/lib/auth-client";

export type HeaderUser = { id: string; login: string; avatar: string | null } | null;

export function HeaderNav({ user, authReady, children }: { user: HeaderUser; authReady: boolean; children?: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () => fetch("/api/notifications?count=1").then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setUnread(j.unread ?? 0); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [user, path]);
  return (
    <nav className="flex items-center gap-5 text-[13px]">
      <Link href="/">Watch</Link>
      {user && <Link href="/repos">Repos</Link>}
      <Link href="/sources">Sources</Link>
      {user && (
        <Link href="/notifications" className="relative" aria-label={unread ? `${unread} unread notifications` : "notifications"}>
          Alerts{unread ? <span className="badge ml-1">{unread > 99 ? "99+" : unread}</span> : null}
        </Link>
      )}
      {children}
      {user ? (
        <span className="flex items-center gap-2">
          <Link href="/settings" className="flex items-center gap-2 no-underline">
            {user.avatar ? <img src={user.avatar} alt="" width={20} height={20} className="rounded-full" /> : null /* eslint-disable-line @next/next/no-img-element -- avatar from GitHub, not optimised */}
            <span className="mono text-[12px]">{user.login}</span>
          </Link>
          <button type="button" className="btn-ghost" onClick={() => signOut().then(() => { router.push("/"); router.refresh(); })}>Sign out</button>
        </span>
      ) : authReady ? (
        <button type="button" className="btn" onClick={() => signInWithGitHub(path === "/" ? "/" : path)}>Sign in with GitHub</button>
      ) : (
        <span className="text-ink2 text-[12px]" title="Set BETTER_AUTH_SECRET, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET">sign-in not configured</span>
      )}
    </nav>
  );
}
