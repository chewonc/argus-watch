// Signed-out landing page. The page itself shows the product's loop: a threat appears, Argus checks it against your
// repository, you get a plain alert with the exact line, and you fix it with your approval. Every claim here is a
// shipped capability; the examples are labelled as examples.
import Link from "next/link";
import { StatusPill } from "@/components/alerts";
import { SignInButton } from "@/components/sign-in-button";

const STEPS = [
  { k: "01", t: "A new threat is published", d: "Argus follows security advisories, vulnerability databases and security research around the clock." },
  { k: "02", t: "Checked against your code", d: "It looks at your packages and the code that matters, and cites the exact lines. Nothing is run." },
  { k: "03", t: "You get a plain alert", d: "What's wrong, where, and how sure we are. Unconfirmed issues are clearly marked as possible." },
  { k: "04", t: "Fix it with your approval", d: "Open the exact line on GitHub, or let your own AI coding agent fix it in your editor." },
];

export function Landing({ signin, next, authReady, signedIn = false }: { signin: boolean; next?: string; authReady: boolean; signedIn?: boolean }) {
  return (
    <div className="mx-auto max-w-[1080px] px-4 sm:px-6">
      <section className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center py-14 sm:py-20">
        <div className="grid gap-6">
          <div className="inline-flex items-start gap-2 text-[13px] text-ink2"><span aria-hidden className="relative flex w-2 h-2 shrink-0 mt-[6px]"><span className="absolute inset-0 rounded-full bg-[var(--not-affected)] opacity-60 pulse" /><span className="relative w-2 h-2 rounded-full bg-[var(--not-affected)]" /></span><span>AI threats evolve every day.<br />Your defenses should keep up.</span></div>
          <h1 className="text-[40px] sm:text-[52px] font-semibold tracking-[-0.035em] leading-[1.04]">Know when new security threats affect your code, and fix them.</h1>
          <p className="text-[17px] leading-relaxed text-ink2 max-w-[520px]">Argus Watch connects emerging vulnerabilities and attacks to the exact lines in your repositories, so you hear about what matters to you, not everything on the internet.</p>
          {signin && <p className="text-[14px] tone-warn">Sign in to continue{next ? ` to ${next}` : ""}.</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {signedIn ? <Link href="/alerts" className="btn">Open your alerts</Link> : authReady ? <SignInButton next={next ?? "/alerts"} /> : <span className="text-[13px] text-ink2">Sign-in is not configured on this deployment yet.</span>}
            <span className="text-[13px] text-ink2">Read-only · nothing changes without your approval</span>
          </div>
        </div>
        <Loop />
      </section>

      <section aria-labelledby="how" className="py-14 border-t hair grid gap-10">
        <h2 id="how" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink2">How it works</h2>
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

      <section className="py-14 border-t hair grid md:grid-cols-3 gap-8 text-[14px]">
        <div className="grid gap-1.5 content-start"><span className="font-semibold">Evidence, not guesses</span><span className="text-ink2 leading-relaxed">An issue is marked as affecting you only when the code that makes it possible is found and cited. Everything else is labelled a possible issue.</span></div>
        <div className="grid gap-1.5 content-start"><span className="font-semibold">Read-only by default</span><span className="text-ink2 leading-relaxed">Argus reads your lockfiles and the files it cites. It never runs your code, and never changes your repository without your approval.</span></div>
        <div className="grid gap-1.5 content-start"><span className="font-semibold">Works with your AI agent</span><span className="text-ink2 leading-relaxed">Connect Claude Code or Codex once, and ask it to investigate and fix an alert in your editor using your own AI plan.</span></div>
      </section>
    </div>
  );
}

/** The product loop drawn with the product's own components: threat → repository → alert → fix. */
function Loop() {
  return (
    <div aria-label="Example of how an alert is produced" className="relative grid gap-3">
      <span className="absolute left-[19px] top-6 bottom-6 w-px bg-[var(--line)]" aria-hidden />
      <Row n="Threat">
        <div className="text-[12px] text-ink2">Security advisory · 12 min ago</div>
        <div className="text-[14px] font-medium">Token verification bypass in a popular JWT library</div>
      </Row>
      <Row n="Your code">
        <div className="text-[12px] text-ink2">acme/api · checked against your repository</div>
        <pre className="mono text-[12px] leading-[1.6] overflow-hidden"><span className="text-ink2">9  </span>try {"{"}{"\n"}<span className="block -mx-2 px-2 bg-[color-mix(in_oklab,var(--sev-high)_12%,transparent)]"><span className="text-ink2">10 </span>  req.user = jwt.verify(token, key);</span></pre>
      </Row>
      <Row n="Alert" strong>
        <div className="flex items-center justify-between gap-3"><StatusPill s={{ label: "Important", glyph: "▲", tone: "sev-high" }} /><span className="text-[12px] text-ink2">Example</span></div>
        <div className="text-[15px] font-semibold">Your login tokens could be forged</div>
        <div className="mono text-[12px] text-ink2">src/auth.ts:10</div>
      </Row>
      <Row n="Fix">
        <div className="text-[14px]">Upgrade the library and pin the allowed algorithm.</div>
        <div className="flex gap-2"><span className="btn-ghost !h-7 !text-[12px]" aria-hidden>Open file in GitHub ↗</span><span className="btn-ghost !h-7 !text-[12px]" aria-hidden>Ask your AI agent</span></div>
      </Row>
    </div>
  );
}

function Row({ n, strong, children }: { n: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative grid grid-cols-[40px_1fr] gap-3 items-start">
      <span className="relative z-[1] mt-3 justify-self-center w-[9px] h-[9px] rounded-full border-2 border-[var(--bg)] bg-[var(--ink-2)]" style={strong ? { background: "var(--sev-high)" } : undefined} aria-hidden />
      <div className={`border hair rounded-[10px] bg-raised px-4 py-3 grid gap-1.5 ${strong ? "shadow-[0_6px_24px_rgba(0,0,0,0.06)]" : ""}`}>
        <span className="sr-only">{n}: </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink2" aria-hidden>{n}</span>
        {children}
      </div>
    </div>
  );
}
