// Notification history: every security alert sent to you, newest first, unread marked. Opening one marks it read.
import Link from "next/link";
import { MarkAllRead } from "@/components/mark-all-read";
import { getDict, getLocale } from "@/lib/i18n";
import { viewNotifications } from "@/lib/notif-view";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Notifications({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/notifications");
  const sp = await searchParams;
  const d = await getDict(await getLocale());
  const onlyUnread = sp.show === "unread";
  const [list, unread] = await Promise.all([store.listNotifications(user.id, 200), store.unreadCount(user.id)]);
  const views = (await viewNotifications(user.id, list)).sort((a, b) => b.notified_at.localeCompare(a.notified_at)).filter((n) => !onlyUnread || !n.read_at);
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-10 grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1"><h1 className="text-[28px] font-semibold tracking-[-0.02em]">{d.notifications}</h1><p className="text-[15px] text-ink2">{unread ? `${unread} unread` : "You're all caught up."}</p></div>
        <div className="flex items-center gap-2">
          <nav className="seg" aria-label="Show"><Link href="/notifications" aria-current={!onlyUnread ? "page" : undefined}>All</Link><Link href="/notifications?show=unread" aria-current={onlyUnread ? "page" : undefined}>Unread</Link></nav>
          {unread > 0 && <MarkAllRead />}
        </div>
      </div>
      {views.length === 0 ? (
        <div className="border hair rounded-[10px] bg-raised px-6 py-12 text-center text-[14px] text-ink2">{onlyUnread ? "No unread notifications." : "No notifications yet. We'll notify you when a new threat matches your code."}</div>
      ) : (
        <ul className="border hair rounded-[10px] bg-raised overflow-hidden">
          {views.map((n) => (
            <li key={n.id} className="border-b hair last:border-0">
              <Link href={n.href} className="flex gap-3 px-4 sm:px-5 py-4 no-underline hover:bg-[var(--sunken)]">
                <span aria-hidden className={`mt-[7px] w-2 h-2 rounded-full shrink-0 ${n.read_at ? "" : "bg-[var(--accent)]"}`} />
                <span className="grid gap-1 min-w-0 flex-1">
                  <span className={`text-[14px] leading-snug ${n.read_at ? "" : "font-semibold"}`}>{n.display_title}{!n.read_at && <span className="sr-only"> (unread)</span>}</span>
                  <span className="text-[12px] text-ink2 flex flex-wrap gap-x-2">
                    {n.status && <span className={`tone-${n.status.tone}`}><span aria-hidden>{n.status.glyph}</span> {n.status.label}</span>}
                    <span>{n.repo.split("/").slice(0, 2).join("/")}</span>
                  </span>
                </span>
                <time className="text-[12px] text-ink2 shrink-0" dateTime={n.notified_at}>{fmt(n.notified_at)}</time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
