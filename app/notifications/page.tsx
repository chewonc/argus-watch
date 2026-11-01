// Notification inbox for the signed-in user: unread first, mark all read, links to cases.
import Link from "next/link";
import { MarkAllRead } from "@/components/mark-all-read";
import { fmtTime } from "@/components/ui";
import { severityLabel } from "@/lib/severity";
import { requireUser } from "@/lib/session";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Notifications() {
  const user = await requireUser("/notifications");
  const [list, unread] = await Promise.all([store.listNotifications(user.id, 100), store.unreadCount(user.id)]);
  const sorted = [...list].sort((a, b) => Number(!!a.read_at) - Number(!!b.read_at) || b.updated_at.localeCompare(a.updated_at));
  return (
    <div className="mx-auto max-w-[900px] px-6 py-8 grid gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div><h1 className="serif text-[36px]">Notifications</h1><p className="text-ink2 text-[13px]">{unread} unread · one entry per finding and repository; a changed verdict or severity updates the entry instead of adding another. <Link href="/settings">Preferences →</Link></p></div>
        {unread > 0 && <MarkAllRead />}
      </div>
      {sorted.length === 0 && <p className="text-ink2 text-[13px]">Nothing yet. You are notified when a finding matches one of your repositories with an Affected or Unclear verdict, when a verdict or severity changes, and when a draft PR is opened.</p>}
      <ul className="grid gap-2">
        {sorted.map((n) => (
          <li key={n.id} className={`border hair rounded-[6px] p-3 text-[13px] grid gap-1 ${n.read_at ? "" : "border-l-4"}`} style={n.read_at ? undefined : { borderLeftColor: "var(--accent)" }}>
            <div className="flex flex-wrap items-center gap-2"><span className={`chip chip-sev-${n.severity.level}`}>{severityLabel(n.severity)}</span><span className="label">{n.verdict}</span><span className="label">{n.kind.replace(/_/g, " ")}</span>{!n.read_at && <span className="label" style={{ color: "var(--accent)" }}>unread</span>}</div>
            <Link href={`/case/${n.assessment_id.split("/").map(encodeURIComponent).join("/")}`} className="font-medium no-underline">{n.title}</Link>
            <div className="mono text-[11px] text-ink2">{n.repo} · detected {fmtTime(n.notified_at)}{n.pushed_at ? ` · pushed ${fmtTime(n.pushed_at)}` : ""}{n.received_at ? ` · received ${fmtTime(n.received_at)}` : ""}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
