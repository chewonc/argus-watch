// Activity log: what Argus Watch did in the background, in everyday words. Not notifications (those are alerts
// that need you); raw entries stay on Monitoring status → Advanced diagnostics.
import { describe } from "@/lib/activity";
import { knownRepoNames, logVisibleTo } from "@/lib/authz";
import { getDict, getLocale } from "@/lib/i18n";
import { requireUser, visibleRepoKeys } from "@/lib/session";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Activity() {
  const user = await requireUser("/activity");
  const [raw, keys, known] = await Promise.all([store.recentLog(300), visibleRepoKeys(user.id), knownRepoNames()]);
  const log = raw.filter((l) => logVisibleTo(l, keys, known)); // only this user's repositories (V7)
  // Collapse consecutive repeats ("Checked security news sources" ×12) into one line.
  const rows: { at: string; text: string; n: number }[] = [];
  for (const l of log) { const t = describe(l); if (!t) continue; const last = rows[rows.length - 1]; if (last?.text === t) last.n++; else rows.push({ at: l.at, text: t, n: 1 }); }
  const locale = await getLocale();
  const d = await getDict(locale);
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-US" : locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-10 grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{d.act_title}</h1>
        <p className="text-[15px] text-ink2">{d.act_intro}</p>
      </div>
      {rows.length === 0 ? <p className="text-[14px] text-ink2">{d.act_empty}</p> : (
        <ol className="border hair rounded-[10px] bg-raised overflow-hidden">
          {rows.slice(0, 80).map((r, i) => <li key={i} className="flex items-baseline justify-between gap-4 px-5 py-3 border-b hair last:border-0 text-[14px]"><span>{r.text}{r.n > 1 && <span className="text-ink2"> · {r.n} {d.act_times}</span>}</span><time className="text-[12px] text-ink2 shrink-0" dateTime={r.at}>{fmt(r.at)}</time></li>)}
        </ol>
      )}
    </div>
  );
}
