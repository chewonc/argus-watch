// Finding page: status, plain title, location, what is wrong, how to fix it, and one GitHub link. The full
// analysis (sources, dates, conditions, evidence, code) is preserved behind one collapsed "Technical details".
import Link from "next/link";
import { notFound } from "next/navigation";
import { codeToHtml } from "shiki";
import { StatusPill, firstSentence, lineAnchor, suggestedFix } from "@/components/alerts";
import { FixPreview } from "@/components/fix-preview";
import { CredibilityChip, CredibilityPanel } from "@/components/credibility";
import { SimulateImpact } from "@/components/simulate-impact";
import { AskAgent } from "@/components/ask-agent";
import { MarkRead } from "@/components/mark-read";
import { listAgentTokens } from "@/lib/agent-token";
import { Band, Chip, Timeline } from "@/components/ui";
import { env, hasGitHubApp, hasRunner } from "@/lib/env";
import { canFix } from "@/lib/fixgate";
import { installationPermissions } from "@/lib/github-app";
import { getDict, getLocale, tr } from "@/lib/i18n";
import { isVerified, location, matchedTech, plainTitle, statusOf, localized, whereLine } from "@/lib/labels";
import { permalink, provenanceOf } from "@/lib/remediation";
import { readFile } from "@/lib/repo";
import { deriveSeverity } from "@/lib/severity";
import { canSee, isSystemRepo, requireUser } from "@/lib/session";
import { store } from "@/lib/store";
import type { Assessment } from "@/lib/schema";
import { modelName } from "@/lib/labels";
import { relevance } from "@/lib/verdict";

export const dynamic = "force-dynamic";

