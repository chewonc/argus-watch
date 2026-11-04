// Public demo index (no sign-in): real Argus Watch results on the evaluation fixtures in this public repository.
import Link from "next/link";
import { SparkBadge, StatusPill } from "@/components/alerts";
import { CredibilityChip } from "@/components/credibility";
import { demoAssessments, demoHref } from "@/lib/demo";
import { getDict, getLocale } from "@/lib/i18n";
import { location, localized, plainTitle, statusOf, whereLine } from "@/lib/labels";
import { deriveSeverity } from "@/lib/severity";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo findings · Argus Watch" };

export default async function DemoIndex() {
  const d = await getDict(await getLocale());
  const list = await demoAssessments();
  const rows = await Promise.all(list.map(async (a) => {
    const [f, r] = await Promise.all([store.getFinding(a.finding_id), store.getRepo(a.repo)]);
    const loc = location(a);
    return { a, f, title: plainTitle(a, f, loc, r?.tech_tags, r?.packages.map((p) => p.name)), where: whereLine(a, loc), status: localized(statusOf(a, a.severity ?? deriveSeverity(a, []), { resolved: false, prOpen: false }), d) };
  }));
  return (
    <div className="mx-auto max-w-[calc(760px*var(--ui))] px-4 sm:px-6 py-8 sm:py-10 grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-[calc(26px*var(--ui))] sm:text-[calc(30px*var(--ui))] font-semibold tracking-[-0.02em] leading-tight">Demo findings</h1>
        <p className="text-[calc(14px*var(--ui))] text-ink2">Real Argus Watch results for the evaluation fixtures in this open-source repository (<span className="mono">feasibility/cases</span>). Read-only: sign in to connect your own repositories.</p>
      </div>
      {rows.length === 0 ? <p className="text-[calc(14px*var(--ui))] text-ink2">No demo findings on this deployment yet.</p> : (
        <ul className="border hair rounded-[8px] bg-raised">
          {rows.map(({ a, f, title, where, status }) => (
            <li key={a.id} className="grid gap-1.5 px-4 sm:px-5 py-4 border-b hair last:border-0">
              <div className="flex flex-wrap items-center gap-2"><StatusPill s={status} /><CredibilityChip c={f?.credibility} compact /><SparkBadge a={a} label={d.analysed_by_spark} /></div>
              <Link href={demoHref(a.id)} className="text-[calc(15px*var(--ui))] font-semibold leading-snug no-underline hover:underline">{title}</Link>
              <div className="text-[calc(13px*var(--ui))] text-ink2 mono [overflow-wrap:anywhere]">{a.repo.replace("chewonc/argus-watch/", "")}{where.kind === "file" || where.kind === "package" ? ` · ${where.text}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
