# Argus Watch

**What touched your code.** Argus Watch continuously watches security advisories and research disclosures, checks each one against the GitHub repositories you connect, and tells you exactly where and why your code is affected, with a proposed fix you can review and open as a draft pull request.

Live: https://argus-watch-three.vercel.app · Solo Indie entry, Meta Global AI Developer Hackathon (Nov 2026) · Apache-2.0

> Read-only by design. Argus Watch never executes repository code, never reproduces or tests a vulnerability, never writes exploit or proof-of-concept code, and never merges. The only write it can ever make is a **draft pull request on a new branch**, after you opt in per repository and approve a specific fix.

## The workflow

## Where Meta's model does the work

Argus Watch runs on **Meta Muse Spark 1.3** through the Meta Model API (`lib/spark.ts`: strict JSON-schema output, temperature 0). Spark does the three steps that need reasoning over unstructured text and code; code checks everything Spark says.

| Step | Spark does | Code then checks | File |
|---|---|---|---|
| Read the threat | Turns an advisory, mailing-list post or AI-security blog post into affected packages and *checkable code conditions* ("auth is enforced only in middleware"). Works for research posts with no CVE or version range. | Merges packages; strips version checks out of conditions (versions are computed from lockfiles instead). | `lib/extract.ts` |
| Read your code | Judges each condition against numbered listings of the relevant files: Observed / Inferred / Unknown / Contradicted, with file:line. | Every citation is matched against the real file; unverifiable, evidence-less or prose-only (README) evidence is downgraded to Unknown. The verdict is a fixed rule (`lib/verdict.ts`). | `lib/analyze.ts` |
| Draft a fix | Proposes minimal search/replace hunks tied to condition ids. | Hunks applied in memory, syntax-checked, diffed, re-assessed; only a draft PR after your approval. | `lib/fix.ts` |

Without Spark, Argus would be a lockfile version matcher: it could not read non-CVE research, and could not say *which line* makes a repository exploitable.

**Evaluation** (`feasibility/EVAL.md`, 16 labelled cases incl. 4 adversarial, Muse Spark 1.3, Nov 1 2026): verdict 16/16, false "Not Affected" 0/10, condition-state accuracy 0.82, prompt-injected feed item did not change the outcome.

```
Discover → Verify → Locate → Explain → Preview → Approve → Fix → Validate → Commit
```

1. **Discover.** GitHub-reviewed advisories arrive by webhook (push). The GitHub Advisory Database and eleven fast disclosure feeds are polled every 5 minutes; CISA KEV every 10 minutes; ten research feeds hourly. Every source is labelled by how it is really monitored and by its *measured* interval; "real-time" appears only for the push source and only after a live delivery has been measured.
2. **Verify.** Items are deduplicated across sources (advisory ids, canonical URLs) and tiered: official, corroborated, or signal. A claim (affected packages, technology tags, failure conditions) is extracted once per text version. Social or single-source reports are capped at "Unclear".
3. **Locate.** Lockfiles are parsed and the installed version is checked against the advisory ranges **in code**; the model then assesses each condition against a numbered listing of the cited files, and every citation is verified mechanically against the real file (an unverifiable citation downgrades the condition to Unknown).
4. **Explain.** The verdict (Affected / Not Affected / Unclear) is decided by a fixed rule, never by the model alone, with the rule shown. Each condition is Observed / Inferred / Unknown / Contradicted with a file:line, and the case page highlights the cited lines in a read-only source pane.
5. **Preview.** A minimal patch is drafted for the cited files and manifests, applied in memory, shown as a diff (additions as ghost text), and syntax-checked (parsed only, never executed).
6. **Static remediation assessment.** Before approval, the patch is compared with the conditions that drove the verdict: version changes are re-computed in code, the patched text is re-assessed with citations verified, a risk screen flags removed checks or dynamic code, and the result is labelled *supported / partially supported / not supported*, with every row tagged COMPUTED, CITATION-VERIFIED, MODEL-ASSUMPTION or UNCHANGED. The ladder always ends with **"Security remediation: not verified"**.
7. **Approve.** A dialog states exactly what will happen (repository, base branch, new branch, files, draft PR, nothing merged). Approval is per fix, and only for repositories where you enabled draft PRs.
8. **Fix / Validate / Commit.** A branch and commit are created through the Git Data API and a draft pull request is opened. The repository's own CI check-runs are shown in a separate panel with the note that CI does not verify that the vulnerability is fixed.

