// Case file: one assessment. Stages read top to bottom; every chip links to its source line.
import Link from "next/link";
import { notFound } from "next/navigation";
import { codeToHtml } from "shiki";
import { ActControls } from "@/components/act";
import { SeverityChip, firstSentence, location, suggestedFix } from "@/components/alerts";
import { FixPreview } from "@/components/fix-preview";
import { MarkRead } from "@/components/mark-read";
import { OpenIn } from "@/components/open-in";
import { Band, Chip, Timeline } from "@/components/ui";
import { permalink, provenanceOf } from "@/lib/remediation";
import { readFile } from "@/lib/repo";
import { deriveSeverity } from "@/lib/severity";
import { canSee, isSystemRepo, requireUser } from "@/lib/session";
import { store } from "@/lib/store";
import { relevance } from "@/lib/verdict";

export const dynamic = "force-dynamic";

export default async function Case({ params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const aid = id.map(decodeURIComponent).join("/");
  const user = await requireUser(`/case/${id.join("/")}`);
  const a = await store.getAssessment(aid);
  if (!a || !(await canSee(user.id, a.repo))) notFound();
  const [ur, demoRepo, fixes, w] = await Promise.all([store.getUserRepo(user.id, a.repo), isSystemRepo(a.repo), store.listFixes(a.id), store.getRepo(a.repo)]);
  const latestFix = fixes.find((x) => x.status === "pr_created") ?? fixes.find((x) => x.status === "drafted") ?? fixes[0] ?? null;
  const f = await store.getFinding(a.finding_id);
  const itemsAll = f ? (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x) => !!x) : [];
  // Replays and re-deliveries store separate items for the same source occurrence; show each occurrence once.
  const items = itemsAll.filter((it, i) => itemsAll.findIndex((o) => o.source === it.source && o.url === it.url && o.title === it.title) === i);
  const repoOnly = a.repo.split("/").slice(0, 2).join("/");
  const gh = (file: string, line?: number | null) => permalink(repoOnly, a.sha, file, line);
  const advisoryText = items.map((i) => i.text).join("\n");
  const briefPath = `/api/remediation/${a.id.split("/").map(encodeURIComponent).join("/")}`;
  const PROV_ORDER = ["ADVISORY-STATED", "REPO-INFERRED", "SPECULATIVE"] as const;
  const recs = a.recommendations.map((r) => ({ ...r, prov: provenanceOf(r.text, advisoryText, r.condition_ids, a) })).sort((x, y) => PROV_ORDER.indexOf(x.prov) - PROV_ORDER.indexOf(y.prov));

  // Source pane: the files cited by evidence, highlighted (server-side Shiki; read-only fetch at the assessed sha)
  const cited = [...new Set([...a.locations.map((l) => l.file), ...a.conditions.flatMap((c) => c.evidence.map((e) => e.file))])];
  const sources = await Promise.all(cited.slice(0, 6).map(async (file) => {
    const text = (await readFile(repoOnly, a.sha, file)) ?? "";
    const lines = new Set([...a.locations.filter((l) => l.file === file).map((l) => l.line), ...a.conditions.flatMap((c) => c.evidence.filter((e) => e.file === file && e.line).map((e) => e.line!))]);
    const lang = /\.(ts|tsx)$/.test(file) ? "tsx" : /\.(js|mjs|cjs|jsx)$/.test(file) ? "javascript" : /\.json$/.test(file) ? "json" : /\.ya?ml$/.test(file) ? "yaml" : /Dockerfile$/.test(file) ? "dockerfile" : /\.py$/.test(file) ? "python" : "text";
    const html = text ? await codeToHtml(text.split("\n").slice(0, 400).join("\n"), { lang, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false,
      transformers: [{ line(node, line) { node.properties.class = `line${lines.has(line) ? " hit" : ""}`; node.properties.id = `${file}:${line}`; } }] }) : "<pre>(file not readable at this commit)</pre>";
    return { file, html };
  }));

  return (
    <div className="mx-auto max-w-[1480px] px-6 py-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <article className="grid gap-8">
        <div>
          <Link href="/" className="text-[12px]">← Watch</Link>
          <h1 className="serif text-[32px] leading-tight mt-2">{f?.title ?? a.finding_id}</h1>
          <div className="mono text-[12px] text-ink2 mt-1">{f?.ids.join(" · ")} · {a.repo} @{a.sha.slice(0, 7)} · {a.tier}{a.replayed ? " · REPLAYED (not a live delivery)" : ""}</div>
        </div>

        <MarkRead assessmentId={a.id} />
        {(() => { const sev = a.severity ?? deriveSeverity(a, items); const loc = location(a); const fix = suggestedFix(a); const briefUrl = `${briefPath}?agent=claude&download=1`; return (
          <section className="border hair rounded-[6px] bg-raised p-4 grid gap-3">
            <div className="flex flex-wrap items-center gap-2"><SeverityChip s={sev} /><span className={`chip ${a.verdict === "Affected" ? "chip-Contradicted" : a.verdict === "Not Affected" ? "chip-Observed" : "chip-Inferred"}`}>{relevance(a.verdict, a.tier, a.conditions)}</span><span className="label">{a.tier}{a.replayed ? " · replayed" : ""}</span></div>
            <div className="grid sm:grid-cols-2 gap-3 text-[13px]">
              <div><div className="label">Problem</div>{f?.claim?.summary ? firstSentence(f.claim.summary) : a.verdict_qualifier}</div>
              <div><div className="label">Suggested fix</div>{fix ?? <span className="text-ink2">No concrete fix produced; see missing evidence.</span>}</div>
              <div><div className="label">Where</div>{loc ? <a href={`#${loc.file}:${loc.from}`} className="mono">{loc.file}:{loc.from}{loc.to !== loc.from ? `–${loc.to}` : ""}</a> : <span className="text-ink2">exact location not available: no source line could be cited</span>}</div>
              <div><div className="label">What happens if you approve a fix</div>A draft pull request on a new branch; nothing is merged and the default branch is untouched. Changes are syntax-checked only, never executed.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {loc && <a href={`#${loc.file}:${loc.from}`} className="btn-ghost no-underline">View code</a>}
              {a.verdict !== "Not Affected" && <a href="#fix" className="btn no-underline">{latestFix?.status === "pr_created" ? "View draft PR" : "Preview fix"}</a>}
              <OpenIn t={{ repo: repoOnly, sha: a.sha, file: loc?.file ?? null, line: loc?.from ?? null, localRoot: ur?.local_root ?? null, caseUrl: `/case/${a.id.split("/").map(encodeURIComponent).join("/")}`, briefUrl, ids: f?.ids.join(", ") || a.finding_id }} />
              <a href={briefUrl} className="btn-ghost no-underline">Generate fix prompt</a>
            </div>
            <Timeline a={a} />
          </section>); })()}

        <FixPreview assessmentId={a.id} initial={latestFix} allowPr={!!ur?.allow_pr} isDemoRepo={demoRepo} verdict={a.verdict} defaultBranch={w?.default_branch ?? "main"} repo={repoOnly} />

        <h2 className="label mt-2">Full analysis</h2>
        <Stage n="1" title="Security signal">
          <ul className="grid gap-2 text-[13px]">
            {items.map((it) => <li key={it.id}><span className="label mr-2">{it.source} · {it.sourceClass}</span>{it.url ? <a href={it.url}>{it.title}</a> : it.title}<span className="mono text-ink2 ml-2">{it.published_at ? `published ${it.published_at.slice(0, 10)}` : "publication time unknown"}</span></li>)}
          </ul>
          {f?.claim && <p className="mt-3 text-[14px]">{f.claim.summary}</p>}
        </Stage>

        <Stage n="2" title="Stack match">
          {a.dependency ? <p className="text-[13px]">Affected package <span className="mono">{a.dependency.name}@{a.dependency.version}</span> found in <span className="mono">{a.dependency.source_file}</span>.</p> : <p className="text-[13px] text-ink2">No affected package coordinates in this report; matched on technology tags.</p>}
          <p className="text-[12px] text-ink2 mt-1">A vulnerable version does not by itself mean the application is affected.</p>
        </Stage>

        <Stage n="3" title="Code & environment">
          {a.locations.length === 0 && <p className="text-[13px] text-ink2">No relevant code located. This does not show the code is safe.</p>}
          <ul className="grid gap-1 text-[13px]">
            {a.locations.map((l, i) => <li key={i}><a href={`#${l.file}:${l.line}`} className="mono">{l.file.split("/").slice(-2).join("/")}:{l.line}</a> <a href={gh(l.file, l.line)} target="_blank" rel="noreferrer" className="mono text-[11px] ml-1" title="Open on GitHub at this commit">↗ GitHub</a> <span className="text-ink2">{l.why}</span></li>)}
          </ul>
        </Stage>

        <Stage n="4–5" title="Failure conditions and evidence">
          <ul className="grid gap-3">
            {a.conditions.map((c) => (
              <li key={c.id} className="grid grid-cols-[130px_1fr] gap-3 items-start border-b hair pb-3">
                <Chip state={c.state} />
                <div>
                  <div className="text-[14px]">{c.text}</div>
                  <div className="text-[12px] text-ink2 mt-1">{c.role === "required" ? "required condition" : `missing protection · ${c.mitigation_kind}`}{c.computed ? " · computed in code" : ""}</div>
                  <div className="text-[12px] mt-1">{c.reasoning}</div>
                  {c.evidence.length > 0 && <div className="mono text-[12px] mt-1">{c.evidence.map((e, i) => <span key={i} className="mr-3"><a href={`#${e.file}:${e.line}`}>{e.file.split("/").slice(-2).join("/")}{e.line ? `:${e.line}` : ""}</a> <a href={gh(e.file, e.line)} target="_blank" rel="noreferrer" className="text-[11px]" title="Open on GitHub at this commit">↗</a></span>)}</div>}
                  {c.state === "Unknown" && <div className="text-[12px] text-ink2 mt-1">Missing evidence: nothing in the inspected files establishes this.</div>}
                </div>
              </li>
            ))}
          </ul>
        </Stage>

        <Stage n="6" title="Verdict">
          <Band a={a} />
          <div className="grid sm:grid-cols-3 gap-4 mt-4 text-[13px]">
            <Col title="Supporting evidence" items={a.conditions.filter((c) => c.state === "Observed" || c.state === "Inferred").map((c) => `${c.state}: ${c.text}`)} empty="None." />
            <Col title="Missing evidence" items={a.missing_evidence} empty="None identified in inspected files." />
            <Col title="Unverified" items={a.unverified} empty="—" />
          </div>
        </Stage>

        <Stage n="7" title="Act">
          {a.verdict === "Not Affected" ? (
            <p className="text-[14px] text-ink2">No change recommended under the stated conditions. This is not a guarantee of safety; the cited files remain linked above.</p>
          ) : (
            <div className="grid gap-5">
              <div>
                <div className="text-[12px] text-ink2 mb-2">Steps, by provenance. ADVISORY-STATED comes from the advisory itself; REPO-INFERRED from cited evidence in this repository; SPECULATIVE needs your judgement.</div>
                <ol className="grid gap-2 text-[14px] list-decimal pl-5">
                  {recs.map((r, i) => <li key={i}><span className="label mr-2" style={{ color: r.prov === "ADVISORY-STATED" ? "var(--observed)" : r.prov === "REPO-INFERRED" ? "var(--inferred)" : "var(--unknown)" }}>{r.prov}</span>{r.text}<span className="mono text-[11px] text-ink2 ml-2">→ {r.condition_ids.join(", ") || "general"}</span></li>)}
                  {recs.length === 0 && <li className="text-ink2">Investigate the unknown conditions; no concrete steps were produced.</li>}
                </ol>
              </div>
              <ActControls briefPath={briefPath} verdict={a.verdict} codexCmd={"# in your checkout of the repository\ncodex exec - < REMEDIATION.md   # review the proposed changes before accepting"} />
            </div>
          )}
        </Stage>
      </article>

      <aside className="grid gap-6 content-start lg:sticky lg:top-6 lg:max-h-[calc(100vh-48px)] lg:overflow-auto">
        <h2 className="label">Source · read-only at {a.sha.slice(0, 7)}</h2>
        {sources.length > 1 && <nav className="mono text-[11px] flex flex-wrap gap-2">{sources.map((s) => <a key={s.file} href={`#file:${s.file}`}>{s.file.split("/").pop()}</a>)}</nav>}
        {sources.map((s) => (
          <div key={s.file} className="border hair rounded-[6px] bg-raised overflow-hidden">
            <div id={`file:${s.file}`} className="mono text-[12px] px-3 py-2 border-b hair flex justify-between gap-2"><span className="truncate">{s.file}</span><a href={gh(s.file)} target="_blank" rel="noreferrer" className="shrink-0" title="Open on GitHub at this commit">↗ GitHub</a></div>
            <div className="code mono text-[12px] overflow-auto py-2" dangerouslySetInnerHTML={{ __html: s.html }} />
          </div>
        ))}
        {sources.length === 0 && <p className="text-ink2 text-[13px]">No files were cited.</p>}
      </aside>
    </div>
  );
}

function Stage({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return <section className="fade"><div className="label mb-2">Stage {n} · {title}</div>{children}</section>;
}
function Col({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <div><div className="label mb-1">{title}</div>{items.length ? <ul className="grid gap-1">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-ink2">{empty}</p>}</div>;
}
