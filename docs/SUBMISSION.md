# Submission sheet: Meta Global AI Developer Hackathon (Nov 4 2026)

Answers for the Cerebral Valley submission form. Every claim here is backed by the README status table, `docs/VALIDATION_*.md`, `feasibility/EVAL.md` or `/api/status` on the live deployment. Fields marked **Owner** need the author's own judgment or action.

## Form fields

| Field | Answer |
|---|---|
| Team name | SaveBell (**Owner** may change) |
| Team members | Chewon Cho (solo) |
| Track | Indie Developer Track |
| Problem statement | Build for Your World |
| Public GitHub repository | https://github.com/chewonc/save-bell (public, Apache-2.0, created Oct 31 2026) |
| 3-minute demo video (YouTube) | **Owner:** record per `docs/DEMO.md`, upload, paste the URL |
| X post (Most Viral, optional) | **Owner:** only if posted |
| Partner technologies feedback (optional) | Not used. We applied for credits but did not need hosted open-weight inference. |
| Survey ratings (Meta Model API, Muse Code) | **Owner** |
| Consent checkbox | **Owner** |

### Why Build for Your World

The author works on AI-safety research and maintains agent and MCP code. New AI-security threats (prompt injection, MCP tool poisoning, agent SDK flaws) mostly arrive as blog posts and papers without CVE ids, so dependency scanners never see them. The firsthand question is: which of my own repositories does this new report actually touch, and where? SaveBell answers that question for the author's repositories, using Meta's models to turn prose threat reports into conditions that code can check.

### Project description (about 120 words)

SaveBell is continuous AI-security threat intelligence connected to your actual code. It follows GitHub advisories, NVD, OSV, CISA KEV, arXiv and AI-security research around the clock, fact-checks each report against primary sources, and decides whether it applies to the GitHub repositories you connect, down to the file and line. Every citation is re-read from the real file and the verdict comes from a fixed rule, never from the model alone. You get a plain alert, a dated threat timeline, a grounded simulation of what your users could experience, and a fix: Meta Muse Code edits a clone in an isolated runner and runs your tests, and nothing is written until you approve the exact patch. Coding agents connect over MCP. Open source, built solo during the hackathon.

### Describe your use of Meta products

Meta Model API with **Muse Spark 1.3** is the reasoning layer in eight stages, each followed by a code check:

1. Turning advisories, blog posts and papers into checkable code conditions (strict JSON schema).
2. Fact-checking each report on the Responses API with Meta's built-in **web_search**: any URL the model cites that the search never returned is discarded, and registry lookups decide whether cited ids exist.
3. Agentic repository investigation with **tool calling** (list, search, read at a pinned commit).
4. Judging each condition with file:line citations, every one re-read from the file.
5. A dated threat timeline, where every extracted date must be quoted verbatim from its source.
6. A grounded user-impact simulation, downgraded to "hypothetical" wherever the code evidence does not support a step.
7. Fix previews.
8. UI translation (Korean ships as a reviewed dictionary; other languages are translated by Spark with identifiers protected).

**Meta Muse Code** is the remediation agent: it runs headless (`muse exec`) in an ephemeral GitHub Actions runner with a file allowlist, the runner regenerates lockfiles and runs the repository's tests, and SaveBell writes to GitHub only after the user approves that exact patch. This produced draft PR chewonc/argus-demo-api#2 on production (tests 2/2 passed, lockfile regenerated). Muse Code is also documented as an MCP client of SaveBell (verified locally).

**Muse Wonder 1.0** is wired as an optional, off-by-default reviewer of date conflicts in the threat timeline. One real call was made from a local check; it is off on production.

The application itself was developed with Claude Code, not Muse Code.

### Why are Meta's models important to your solution?

Without Spark, SaveBell is a lockfile version matcher. The conditions that make an AI-agent threat real ("authorization is checked only in middleware", "an MCP tool forwards untrusted issue text to a privileged tool") exist only in prose, and Spark is what turns them into something code can verify. Three capabilities mattered: strict JSON-schema output (every stage is schema-validated), web_search on the Responses API for source-grounded fact-checking, and tool calling for bounded repository exploration. On the 16-case labelled evaluation (`feasibility/EVAL.md`, 4 adversarial), the rule verdict was 16/16 with zero false "Not affected", and a prompt-injected feed item did not change the outcome.

## Reproducible demo flow (no account needed for steps 1–3)

1. Open https://save-bell.vercel.app → **What We Monitor** shows each source with its real last collection time.
2. **See real findings (no sign-in)** → `/demo` lists results on the evaluation fixtures in this repository.
3. Open the c1 finding: status, file:line link to GitHub at the assessed commit, the conditions with evidence, report credibility and the dated threat timeline.
4. Signed in: Threats → a finding → Fix modal: **Verify** re-checks the code, **Auto Fix** prepares a Muse Code patch, review the diff, **Approve & create PR**.
5. `/api/status` shows the scheduler, per-source latency and `meta.by_stage` model usage.

## Checklist before submitting

- [ ] Video recorded, uploaded, link works in a private window (**Owner**)
- [ ] Official Rules read in the Cerebral Valley account (**Owner**)
- [x] Repository public, licence present, contributors listed (solo)
- [x] README status table states what is live, local or not verified
- [ ] Latest commits pushed and deployed (**Owner approval**)

## Known gaps (stated, not hidden)

- Web Push is implemented and unit-tested, with a test-notification button, but VAPID keys are not set on production, so no push has been delivered there.
- Fix & push (automatic merge after checks) has never run; the demo repository has no CI checks, and SaveBell refuses to merge without them.
- Agentic investigation, simulation and Spark translation are verified locally, not observed on production.
- X, LinkedIn, Threads and Reddit are not monitored (paid API, no search API, App Review, sunset), as listed on `/sources`.
