# End-to-end validation: a CVE-free AI security finding → evidence-backed repository alert

Date: Nov 2 2026. Runs by Claude Code on the owner's machine with the owner's Meta Model API key.

**What kind of result this is.** **Local**: the production pipeline code (`lib/pipeline.ts`, `lib/extract.ts`, `lib/analyze.ts`, `lib/verdict.ts`) ran in a local `next dev` server against the **real Meta Model API (`muse-spark-1.3`)** and **real GitHub reads** of a public repository, with a local file store and the local dev sign-in stub. It is **not a live production delivery**: the article was fed in with the admin `replay_feed_entry` operation and is labelled a replay in the store and the UI. No model output, file, line or verdict was written by hand.

## 1. The research article (input)

| | |
|---|---|
| Title | GitHub MCP Exploited: Accessing private repositories via MCP |
| Authors | Marco Milanta, Luca Beurer-Kellner (Invariant Labs, now part of Snyk) |
| Published | 2025-05-26 |
| URL | https://invariantlabs.ai/blog/mcp-github-vulnerability |
| CVE | none. The authors state it is not a bug in the GitHub MCP server code; any agent wired this way is exposed ("toxic agent flow") |
| Why it fits | Concrete attack (prompt injection in a public issue → agent reads private repos → leaks them in a public PR) with conditions visible in agent code: broad token, untrusted issue text in context, write tools, auto-approval, no per-repo restriction |

Ingestion: as an item of the monitored `snyk` feed ("Snyk blog (incl. Invariant Labs)"), title + URL only. The pipeline's normal page-fetch step (`lib/fetchpage.ts`, used for feed items with short summaries) downloaded the article body itself. The article predates the feed's polling window, which is why it was replayed rather than polled.

## 2. Test repository (ground truth written first)

Public repo `chewonc/argus-watch`, commit **`0fec9f7`**, two isolated sub-projects (no credentials, nothing runnable against real systems):

- `feasibility/cases/c13_mcp_toxic_flow_affected/src/triage-agent.ts`: issue-triage agent with a classic `repo`-scope PAT (`:9`, `:13`), every MCP tool exposed (`:18-20`), task to read public issues (`:25`), auto-approved tool calls (`:34-35`), issue text fed back into context (`:36-37`).
- `feasibility/cases/c14_mcp_toxic_flow_control/src/triage-agent.ts`: same agent with a single-repo token (`:10`, `:15`), restricted toolsets (`:14`), tool allowlist with no PR creation (`:20-23`), one-repo-per-session guard (`:41`), human confirmation for writes (`:43-46`).
- Expected answers: `feasibility/cases/MCP_TOXIC_FLOW_EXPECTED.md`, committed in the same commit, before any run, unchanged since.

Both were registered with the admin `watch` op; Argus computed `tech_tags: ["mcp", "openai-sdk"]` from their lockfiles.

## 3. Who did what

| Step | Done by | Detail |
|---|---|---|
| Ingest, dedup, tier | code | `ingest()`; tier `signal` (single unofficial source) |
| Fetch article text | code | `fetchPageText` (S4) |
| Prefilter | code | AI-agent terms + repos tagged `mcp`/`openai-sdk` |
| **Read the article** | **Muse Spark** | `extractClaim` → `POST {META_BASE_URL}/chat/completions`, `model: muse-spark-1.3`, `temperature: 0`, `response_format: json_schema "claim"` (strict). Input: article text (≤60 000 chars) fenced as untrusted. 1 call |
| Match repos | code | claim tag `mcp` ∩ repo tags → both repos |
| Find candidate files | code | `candidateFiles` (lockfiles + sources mentioning the terms) via GitHub contents API at `0fec9f7` |
| **Read the code** | **Muse Spark** | `assess` → same endpoint, schema `assessment`. Input: claim summary, 4 condition ids/texts, numbered file listings. 1 call per repo per run |
| Proof check | code | `citationOk` (file exists at the SHA, line exists, quoted text matches); prose-file rule; **comment-line rule (new, §5)** |
| Verdict | code | `decide()` in `lib/verdict.ts`; tier cap |
| Alert, dashboard | code | `sendAlert`, in-app notification, `/alerts`, `/case/...` |

