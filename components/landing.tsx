// Signed-out landing page. The page itself shows the product's loop: a threat appears, Argus checks it against your
// repository, you get a plain alert with the exact line, and you fix it with your approval. Every claim here is a
// shipped capability; the examples are labelled as examples. Text comes from the UI dictionary so it is translated.
import Link from "next/link";
import { StatusPill } from "@/components/alerts";
import { SignInButton } from "@/components/sign-in-button";
import type { Dict } from "@/lib/i18n/dictionary";

export function Landing({ signin, next, authReady, signedIn = false, d }: { signin: boolean; next?: string; authReady: boolean; signedIn?: boolean; d: Dict }) {
  const STEPS = [
    { k: "01", t: d.step1_t, d: d.step1_d }, { k: "02", t: d.step2_t, d: d.step2_d },
    { k: "03", t: d.step3_t, d: d.step3_d }, { k: "04", t: d.step4_t, d: d.step4_d },
  ];
  return (
    <div className="mx-auto max-w-[1080px] px-4 sm:px-6">
      <section className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center py-14 sm:py-20">
        <div className="grid gap-6 min-w-0">
          <div className="inline-flex items-start gap-2 text-[13px] text-ink2"><span aria-hidden className="relative flex w-2 h-2 shrink-0 mt-[6px]"><span className="absolute inset-0 rounded-full bg-[var(--not-affected)] opacity-60 pulse" /><span className="relative w-2 h-2 rounded-full bg-[var(--not-affected)]" /></span><span>{d.landing_eyebrow}</span></div>
          <h1 className="text-[40px] sm:text-[52px] font-semibold tracking-[-0.035em] leading-[1.04] break-keep">{d.landing_h1}</h1>
          <p className="text-[17px] leading-relaxed text-ink2 max-w-[520px]">{d.landing_sub}</p>
          {signin && <p className="text-[14px] tone-warn">{d.signin_continue}{next ? ` → ${next}` : ""}.</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {signedIn ? <Link href="/alerts" className="btn">{d.open_your_alerts}</Link> : authReady ? <SignInButton next={next ?? "/alerts"} label={d.sign_in} /> : <span className="text-[13px] text-ink2">{d.signin_unconfigured}</span>}
            <span className="text-[13px] text-ink2">{d.read_only_note}</span>
          </div>
        </div>
        <Loop d={d} />
      </section>

      <section aria-labelledby="how" className="py-14 border-t hair grid gap-10">
        <h2 id="how" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink2">{d.how_it_works}</h2>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {STEPS.map((s) => (
            <li key={s.k} className="grid gap-2 content-start">
              <span className="mono text-[12px] text-ink2">{s.k}</span>
              <span className="text-[16px] font-semibold">{s.t}</span>
              <span className="text-[14px] leading-relaxed text-ink2">{s.d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="py-14 border-t hair grid gap-8 max-w-[560px] text-[14px]">
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
        <div className="text-[12px] text-ink2">{d.loop_ago}</div>
        <div className="text-[14px] font-medium">{d.loop_threat_title}</div>
      </Row>
      <Row n={d.loop_code}>
        <div className="text-[12px] text-ink2">{d.loop_checked}</div>
        <pre className="mono text-[12px] leading-[1.6] overflow-hidden" translate="no"><span className="text-ink2">9  </span>try {"{"}{"\n"}<span className="block -mx-2 px-2 bg-[color-mix(in_oklab,var(--sev-high)_12%,transparent)]"><span className="text-ink2">10 </span>  req.user = jwt.verify(token, key);</span></pre>
      </Row>
      <Row n={d.loop_alert} strong>
        <div className="flex items-center justify-between gap-3"><StatusPill s={{ label: d.st_important, glyph: "▲", tone: "sev-high" }} /><span className="text-[12px] text-ink2">{d.loop_example}</span></div>
        <div className="text-[15px] font-semibold">{d.loop_alert_title}</div>
        <div className="mono text-[12px] text-ink2" translate="no">src/auth.ts:10</div>
      </Row>
      <Row n={d.loop_fix}>
        <div className="text-[14px]">{d.loop_fix_text}</div>
        <div className="flex flex-wrap gap-2"><span className="btn-ghost !h-7 !text-[12px]" aria-hidden>{d.open_in_github} ↗</span><span className="btn-ghost !h-7 !text-[12px]" aria-hidden>{d.loop_ask_agent}</span></div>
      </Row>
    </div>
  );
}

function Row({ n, strong, children }: { n: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative grid grid-cols-[40px_1fr] gap-3 items-start">
      <span className="relative z-[1] mt-3 justify-self-center w-[9px] h-[9px] rounded-full border-2 border-[var(--bg)] bg-[var(--ink-2)]" style={strong ? { background: "var(--sev-high)" } : undefined} aria-hidden />
      <div className={`border hair rounded-[10px] bg-raised px-4 py-3 grid gap-1.5 min-w-0 ${strong ? "shadow-[0_6px_24px_rgba(0,0,0,0.06)]" : ""}`}>
        <span className="sr-only">{n}: </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink2" aria-hidden>{n}</span>
        {children}
      </div>
    </div>
  );
}
