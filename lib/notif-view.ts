// Notifications as shown to people: plain title and status from the linked assessment (the stored title is the
// source headline, kept for history), plus the finding link. Shared by the bell API and the notifications page.
import { assessmentFor } from "./authz";
import { caseHref, location, plainTitle, statusOf } from "./labels";
import type { Notification } from "./schema";
import { deriveSeverity } from "./severity";
import { store } from "./store";

export type NotificationView = Notification & { display_title: string; status: { label: string; glyph: string; tone: string } | null; href: string };

export async function viewNotifications(uid: string, list: Notification[]): Promise<NotificationView[]> {
  const resolved = new Set(await store.resolvedSet(uid));
  return Promise.all(list.map(async (x) => {
    const a = await assessmentFor(uid, x.assessment_id);
    if (!a) return { ...x, display_title: x.title, status: null, href: caseHref(x.assessment_id) };
    const [f, r] = await Promise.all([store.getFinding(a.finding_id), store.getRepo(a.repo)]);
    const st = statusOf(a, a.severity ?? x.severity ?? deriveSeverity(a, []), { resolved: resolved.has(a.id), prOpen: x.kind === "fix_pr_created" });
    return { ...x, display_title: plainTitle(a, f, location(a), r?.tech_tags, r?.packages.map((p) => p.name)), status: { label: st.label, glyph: st.glyph, tone: st.tone }, href: caseHref(a.id) };
  }));
}

const SEV: Record<string, number> = { critical: 4, high: 3, moderate: 2, medium: 2, low: 1 };
/** Priority order for people: unread first, then confirmed impact over possible issues, then severity, then newest. */
export function byPriority<T extends Pick<Notification, "read_at" | "verdict" | "severity" | "notified_at">>(a: T, b: T): number {
  const u = Number(!!a.read_at) - Number(!!b.read_at); if (u) return u;
  const v = Number(b.verdict === "Affected") - Number(a.verdict === "Affected"); if (v) return v;
  const s = (SEV[b.severity?.level ?? ""] ?? 0) - (SEV[a.severity?.level ?? ""] ?? 0); if (s) return s;
  return b.notified_at.localeCompare(a.notified_at);
}