Alongside: per-user notifications (in-app badge, browser push with receipt measurement, Slack/Discord webhook), one notification per finding and repository that is updated in place when a verdict or severity changes, and a language selector covering every language supported by Google Cloud Translation (identifiers, paths, versions and code are never translated).

## Verified status (Nov 2 2026, 04:10 UTC)

Legend: **live** = observed on the deployment; **local** = exercised in a browser against the real pipeline (model calls, real GitHub reads) with a local-only stub sign-in; **blocked** = cannot be exercised by anyone until the owner configures credentials.

| Journey step | Status |
|---|---|
| Discover: GHSA webhook, GitHub Advisory DB, KEV, 21 feeds (Hacker News via the Algolia API since Nov 2), dedup, tiers, claim extraction | **live**: 2 live GHSA deliveries; all four pollers run on the QStash tick schedule (confirmed by schedule-id deliveries, measured 5 / 5 / 10 / 60 min); publish→discover median 224 s for the push source (n=2), 685 s for fast feeds (n=9), backlog excluded |
| Sign in with GitHub | **blocked**: the deployment has no `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `BETTER_AUTH_SECRET`; the landing page says so and the sign-in route answers 503. Code path implemented (Better Auth, stateless) but never run against GitHub. See `SETUP.md` §2.1 |
| Connect a repository (App installation, picker, watch) | **blocked** on the same credentials; the Repos page, per-repo draft-PR opt-in, rescan and remove render and work **local** |
| Analyze the codebase and alert | **live** for admin-registered repos (replay chain c1 Affected / c2 Not Affected / c3 Unclear); **local**: Next.js and jsonwebtoken advisories replayed in 53 s and 43 s, cards show severity, verdict, repo@sha, `file:line`, problem and fix; the file link lands on the highlighted line |
| Preview the fix (diff, syntax check, static assessment, status ladder) | **local**: c1 → `package.json` next 14.2.10→14.2.25, assessment *supported*; c4 → two hunks in `src/auth.ts` (fail-closed key, HS256 allowlist), *partially supported*; ladder always ends "Security remediation: not verified" |
| Approve → draft PR → CI readout | **blocked**: the approval dialog works **local** and the apply route refuses with a clear message when no App installation exists; branch + commit + draft PR + check-runs code is implemented but has **never created a real pull request** |
| Notifications (in-app, badge, settings), per-user webhook | **local**; Web Push **blocked** (no VAPID keys on the deployment) |
| Multilingual UI | dictionary + switcher shipped; translation calls **blocked** (no `GOOGLE_TRANSLATE_API_KEY`); Repos/Settings/Sources/Notifications pages are English-only |
| Unit tests (25) | passing locally and in CI |
| Evaluation set 12 + 4 adversarial (AT-4) | run Nov 1: rule verdict 16/16, false Not Affected 0/10, invented references 0, condition-state accuracy 0.82, injection checks 2/2, gate PASS (`feasibility/EVAL.md`) |
| AT-3 24 h unattended run | window started Nov 2 ~04:05 UTC when the tick schedule first delivered; `/api/status.unattended_24h` reports the ratio |
| Email, X/LinkedIn/Threads/Reddit, VS Code extension, JetBrains | planned or excluded (see docs) |

Measured latency and coverage are published at `/api/status` and on the Sources page; they are computed from stored timestamps over live items only, with first-run backlog excluded, and they read "not yet measured" until data exists.

## Security boundary

- Reads: repository metadata, trees and file contents at one commit, lockfiles. Nothing is cloned.
- Stores: package names and versions, technology tags, cited line excerpts, assessments, notifications. Never full repositories, never secrets (lines that look like credentials are withheld from briefs).
- Executes: nothing from any repository or advisory. Patches are parsed, never run. Tests are never generated or run. CI results are read, never triggered.
- Writes: only a draft pull request on a new branch, after per-repository opt-in and per-fix approval. The default branch is never modified; nothing is merged.
- Untrusted text (advisories, feeds, pages, repository content) is treated as data; prompts fence it and the mechanical citation check keeps model claims anchored to real lines.

## Documents

- `SETUP.md`: environment variables, GitHub App settings, scheduler, local development.
- `docs/USER_GUIDE.md`: how to sign in, connect repositories, read alerts, preview and approve a fix, configure notifications and language.
- `../strategy/14_argus_watch_master_plan.md`: audit, research, architecture, plan, roadmap, acceptance tests.
- `../strategy/research/br_intel_sources_2026-11-01.md`: intelligence-source comparison with references.
- `feasibility/`: evaluation harness and fixture cases.