export default async function Case({ params }: { params: Promise<{ id: string[] }> }) {
  const { id } = await params;
  const aid = id.map(decodeURIComponent).join("/");
  const user = await requireUser(`/case/${id.join("/")}`);
  const a = await store.getAssessment(aid);
  if (!a || !(await canSee(user.id, a.repo))) notFound();
  const [ur, demoRepo, fixes, w, resolvedSet] = await Promise.all([store.getUserRepo(user.id, a.repo), isSystemRepo(a.repo), store.listFixes(a.id), store.getRepo(a.repo), store.resolvedSet(user.id)]);
  const latestFix = fixes.find((x) => x.status === "pr_created") ?? fixes.find((x) => x.status === "drafted") ?? fixes[0] ?? null;
  const locale = await getLocale();
  const d = await getDict(locale);
  const f = await store.getFinding(a.finding_id);
  const itemsAll = f ? (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x) => !!x) : [];
  // Replays and re-deliveries store separate items for the same source occurrence; show each occurrence once.
  const items = itemsAll.filter((it, i) => itemsAll.findIndex((o) => o.source === it.source && o.url === it.url && o.title === it.title) === i);
  const repoOnly = a.repo.split("/").slice(0, 2).join("/");
  const gh = (file: string, line?: number | null) => permalink(repoOnly, a.sha, file, line);
  const advisoryText = items.map((i) => i.text).join("\n");
  const PROV_ORDER = ["ADVISORY-STATED", "REPO-INFERRED", "SPECULATIVE"] as const;
  const recs0 = a.recommendations.map((r) => ({ ...r, prov: provenanceOf(r.text, advisoryText, r.condition_ids, a) })).sort((x, y) => PROV_ORDER.indexOf(x.prov) - PROV_ORDER.indexOf(y.prov));

  const sev = a.severity ?? deriveSeverity(a, items);
  const loc = location(a);
  const prFix = fixes.find((x) => x.status === "pr_created") ?? null;
  const status = localized(statusOf(a, sev, { resolved: resolvedSet.includes(a.id), prOpen: !!prFix }), d);
  const verified = isVerified(a);
  const title0 = plainTitle(a, f, loc, w?.tech_tags, w?.packages.map((p) => p.name));
  const where = whereLine(a, loc);
  const tech = matchedTech(f, w?.tech_tags, w?.packages.map((p) => p.name)) ?? "a tool you use";

  // Translate the dynamic text of this case in one bounded batch (identifiers, paths and package names protected).
  const keep = [...new Set([...(f?.claim?.packages.map((p) => p.name) ?? []), ...a.locations.map((l) => l.file)])];
  const srcProblem = f?.claim?.summary ? firstSentence(f.claim.summary) : a.verdict_qualifier;
  const srcFix = suggestedFix(a);
  const texts = [title0, srcProblem, srcFix ?? "", f?.claim?.summary ?? "", a.verdict_qualifier, ...a.conditions.flatMap((c) => [c.text, c.reasoning]), ...recs0.map((r) => r.text), ...a.missing_evidence, ...a.locations.map((l) => l.why)];
  const tx = locale === "en" ? texts : await tr(locale, texts, keep);
  let ti = 0; const next = () => tx[ti++] ?? "";
  const T = { title: next(), problem: next(), fix: next() || null, summary: next(), qualifier: next() };
  const condT = a.conditions.map(() => ({ text: next(), reasoning: next() }));
  const recs = recs0.map((r) => ({ ...r, text: next() }));
  const missingT = a.missing_evidence.map(() => next());
  const locWhy = a.locations.map(() => next());

  // Source excerpts: the files cited by evidence, highlighted (server-side Shiki; read-only fetch at the assessed sha)
  const cited = [...new Set([...a.locations.map((l) => l.file), ...a.conditions.flatMap((c) => c.evidence.map((e) => e.file))])];
  const sources = await Promise.all(cited.slice(0, 6).map(async (file) => {
    const text = (await readFile(repoOnly, a.sha, file)) ?? "";
    const lines = new Set([...a.locations.filter((l) => l.file === file).map((l) => l.line), ...a.conditions.flatMap((c) => c.evidence.filter((e) => e.file === file && e.line).map((e) => e.line!))]);
    const lang = /\.(ts|tsx)$/.test(file) ? "tsx" : /\.(js|mjs|cjs|jsx)$/.test(file) ? "javascript" : /\.json$/.test(file) ? "json" : /\.ya?ml$/.test(file) ? "yaml" : /Dockerfile$/.test(file) ? "dockerfile" : /\.py$/.test(file) ? "python" : "text";
    const html = text ? await codeToHtml(text.split("\n").slice(0, 400).join("\n"), { lang, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false,
      transformers: [{ line(node, line) { node.properties.class = `line${lines.has(line) ? " hit" : ""}`; node.properties.id = lineAnchor(file, line); } }] }) : "<pre>(file not readable at this commit)</pre>";
    return { file, html };
  }));

  const writeOk = env.FIX_ENABLED && ur?.installation_id && hasGitHubApp() ? await installationPermissions(ur.installation_id).then((p) => p.contents === "write" && p.pull_requests === "write").catch(() => false) : null;
  const fixAllowed = !prFix && canFix(a, { allowPr: !!ur?.allow_pr, isDemo: demoRepo, hasInstallation: !!ur?.installation_id, writePermission: writeOk, loc, priorFailed: fixes.length > 0 && fixes.every((x) => x.status === "failed") });
  const agentConnected = (await listAgentTokens(user.id)).length > 0;
  const ghUrl = verified && loc ? permalink(repoOnly, a.sha, loc.file, loc.from, loc.to) : null;
  const severeUnverified = !verified && a.verdict !== "Not Affected" && (sev.level === "critical" || sev.level === "high");

  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-10 grid gap-8">
      <MarkRead assessmentId={a.id} />
      <div className="grid gap-3">
        <Link href="/alerts" className="text-[13px] text-ink2 no-underline hover:text-ink w-fit">← {d.back_to_alerts}</Link>
        <div className="flex flex-wrap items-center gap-2"><StatusPill s={status} /><CredibilityChip c={f?.credibility} l={{ none: d.report_not_checked, prefix: d.report_prefix }} /></div>
        <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-[-0.02em] leading-tight">{T.title}</h1>
        {where.kind === "file" || where.kind === "package"
          ? <div className="mono text-[13px] text-ink2 break-all">{where.kind === "file" && loc ? `${loc.file}:${loc.from}${loc.to !== loc.from ? `–${loc.to}` : ""}` : where.text}</div>
          : <div className="text-[14px] text-ink2">{verified ? where.text : severeUnverified ? d.could_be_serious : loc && a.verdict !== "Not Affected" ? d.not_confirmed_code_found.replace("{where}", `${loc.file.split("/").pop()}:${loc.from}`) : d.not_confirmed_long.replace("{tech}", tech)}</div>}
        {a.agent && <p className="text-[13px] text-ink2">{a.agent.status === "confirmed" ? "Confirmed" : a.agent.status === "not_affected" ? "Marked not affected" : "Fix proposed"} by your AI agent on {new Date(a.agent.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Argus checked the lines it cited{a.verdict !== "Affected" && a.agent.status === "confirmed" ? "; Argus's own analysis had not confirmed this" : ""}.</p>}
      </div>

      {a.verdict === "Not Affected" ? (
        <p className="text-[15px] leading-relaxed">This threat doesn&apos;t affect your project: the code it needs isn&apos;t there. We&apos;ll check again when your code changes.</p>
      ) : (
        <div className="grid gap-6">
          <section className="grid gap-1.5"><h2 className="text-[15px] font-semibold">{d.whats_wrong}</h2><p className="text-[15px] leading-relaxed">{T.problem}</p></section>
          {T.fix && <section className="grid gap-1.5"><h2 className="text-[15px] font-semibold">{d.how_to_fix}</h2><p className="text-[15px] leading-relaxed">{T.fix}</p></section>}
        </div>
      )}

      {a.verdict !== "Not Affected" && <div className="border-t hair pt-5"><SimulateImpact assessmentId={a.id} repo={repoOnly} sha={a.sha} title={d.what_if_not_fixed} button={d.simulate_impact} intro={d.simulate_intro} locale={locale} /></div>}

      <div className="border-t hair pt-5"><CredibilityPanel c={f?.credibility} title={d.is_threat_real} none={d.report_not_checked_long} /></div>

      {(ghUrl || prFix?.pr_url) && (
        <div className="flex flex-wrap items-center gap-2">
          {ghUrl && <a href={ghUrl} target="_blank" rel="noreferrer" className="btn-ghost">{d.open_in_github} <span aria-hidden>↗</span></a>}
          {prFix?.pr_url && <a href={prFix.pr_url} target="_blank" rel="noreferrer" className="btn">Review draft pull request{prFix.pr_number ? ` #${prFix.pr_number}` : ""} <span aria-hidden>↗</span></a>}
        </div>
      )}
      {fixAllowed && <div id="fix"><FixPreview assessmentId={a.id} initial={latestFix} allowPr={!!ur?.allow_pr} isDemoRepo={demoRepo} verdict={a.verdict} defaultBranch={w?.default_branch ?? "main"} repo={repoOnly} museEnabled={hasRunner()} museLabels={{ title: d.automated_fix, pr: d.fix_create_pr, push: d.fix_push, recommended: d.recommended }} labels={{ proposed_fix: d.proposed_fix, draft_fix: d.fix, drafting: d.drafting, re_draft: d.re_draft, approve: d.approve_open_pr, not_verified: d.not_verified }} /></div>}

      {a.verdict !== "Not Affected" && <AskAgent id={a.id} connected={agentConnected} verified={verified} />}

      <details className="disclose border-t hair pt-5">
        <summary>{d.technical_details}</summary>
        <div className="grid gap-8 mt-6">
          <Stage title="Where this came from">
            <ul className="grid gap-2 text-[13px]">
              {items.map((it) => <li key={it.id}><span className="text-ink2 mr-2">{it.source}</span>{it.url ? <a href={it.url} target="_blank" rel="noreferrer">{it.title}</a> : it.title}</li>)}
            </ul>
            {f?.claim && <p className="mt-3 text-[13px]">{T.summary}</p>}
            <div className="mono text-[12px] text-ink2 mt-2 break-all">{f?.ids.join(" · ")} · {a.repo} @{a.sha.slice(0, 7)} · {a.tier}{a.replayed ? " · replayed" : ""} · severity {sev.level}{sev.cvss != null ? ` (CVSS ${sev.cvss})` : ""}{sev.source === "estimated" ? " (estimated)" : ""} · {relevance(a.verdict, a.tier, a.conditions)}</div>
          </Stage>

          {a.agent && (
            <Stage title="Your AI agent's report">
              <p className="text-[13px]">{a.agent.summary}</p>
              <ul className="mono text-[12px] mt-2 grid gap-1">{a.agent.evidence.map((e, i) => <li key={i}><a href={gh(e.file, e.line)} target="_blank" rel="noreferrer">{e.file}:{e.line} ↗</a> <span className="text-ink2">{e.quote}</span></li>)}</ul>
              {a.agent.pr_url && <a href={a.agent.pr_url} target="_blank" rel="noreferrer" className="text-[13px]">Pull request ↗</a>}
            </Stage>
          )}

          <Stage title="Dates"><Timeline a={a} /></Stage>

          <Stage title="Does this affect your project?">
            {a.dependency ? <p className="text-[13px]">Affected package <span className="mono">{a.dependency.name}@{a.dependency.version}</span> found in <span className="mono">{a.dependency.source_file}</span>.</p> : <p className="text-[13px] text-ink2">No affected package named in this report; matched on the technologies your project uses.</p>}
            <p className="text-[12px] text-ink2 mt-1">Having a vulnerable version doesn&apos;t by itself mean your app is affected.</p>
          </Stage>

          <Stage title="Where in your code">
            {a.locations.length === 0 && <p className="text-[13px] text-ink2">Affected file not found. That doesn&apos;t prove the code is safe.</p>}
            <ul className="grid gap-1 text-[13px]">
              {a.locations.map((l, i) => <li key={i}><a href={gh(l.file, l.line)} target="_blank" rel="noreferrer" className="mono">{l.file}:{l.line} ↗</a> <span className="text-ink2">{locWhy[i]}</span></li>)}
            </ul>
          </Stage>

          <Stage title="When could this happen?">
            <ul className="grid gap-3">
              {a.conditions.map((c, ci) => (
                <li key={c.id} className="grid sm:grid-cols-[130px_1fr] gap-2 sm:gap-3 items-start border-b hair pb-3">
                  <Chip state={c.state} />
                  <div>
                    <div className="text-[14px]">{condT[ci].text}</div>
                    <div className="text-[12px] text-ink2 mt-1">{c.role === "required" ? "required condition" : `missing protection · ${c.mitigation_kind}`}{c.computed ? " · computed in code" : ""}</div>
                    <div className="text-[12px] mt-1">{condT[ci].reasoning}</div>
                    {c.evidence.length > 0 && <div className="mono text-[12px] mt-1">{c.evidence.map((e, i) => <a key={i} href={gh(e.file, e.line)} target="_blank" rel="noreferrer" className="mr-3">{e.file.split("/").slice(-2).join("/")}{e.line ? `:${e.line}` : ""} ↗</a>)}</div>}
                    {c.state === "Unknown" && <div className="text-[12px] text-ink2 mt-1">Missing evidence: nothing in the inspected files establishes this.</div>}
                  </div>
                </li>
              ))}
            </ul>
          </Stage>

          <Stage title="How this was analysed"><Provenance a={a} extracted={f?.claim?.conditions.length ?? null} /></Stage>

          <Stage title="How sure are we?">
            <Band a={a} qualifier={T.qualifier} />
            <div className="grid sm:grid-cols-3 gap-4 mt-4 text-[13px]">
              <Col title="Supporting evidence" items={a.conditions.map((c, ci) => ({ c, t: condT[ci].text })).filter(({ c }) => c.state === "Observed" || c.state === "Inferred").map(({ c, t }) => `${c.state}: ${t}`)} empty="None." />
              <Col title="Missing evidence" items={missingT} empty="None identified in inspected files." />
              <Col title="Unverified" items={a.unverified} empty="—" />
            </div>
          </Stage>

          {a.verdict !== "Not Affected" && recs.length > 0 && (
            <Stage title="All recommended steps">
              <ol className="grid gap-2 text-[14px] list-decimal pl-5">
                {recs.map((r, i) => <li key={i}>{r.text}<span className="text-[11px] text-ink2 ml-2">{r.prov.toLowerCase().replace("-", " ")}</span></li>)}
              </ol>
            </Stage>
          )}

          {sources.length > 0 && (
            <Stage title={`Code at ${a.sha.slice(0, 7)} (read-only)`}>
              <div className="grid gap-4">
                {sources.map((s) => (
                  <div key={s.file} className="border hair rounded-[8px] bg-raised overflow-hidden">
                    <div id={`file-${s.file.replace(/[^A-Za-z0-9._-]/g, "_")}`} className="mono text-[12px] px-3 py-2 border-b hair flex justify-between gap-2"><span className="truncate">{s.file}</span><a href={gh(s.file)} target="_blank" rel="noreferrer" className="shrink-0">GitHub ↗</a></div>
                    <div className="code mono text-[12px] overflow-auto max-h-[420px] py-2" dangerouslySetInnerHTML={{ __html: s.html }} />
                  </div>
                ))}
              </div>
            </Stage>
          )}
        </div>
      </details>
    </div>
  );
}