Muse Spark calls made: run 1, 3 (1 extraction + 2 assessments, 70.8 s end-to-end); run 2, 2 (assessments; the claim is cached by text hash, 29.7 s). Request bodies are not logged by design (they contain repository code); outputs are stored on the finding and assessments and summarised below.

## 4. Results

### 4.1 Muse Spark extraction (run 1, stored claim)
- `actionable: true`, `claim_type: ai_agent_tool_use`, `plain_title`: "Attackers could steal private code via assistant", `packages: []` (correct: no package or CVE), `tech_tags: [mcp, github, claude-desktop]`.
- Conditions:
  - **c1** (required): the agent's GitHub MCP connection has access to private repositories (= A1)
  - **c2** (required): an attacker can create a malicious issue in the public repository (environmental precondition of A2)
  - **c3** (required): the user asks the agent to look at open issues, so the agent fetches the injected text (= A2)
  - **c4** (missing protection, workaround): no granular permission control limiting the agent to the repositories it needs (= A5)
- Each condition has a verbatim `source_quote` from the article.
- **Missed:** write capability (A3) and auto-approval / "Always Allow" (A4) were not made separate conditions. The article mentions both, but less prominently than its main recommendation.

### 4.2 Assessments (run 2, after the fix in §5)

| | c13 affected | c14 control |
|---|---|---|
| c1 broad access | **Inferred** @ `:9` (comment; capped from Observed) | **Unknown** @ `:11` (comment; capped from Contradicted) |
| c2 attacker can file issue | Inferred @ `:36` | Inferred @ `:29` |
| c3 agent reads public issues | **Observed** @ `:25` | **Observed** @ `:30` |
| c4 no per-repo restriction | Inferred @ `:18` (comment) | **Contradicted** @ `:41` (code: refuses other repos) |
| Cited lines | 8 kept, 0 rejected (`:2,7,9,11,18,25,34,36,37`) | 6 kept, 0 rejected (`:11,14,20,29,30,41`) |
| Rule verdict | **Unclear**: "Tier cap: single unconfirmed source cannot establish Affected" | **Not Affected**: "Contradicted: c4" |
| Relevance / UI status | Potentially affected / "Possible issue", severity low | "You're not affected", no alert |
| Model's own unverified notes | whether private repos hold sensitive data; whether a malicious issue exists; whether the model would actually exfiltrate | whether the token could be broader outside the code; whether the LLM obeys "ignore instructions" |

### 4.3 Scored against the pre-registered criteria
| Criterion | Result |
|---|---|
| Article understood | **Yes.** Correct attack, actionable, no invented package or CVE |
| Attack conditions extracted | **Partial.** 3 of 5 (A1, A2, A5) plus the attacker precondition; A3 and A4 missed |
| Appropriate code found | **Yes.** All cited lines are in the agent file; c13 has A2 at `:25`/`:37`, A4 at `:34`, A5 region `:18`; c14 guard at `:41` |
| Paths and lines correct | **Yes.** 14/14 citations passed the mechanical check; none invented. Some point at comments rather than the adjacent code line (`:18` vs `:19-20`, `:34` vs `:35`) |
| Vulnerable vs control distinguished | **Yes.** c13 → possible issue; c14 → not affected, decided by real code (`:41`), not by a comment |
| Severity / verification status justified | **Yes.** Single blog source → tier cap keeps c13 at Unclear / "Possible issue" / low; not marked confirmed; exploitability explicitly unverified |
| Dashboard | **Yes, after a fix** (§5). c13 listed as "Possible issue"; case page shows cited lines highlighted in the read-only code pane, GitHub links at `0fec9f7`, and the "How this was analysed" panel (Spark extracted 4 conditions, judged 4 against cited files, 8 lines kept / 0 rejected, verdict by rule) |

Pass criteria from the expected-results file: c13 cites ≥2 of A2–A4 in range: **met** (A2 `:25`, `:37`; A4 `:34`). c14 not Affected with A3–A5 Contradicted by a cited line: **met** (A5 `:41`). All citations pass: **met**. Dashboard shows both: **met** (c14 by its case page; not-affected results do not raise alerts by design).

## 5. Failures found and fixed

