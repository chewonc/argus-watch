// Signed-out landing page. The page itself shows the product's loop: a threat appears, SaveBell checks it against your
// repository, you get a plain alert with the exact line, and you fix it with your approval. Every claim here is a
// shipped capability; the examples are labelled as examples. Text comes from the UI dictionary so it is translated.
import Link from "next/link";
import { ReportThreat } from "./report-threat";
import { STATUS_LABEL, groupSummary, type SourceGroup } from "@/lib/monitor-sources";
import { StatusPill } from "@/components/alerts";
import { SignInButton } from "@/components/sign-in-button";
import type { Dict } from "@/lib/i18n/dictionary";

export function Landing({ signin, next, authReady, signedIn = false, d, monitor = [] }: { signin: boolean; next?: string; authReady: boolean; signedIn?: boolean; d: Dict; monitor?: SourceGroup[] }) {
  const STEPS = [
    { k: "01", t: d.step1_t, d: d.step1_d }, { k: "02", t: d.step2_t, d: d.step2_d },
    { k: "03", t: d.step3_t, d: d.step3_d }, { k: "04", t: d.step4_t, d: d.step4_d },
  ];
  return (
    <div className="mx-auto max-w-[calc(1080px*var(--ui))] px-4 sm:px-6">
      <section className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center py-14 sm:py-20">
        <div className="grid gap-6 min-w-0">
          <div className="inline-flex items-start gap-2 text-[calc(13px*var(--ui))] text-ink2"><span aria-hidden className="relative flex w-2 h-2 shrink-0 mt-[calc(6px*var(--ui))]"><span className="absolute inset-0 rounded-full bg-[var(--not-affected)] opacity-60 pulse" /><span className="relative w-2 h-2 rounded-full bg-[var(--not-affected)]" /></span><span>{d.landing_eyebrow}</span></div>
          <h1 className="text-[calc(40px*var(--ui))] sm:text-[calc(52px*var(--ui))] font-semibold tracking-[-0.035em] leading-[1.04] break-keep">{d.landing_h1}</h1>
          <p className="text-[calc(17px*var(--ui))] leading-relaxed text-ink2 max-w-[calc(520px*var(--ui))]">{d.landing_sub}</p>
          {signin && <p className="text-[calc(14px*var(--ui))] tone-warn">{d.signin_continue}{next ? ` → ${next}` : ""}.</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {signedIn ? <Link href="/alerts" className="btn btn-primary">{d.open_your_alerts}</Link> : authReady ? <SignInButton next={next ?? "/alerts"} label={d.sign_in} /> : <span className="text-[calc(13px*var(--ui))] text-ink2">{d.signin_unconfigured}</span>}
            <Link href="/demo" className="text-[calc(14px*var(--ui))]">{d.see_demo}</Link>
            <span className="text-[calc(13px*var(--ui))] text-ink2">{d.read_only_note}</span>
          </div>
        </div>
        <Loop d={d} />
      </section>

      <section aria-labelledby="how" className="py-14 border-t hair grid gap-10">
        <h2 id="how" className="text-[calc(13px*var(--ui))] font-semibold uppercase tracking-[0.08em] text-ink2">{d.how_it_works}</h2>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {STEPS.map((s) => (
            <li key={s.k} className="grid gap-2 content-start">
              <span className="mono text-[calc(12px*var(--ui))] text-ink2">{s.k}</span>
              <span className="text-[calc(16px*var(--ui))] font-semibold">{s.t}</span>
              <span className="text-[calc(14px*var(--ui))] leading-relaxed text-ink2">{s.d}</span>
            </li>
          ))}
        </ol>
      </section>

      <WhatWeMonitor groups={monitor} />

      <section className="py-14 border-t hair grid gap-8 max-w-[calc(560px*var(--ui))] text-[calc(14px*var(--ui))]">
        {[[d.pillar1_t, d.pillar1_d], [d.pillar2_t, d.pillar2_d], [d.pillar3_t, d.pillar3_d]].map(([t, x]) => (
          <div key={t} className="grid gap-1.5 content-start"><span className="font-semibold">{t}</span><span className="text-ink2 leading-relaxed">{x}</span></div>
        ))}
      </section>
    </div>
  );
}

/** The product loop drawn with the product's own components: threat → repository → alert → fix. */
function Loop({ d }: { d: Dict }) {
  return (
    <div aria-label="Example of how an alert is produced" className="relative grid gap-3 min-w-0">
      <span className="absolute left-[19px] top-6 bottom-6 w-px bg-[var(--line)]" aria-hidden />
      <Row n={d.loop_threat}>
        <div className="text-[calc(12px*var(--ui))] text-ink2">{d.loop_ago}</div>
        <div className="text-[calc(14px*var(--ui))] font-medium">{d.loop_threat_title}</div>
      </Row>
      <Row n={d.loop_code}>
        <div className="text-[calc(12px*var(--ui))] text-ink2">{d.loop_checked}</div>
        <pre className="mono text-[calc(12px*var(--ui))] leading-[1.6] overflow-hidden" translate="no"><span className="text-ink2">9  </span>try {"{"}{"\n"}<span className="block -mx-2 px-2 bg-[color-mix(in_oklab,var(--sev-high)_12%,transparent)]"><span className="text-ink2">10 </span>  req.user = jwt.verify(token, key);</span></pre>
      </Row>
      <Row n={d.loop_alert} strong>
        <div className="flex items-center justify-between gap-3"><StatusPill s={{ label: d.st_important, glyph: "▲", tone: "sev-high" }} /><span className="text-[calc(12px*var(--ui))] text-ink2">{d.loop_example}</span></div>
        <div className="text-[calc(15px*var(--ui))] font-semibold">{d.loop_alert_title}</div>
        <div className="mono text-[calc(12px*var(--ui))] text-ink2" translate="no">src/auth.ts:10</div>
      </Row>
      <Row n={d.loop_fix}>
        <div className="text-[calc(14px*var(--ui))]">{d.loop_fix_text}</div>
        <div className="flex flex-wrap gap-2"><span className="btn-ghost !h-7 !text-[calc(12px*var(--ui))]" aria-hidden>{d.open_in_github} ↗</span><span className="btn-ghost !h-7 !text-[calc(12px*var(--ui))]" aria-hidden>{d.loop_ask_agent}</span></div>
      </Row>
    </div>
  );
}

function Row({ n, strong, children }: { n: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative grid grid-cols-[40px_1fr] gap-3 items-start">
      <span className="relative z-[1] mt-3 justify-self-center w-[calc(9px*var(--ui))] h-[calc(9px*var(--ui))] rounded-full border-2 border-[var(--bg)] bg-[var(--ink-2)]" style={strong ? { background: "var(--sev-high)" } : undefined} aria-hidden />
      <div className={`border hair rounded-[10px] bg-raised px-4 py-3 grid gap-1.5 min-w-0 ${strong ? "shadow-[0_6px_24px_rgba(0,0,0,0.06)]" : ""}`}>
        <span className="sr-only">{n}: </span>
        <span className="text-[calc(11px*var(--ui))] font-semibold uppercase tracking-[0.08em] text-ink2" aria-hidden>{n}</span>
        {children}
      </div>
    </div>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return null;
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const DOT = { active: "var(--observed)", delayed: "var(--inferred)", unavailable: "var(--contradicted)", not_configured: "var(--ink-3)", unknown: "var(--ink-3)" } as const;


const Dot = ({ status }: { status: keyof typeof DOT }) => <span aria-hidden className="inline-block w-[calc(7px*var(--ui))] h-[calc(7px*var(--ui))] rounded-full shrink-0" style={{ background: DOT[status] }} />;

/** Sources SaveBell actually collects from, with status from real collector state (lib/monitor-sources.ts). */
function WhatWeMonitor({ groups }: { groups: SourceGroup[] }) {
  if (!groups.length) return null;
  const last = groups.flatMap((g) => g.sources.map((s) => s.last_ok)).filter((x): x is string => !!x).sort().pop() ?? null;
  return (
    <section aria-labelledby="monitor" className="py-14 border-t hair grid gap-6">
      <div className="grid gap-2 max-w-[calc(640px*var(--ui))]">
        <h2 id="monitor" className="text-[calc(13px*var(--ui))] font-semibold uppercase tracking-[0.08em] text-ink2">What we monitor</h2>
        <p className="text-[calc(15px*var(--ui))] leading-relaxed">Security advisories, AI safety research, and emerging AI security threats, collected on a schedule and checked against your code.</p>
      </div>
      {/* One column of collapsible categories: a short health summary by default, the full list on demand. */}
      <div className="grid max-w-[calc(720px*var(--ui))] border-t hair">
        {groups.map((g) => {
          const sum = groupSummary(g.sources);
          return (
            <details key={g.id} className="group border-b hair">
              <summary className="flex items-center justify-between gap-4 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="grid gap-0.5 min-w-0">
                  <span className="text-[calc(15px*var(--ui))] font-semibold">{g.title}</span>
                  <span className="flex items-center gap-2 text-[calc(13px*var(--ui))] text-ink2"><Dot status={sum.worst} />{sum.text}</span>
                </span>
                <span aria-hidden className="text-ink2 text-[calc(14px*var(--ui))] transition-transform group-open:rotate-90">›</span>
              </summary>
              <ul className="grid pb-3 text-[calc(14px*var(--ui))]">
                {g.sources.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-0.5 py-2.5 border-t hair first:border-0">
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-ink no-underline hover:underline [overflow-wrap:anywhere] min-w-0">{s.name}</a>
                    <span className="flex items-center gap-2 shrink-0 text-[calc(12px*var(--ui))] text-ink2">
                      <Dot status={s.status} />
                      {s.status === "active" && <span className="sr-only">Active. </span>}
                      {s.status === "active" ? (s.last_ok ? ago(s.last_ok) : "") : <span>{STATUS_LABEL[s.status]}{s.last_ok ? ` · ${ago(s.last_ok)}` : ""}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      <div className="grid gap-1 text-[calc(13px*var(--ui))] text-ink2">
        {last && <p>Last checked: {ago(last)}. Sources are checked every 5 to 60 minutes, not streamed live.</p>}
        <ReportThreat />
      </div>
    </section>
  );
}
