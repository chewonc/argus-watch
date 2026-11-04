# Argus Watch

**Continuous AI security threat intelligence, connected to your actual code.** Argus Watch follows security advisories, vulnerability databases, research papers and security news; fact-checks each report; decides whether it really applies to the GitHub repositories you connect, down to the file and line; tells you; and helps you fix it.

Live: https://argus-watch-three.vercel.app · Meta Global AI Developer Hackathon (Nov 2026), theme *Build for Your World* · Apache-2.0

> Built during the hackathon. Every commit in this repository is from Oct 31 – Nov 4 2026 (the event window), by the author. Nothing pre-existing was imported. Third-party code is used only as npm dependencies (MIT, Apache-2.0, ISC, BSD, MPL-2.0 and the LGPL-3.0 `sharp` image binaries pulled in by Next.js), none vendored or modified.

## What it does

```
Threat published → Report fact-checked → Relevant repos found → Code investigated → Impact decided → You are notified → Fix proposed / made
```

1. **Discover.** GitHub-reviewed advisories by webhook; GitHub Advisory Database, 11 fast feeds and Hacker News every 5 min; CISA KEV every 10 min; NVD every 30 min; OSV.dev hourly with the exact package versions in your lockfiles; 10 research and news feeds hourly (arXiv cs.CR, an arXiv prompt-injection/LLM-agent query, OWASP GenAI, Trail of Bits, Snyk/Invariant Labs, Hugging Face, AI Incident Database, Mastodon infosec, Google News). Every source is labelled by how it is really monitored, with measured intervals on `/sources`.
2. **Fact-check the report.** Cited CVE / GHSA / arXiv ids are looked up at NVD, OSV, the GitHub Advisory Database and arXiv. Meta Muse Spark with Meta's built-in web search looks for primary sources, independent reports, copies of one origin and contradictions. A fixed rule labels the report **Verified / Corroborated / Unverified / Disputed / Likely false**. URLs the model cites but the search never returned are discarded; the model can lower a label, never raise it. Disputed or likely-false reports can never produce an "Affected" result.
3. **Investigate your code.** Lockfile versions are checked against affected ranges in code. Muse Spark explores the repository with read-only tools (list, search, read) to find the code that decides each condition, then judges each condition with file:line citations. Every citation is re-read from the real file; unverifiable, prose-only or comment-only evidence is downgraded. The verdict (Affected / Not Affected / Unclear) comes from a fixed rule, never from the model.
4. **Notify.** In-app notifications with unread badge, priority order (unread, confirmed, severity, time), one entry per finding and repository updated in place, Slack/Discord webhook, Web Push when VAPID keys are set.
5. **Show the impact.** "What happens if you don't fix this?" builds a short, hypothetical walkthrough of what a user of *your* app could experience, as screens of your app. Each step says whether it is shown in your code, inferred, or hypothetical; synthetic data only; nothing is executed.
6. **Fix.** A preview diff with a static remediation assessment, then **Fix & create PR** (recommended) or **Fix & push**: Meta Muse Code edits a fresh clone inside an isolated GitHub Actions runner and the runner runs the repository's tests there; only after you approve that exact patch does Argus open a pull request (or, in push mode, merge it after the repository's own checks pass and branch protection allows). Fix & create PR has run on production (draft PR chewonc/argus-demo-api#2); Fix & push has not run yet. See Status. Or connect your own MCP-capable coding agent.

## Where Meta's models do the work

Evidence: **live** = observed on production; **local** = run against the real Meta Model API from a local check or dev server; **not run** = implemented and unit-tested only. Per-stage call and token counts for the current month are on `/api/status` → `meta.by_stage`.

| Stage | Meta capability | What code checks afterwards | Evidence | File |
|---|---|---|---|---|
| Read the threat | Muse Spark 1.3, strict JSON schema | version checks moved to code; packages merged | live | `lib/extract.ts` |
| Fact-check the report | Muse Spark on the Responses API with `web_search` | registry lookups decide existence/rejection; unseen URLs dropped; rule decides label | live | `lib/verify.ts` |
| Investigate the repository | Muse Spark tool calling (list / search / read), ≤6 rounds | discovered files only join the listing; all citations re-verified | local | `lib/investigate.ts` |
| Judge each condition | Muse Spark, numbered listings | citation check, prose/comment caps, rule verdict | live | `lib/analyze.ts` |
| Threat timeline | Muse Spark extracts dated developments from report text and writes the summary; Muse Wonder (optional, `WONDER_ESCALATION=1`) reviews date conflicts | every date and claim quoted verbatim from its source; summary may not add dates, versions or confirmed exploitation; Wonder counts only with a verbatim quote and never removes an event; registry dates are code | Spark: live; Wonder: local | `lib/timeline.ts` |
| Simulate user impact | Muse Spark, structured screens | steps without Observed/Inferred evidence downgraded to hypothetical; real account names and emails replaced | local | `lib/simulate.ts` |
| Fix preview | Muse Spark search/replace hunks | applied in memory, syntax-checked, statically re-assessed | local | `lib/fix.ts` |
| Make the fix | **Meta Muse Code** headless (`muse exec`) in an isolated runner | file allowlist, syntax, tests, then GitHub App write after your approval | live (Fix & create PR) | `scripts/remediate/run.mjs`, `lib/runner.ts` |
| Translate the UI | Muse Spark (identifiers as placeholders) | any translation that drops a placeholder is discarded | local | `lib/i18n/translate.ts` |

Alerts and finding pages show **Analysed by Muse Spark** only when the stored assessment records an actual Muse Spark call on the Meta Model API host (requested model, and on newer records the model the API reported serving). Code-only version checks, budget-capped checks and results reported by your own agent never get the badge.

Muse Wonder 1.0 is used only to review date conflicts in the threat timeline, off by default (`WONDER_ESCALATION`) and off on production; one real Muse Wonder call, made from a local check, is recorded in `docs/VALIDATION_TIMELINE.md`. Models considered and not used: SAM 3.1, Muse Image and Voice Transcribe (no evidence-bearing role in this product), Muse Spark Open / Glimmer (no hosted inference available to us during the event), contributor mode (would make users' code training data).

**Evaluation** (`feasibility/EVAL.md`, 16 labelled cases incl. 4 adversarial): rule verdict 16/16, false "Not Affected" 0/10, prompt-injected feed item did not change the outcome. Live checks in `scripts/checks/` (report credibility, sources, simulation, agentic investigation).

## Status (Nov 4 2026)

Legend: **live** = observed on the production deployment; **local** = exercised end to end against real APIs and Meta models, with a local sign-in stub; **not verified** = implemented, waiting on configuration.

| Capability | Status |
|---|---|
| Ingestion: GHSA webhook, GitHub Advisory DB, KEV, OSV, 21 feeds, scheduled every 5 min by QStash | live |
| NVD poller | deployed; first production run got HTTP 503 from NVD; works locally |
| Report fact-check (registries + Meta web search) | live (logs on `/api/status`); 3/3 local scenarios correct: real CVE → Verified, fabricated CVE → Likely false, uncited rumour → Unverified |
| Repository analysis, citation checks, rule verdict, notifications | live |
| Agentic investigation | local: 3 fixtures, verdicts unchanged, 2–8 tool calls each |
| GitHub sign-in | live |
| Connect repository + initial scan of the last 30 days | implemented; App install picker exercised locally |
| Threat timeline (registries + Muse Spark, optional Muse Wonder conflict review) | **live** (Nov 4: case page on production built from GitHub Advisory DB, NVD and OSV records with a Muse Spark summary); Muse Wonder conflict review **local only** (off on production) (`docs/VALIDATION_TIMELINE.md`) |
| User-impact simulation | local, in English and Korean |
| Korean and other languages | local (Korean static dictionary; others via Muse Spark) |
| Fix & create PR with Muse Code | **live**: draft PR chewonc/argus-demo-api#2 has Muse Code's edit, a runner-regenerated lockfile, and tests 2/2 passed. The patch was approved before any write; cancelling a run is also verified (`docs/VALIDATION_MUSE_CODE.md`). |
| Fix & push (automatic merge after checks) | **implemented, not verified**: never run |
| Muse Code → Argus MCP | **local**: Muse Code 1.4.14 called `list_findings` on a local Argus. Not verified from the Actions runner or against production. |
| MCP server for coding agents | live (personal tokens, 4 tools) |
| Email, X, LinkedIn, Threads | not available: no email provider configured; X API is paid; LinkedIn has no search API; Threads keyword search needs App Review |

## Connect an AI coding agent (MCP)

Create a token in Settings → Connect AI agent. Order of preference:

1. **Meta Muse Code**: add to `~/.config/muse/settings.json` under `mcpServers` an entry `"argus-watch": { "type": "streamable-http", "url": "https://argus-watch-three.vercel.app/api/mcp", "headers": { "Authorization": "Bearer <token>" } }`. Header values are literal; `${VAR}` is not expanded. Verified locally with Muse Code 1.4.14 calling `list_findings` (docs/VALIDATION_MUSE_CODE.md).
2. **Claude Code**: `claude mcp add --transport http argus-watch https://argus-watch-three.vercel.app/api/mcp --header "Authorization: Bearer <token>"`
3. **ChatGPT Codex**: `[mcp_servers.argus-watch]` with `url` and `bearer_token_env_var` in `~/.codex/config.toml`.
4. Any client that speaks Streamable HTTP MCP.

The consumer Meta AI app does not support third-party MCP servers, so it is not listed. Tools: `list_findings`, `get_finding` (incl. report credibility), `get_file_context`, `report_result` (evidence is re-read; it never changes Argus's own verdict).

## Security boundary

- The server reads repository metadata, trees and cited files at one commit. Nothing is cloned on the server and nothing from a repository is executed there.
- Automated fixes run in an ephemeral GitHub Actions VM with a short-lived clone token; secrets are removed from the environment before tests run; the runner cannot push.
- Writes happen only after explicit per-fix authorization, only to files on the allowlist, and only through the GitHub App; push mode merges only after passing checks and never bypasses branch protection.
- Advisory, feed, web and repository text is untrusted data, fenced in prompts and in MCP output (`untrusted_*`).

## Run it

```bash
npm ci
cp .env.example .env.local   # at minimum META_API_KEY
npm run dev
npm test
```

See `SETUP.md` for every variable, the GitHub App, the scheduler and the remediation runner, and `CONTRIBUTING.md` for checks and ground rules. `docs/USER_GUIDE.md` walks through the product.