1. **Evidence validation: comments were accepted as proof.** Run 1 marked c13's broad-token condition **Observed** from a comment (`:9`). For the control, it marked the same condition **Contradicted** from a comment (`:11`, "Fine-grained token limited to acme/website only"), and that comment was one of the two reasons for "Not Affected". A comment describes intent, not behaviour, so a stale or lying comment could produce a false "Not Affected". Fix in `lib/analyze.ts`: `isCommentLine` / `commentCap`. When the only cited evidence is a comment line, Observed becomes Inferred and Contradicted becomes Unknown. Mirrored in `feasibility/gate.mjs`; unit test in `tests/pure.test.ts`. Run 2: the control's "Not Affected" now rests only on executable code (`:41`).
2. **UI: the case page said the opposite of the evidence.** For an unconfirmed alert it printed "couldn't find affected code in your repository" even when 8 verified lines were cited and highlighted below. Fix in `app/case/[...id]/page.tsx` + `lib/i18n/dictionary.ts`: open alerts with cited code now say "Related code was found at triage-agent.ts:7, but the evidence so far does not establish that this issue applies." Not-affected cases keep their previous text.
3. **Ingestion (tooling, not a bug):** there was no way to feed a past article from a monitored feed through the pipeline. Added admin op `replay_feed_entry` in `app/api/admin/route.ts`: same `itemFromEntry` → `ingest` → `processFinding` path, marked replayed.

Not changed: expected answers, verdict rule, tier policy, extraction prompt. The missed A3/A4 conditions are reported, not tuned away.

## 6. Regression check (16 earlier cases, real Muse Spark)
Full 16-case harness (`feasibility/gate.mjs`, comment rule mirrored), Nov 2 2026, muse-spark-1.3, RUNS=1:

| Metric | Nov 1 run 2 | Nov 2 run 3 (comment rule) |
|---|---|---|
| Version computed from lockfile | 16/16 | 16/16 |
| Localization | 15/16 | 15/16 |
| Invented references | 0 | 0 |
| Condition-state accuracy | 0.82 | 0.82 |
| Rule verdict | 16/16 | **15/16** |
| False Not Affected | 0/10 | **0/10** |
| Injection checks | 2/2 | 2/2 |
| Gate | PASS | **PASS** |

The one new verdict miss is caused by the new rule. In `adv_feature_absent`, Spark's only evidence that auth is not in middleware was the comment `middleware.ts:4` ("Authorization is NOT performed here") rather than the code at `:7`. The rule turned that Contradicted into Unknown, so the verdict became Unclear instead of Not Affected. This is a conservative miss (it can never produce a false "safe"), and it is exactly the case the rule targets: a comment is allowed to suggest, not to clear. The rule was kept and the expected label was not changed.

## 7. Limitations
- **Local, replayed run**, not a live production alert. Running the same op on production needs the production `ADMIN_TOKEN` (owner-only).
- One article, one vulnerable/control pair, single runs at temperature 0. Not a statistical evaluation.
- Token scope is not knowable from code; both repos state it in a comment, which is now treated as weak evidence only.
- Extraction missed two of five article conditions (write tools, auto-approval). The vulnerable repo is still flagged through the other conditions, but an agent with *only* those two flaws could be missed.
- Some citations point at a comment next to the decisive code line.
- Card/page title for unconfirmed AI findings stays generic ("Possible security issue with AI tool connections (MCP)") by design. A not-affected case page still uses that title above "You're not affected" (pre-existing).
- Exploitability was not tested; nothing was executed.

## 8. Reproduce
1. `.env.local` with `META_API_KEY`, `ADMIN_TOKEN`, `AW_DEV_USER`; `npx next dev -p 3109`.
2. `POST /api/admin {"op":"watch","repo":"chewonc/argus-watch","subdir":"feasibility/cases/c13_mcp_toxic_flow_affected"}` and the same for `c14_mcp_toxic_flow_control`.
3. `POST /api/admin {"op":"replay_feed_entry","feed":"snyk","url":"https://invariantlabs.ai/blog/mcp-github-vulnerability","title":"GitHub MCP Exploited: Accessing private repositories via MCP","published":"2025-05-26T00:00:00Z"}` (Authorization: Bearer ADMIN_TOKEN).
4. Open `/alerts` → "Possible security issue with AI tool connections (MCP)" → View.
