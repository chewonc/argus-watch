// Public, read-only finding view for demo fixtures (lib/demo.ts). Same evidence as the signed-in finding page,
// with no actions: no fix, no verify, no agent prompt, no notifications. Anything that is not a public demo is a 404.
import Link from "next/link";
import { notFound } from "next/navigation";
import { SparkBadge, StatusPill, firstSentence, suggestedFix } from "@/components/alerts";
import { CredibilityChip, CredibilityPanel } from "@/components/credibility";
import { demoAssessment } from "@/lib/demo";
import { getDict, getLocale } from "@/lib/i18n";
import { fmtDate, isVerified, location, localized, modelName, plainTitle, statusOf, tidy, whereLine } from "@/lib/labels";
import { permalink } from "@/lib/remediation";
import { deriveSeverity } from "@/lib/severity";
import { store } from "@/lib/store";
import { getTimeline } from "@/lib/timeline";

export const dynamic = "force-dynamic";

export default async function DemoCase({ params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const a = await demoAssessment(id.map(decodeURIComponent).join("/"));
  if (!a) notFound();
  const d = await getDict(await getLocale());
  const [f, w] = await Promise.all([store.getFinding(a.finding_id), store.getRepo(a.repo)]);
  const loc = location(a);
  const verified = isVerified(a);
  const status = localized(statusOf(a, a.severity ?? deriveSeverity(a, []), { resolved: false, prOpen: false }), d);
  const repoOnly = a.repo.split("/").slice(0, 2).join("/");
  const ghUrl = loc ? permalink(repoOnly, a.sha, loc.file, loc.from, loc.to) : null;
  const where = whereLine(a, loc);
  const fix = suggestedFix(a);
  const timeline = f ? await getTimeline(f).catch(() => null) : null;
  const STATE: Record<string, string> = { Observed: "Observed in code", Inferred: "Inferred", Unknown: "Not established", Contradicted: "Contradicted by code" };

  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-10 grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="grid gap-3">
        <Link href="/demo" className="text-[13px] no-underline hover:underline w-fit">← Demo findings</Link>
        <p className="text-[12px] text-ink2">Public demo on an evaluation fixture in this open-source repository. Read-only.</p>
        <div className="flex flex-wrap items-center gap-2"><StatusPill s={status} /><CredibilityChip c={f?.credibility} l={{ none: d.report_not_checked, prefix: d.report_prefix }} /><SparkBadge a={a} label={d.analysed_by_spark} /></div>
        <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-[-0.02em] leading-tight">{tidy(plainTitle(a, f, loc, w?.tech_tags, w?.packages.map((p) => p.name)))}</h1>
        <div className="text-[13px] text-ink2 mono [overflow-wrap:anywhere]">{a.repo.replace("chewonc/argus-watch/", "")}</div>
        {loc && a.verdict !== "Not Affected" && ghUrl && <div className="text-[13px] text-ink2"><span>{verified ? d.affected_at : d.potentially_affected}: </span><a href={ghUrl} target="_blank" rel="noreferrer" className="mono [overflow-wrap:anywhere]">{`${loc.file}:${loc.from}${loc.to !== loc.from ? `-${loc.to}` : ""}`} ↗</a></div>}
        {!loc && where.kind === "package" && <div className="mono text-[13px] text-ink2 [overflow-wrap:anywhere]">{where.text}</div>}
      </div>

      <section className="grid gap-2">
        <h2 className="text-[18px] font-semibold">What&apos;s wrong?</h2>
        <p className="text-[14px] leading-relaxed">{tidy(f?.claim?.summary ? firstSentence(f.claim.summary) : a.verdict_qualifier)}</p>
      </section>
      {a.verdict !== "Not Affected" && fix && (
        <section className="grid gap-2">
          <h2 className="text-[18px] font-semibold">How to fix it</h2>
          <p className="text-[14px] leading-relaxed">{tidy(fix)}</p>
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="text-[18px] font-semibold">Why Argus says this</h2>
        <p className="text-[13px] text-ink2">{tidy(a.verdict_reason)}</p>
        <ul className="grid gap-2 text-[14px]">
          {a.conditions.map((c) => (
            <li key={c.id} className="border hair rounded-[6px] px-3 py-2 grid gap-1">
              <div className="text-[12px] text-ink2">{c.role === "mitigation" ? "Mitigation" : "Required"} · {STATE[c.state] ?? c.state}{c.computed ? " · computed in code" : ""}</div>
              <div>{tidy(c.text)}</div>
              {c.evidence.filter((e) => e.line).slice(0, 2).map((e) => <a key={`${e.file}:${e.line}`} href={permalink(repoOnly, a.sha, e.file, e.line)} target="_blank" rel="noreferrer" className="mono text-[12px] [overflow-wrap:anywhere]">{e.file}:{e.line} ↗</a>)}
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-ink2">Analysis: {a.hosted === "deterministic" ? "version check in code (no model)" : a.hosted === "capped" ? "version check only (hosted budget reached)" : modelName(a.model)}{a.investigation ? ` · ${a.investigation.steps} read-only tool steps` : ""} · {fmtDate(a.timestamps.processed_at)}</p>
      </section>

      <CredibilityPanel c={f?.credibility} />

      {timeline && timeline.events.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-[18px] font-semibold">Threat timeline</h2>
          <ol className="grid gap-2 text-[14px]">
            {timeline.events.filter((e) => e.lane === "threat").slice(0, 20).map((e) => (
              <li key={e.id} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
                <time dateTime={e.at} className="mono text-[12px] text-ink2">{fmtDate(e.at)}</time>
                <div><span className="[overflow-wrap:anywhere]">{tidy(e.title)}</span> <span className="text-[12px] text-ink2">({e.confidence}{e.sources[0]?.url ? <>, <a href={e.sources[0].url} target="_blank" rel="noreferrer">source ↗</a></> : null})</span></div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-[13px] text-ink2"><Link href="/">Sign in</Link> to connect your own repositories and get alerts, fixes and AI-agent access.</p>
    </div>
  );
}