/** Which steps Meta's model did and which steps code did, with the counts code checked. */
function Provenance({ a, extracted }: { a: Assessment; extracted: number | null }) {
  const name = modelName(a.model);
  const computed = a.conditions.filter((c) => c.computed).length;
  const judged = a.conditions.filter((c) => !c.computed);
  const downgraded = judged.filter((c) => /downgraded|could not be verified|returned no state/.test(c.reasoning)).length;
  const dropped = Number(a.unverified.map((u) => /^(\d+) citation\(s\) failed/.exec(u)?.[1]).find(Boolean) ?? 0);
  const steps: [string, string][] = [
    ["Read the report", extracted == null ? "—" : `${name} turned the report into ${extracted} checkable code condition${extracted === 1 ? "" : "s"}.`],
    ["Version check", computed ? `${computed} package version condition${computed === 1 ? "" : "s"} computed in code from your lockfile.` : "No package version to compute."],
    ...(a.investigation ? [["Investigate", a.investigation.steps ? `${modelName(a.investigation.model)} explored the repository with read-only tools in ${a.investigation.steps} step${a.investigation.steps === 1 ? "" : "s"} (${a.investigation.tools.slice(0, 6).join(" → ")})${a.investigation.added.length ? ` and added ${a.investigation.added.map((p) => p.split("/").pop()).join(", ")} to the evidence` : ""}.` : a.investigation.rationale] as [string, string]] : []),
    ["Read your code", a.model === "none" ? (a.hosted === "capped" ? "Skipped: monthly analysis budget reached." : "Not needed: version check only.") : `${name} judged ${judged.length} condition${judged.length === 1 ? "" : "s"} against the cited files and pointed to ${a.locations.length + dropped} line${a.locations.length + dropped === 1 ? "" : "s"}.`],
    ["Proof check", a.model === "none" ? "—" : `Code checked every cited line against the real file: ${a.locations.length} kept, ${dropped} rejected${downgraded ? `, ${downgraded} condition${downgraded === 1 ? "" : "s"} downgraded to Unknown` : ""}.`],
    ["Verdict", `${a.verdict}, decided by a fixed rule in code, never by the model.`],
  ];
  return (
    <ol className="grid gap-1.5 text-[13px]">
      {steps.map(([k, v]) => <li key={k} className="grid sm:grid-cols-[130px_1fr] gap-1 sm:gap-3"><span className="text-ink2">{k}</span><span>{v}</span></li>)}
    </ol>
  );
}

function Stage({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="text-[13px] font-semibold mb-2">{title}</h3>{children}</section>;
}
function Col({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <div><div className="label mb-1">{title}</div>{items.length ? <ul className="grid gap-1">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-ink2">{empty}</p>}</div>;
}
