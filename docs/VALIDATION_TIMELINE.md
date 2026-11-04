# Validation: Threat Timeline (Nov 4 2026)

**Result: implemented and verified locally against real registries, the real Meta Model API (Muse Spark 1.3 and Muse Wonder 1.0) and in the browser. Not committed, not deployed; production has no timeline yet.**

## What it is

`lib/timeline.ts`, `app/api/timeline/route.ts`, `components/threat-timeline.tsx`, shown on every case page between "How to fix it" and "What happens if you don't fix this?". It reuses the items the pipeline already ingested (no second intelligence pipeline) and is rebuilt when a new report about the same threat arrives (cache key = the finding's item and id set). The pipeline builds it after a finding is assessed.

| Layer | Who | Code check |
|---|---|---|
| Source timestamps (GHSA, OSV, NVD, KEV, feeds) and Argus's own records | code | none needed; undated feed items are shown at Argus's first-seen time and labelled Inferred |
| Registry dates for cited ids (GitHub Advisory Database, NVD incl. the CISA KEV date, OSV fallback) | code | failures recorded per id, never fatal |
| Dated developments from report text | Muse Spark 1.3 (`timeline`) | date and claim must be quoted verbatim from that source, quoted date must match, no future dates |
| Summary | Muse Spark 1.3 (`timeline_summary`) | every year/version must appear in the events; no "confirmed exploitation" unless CISA lists it; otherwise a template summary is used |
| Date conflicts between sources | Muse Wonder 1.0 (`timeline_wonder`), only with `WONDER_ESCALATION=1`, at most one call per build | preference accepted only with a verbatim quote from the supplied material; no event is ever removed; "unresolved" keeps both |

Confidence labels: **Confirmed** (registry, official catalog, Argus's own record), **Reported** (stated by a source, incl. every model-extracted event), **Inferred** (date derived, e.g. a patched version listed in an advisory without a release date). Exploitation is Confirmed only from CISA KEV.

## Automated tests (`tests/timeline.test.ts`, mocked network and model)

13 tests: deterministic events per source; quote-grounding rejects unquoted claims, unquoted or mismatched dates, malformed and future dates; merge of one development seen by several sources; conflict detection (also after a merge adds the blog to the registry entry); Wonder preference without a verbatim quote → unresolved; Wonder API failure → unresolved, both events kept, call addressed to `muse-wonder-1.0`; summary lint; registry parsing incl. CISA KEV date and per-id failures; repository lane says a PR is "opened (not merged; the fix is not verified)"; legacy fix records without an audit trail; one build per finding at a time; cache invalidated by a new report. Full suite: 70/70 passing; `tsc` and ESLint clean; `next build` succeeds.

## Live run (`scripts/checks/timeline-live.mts`, real APIs, read-only against the local store)

**A. CVE-2025-29927 (Next.js middleware bypass), GHSA + NVD.** 29 s. Registry: GHSA ok, NVD ok. Events: advisory published 2025-03-21 15:20 UTC (Confirmed; GitHub + NVD merged), patched versions 13.5.9 / 14.2.25 / 15.2.3 / 12.3.5 listed (Inferred date), advisory updated 2026-03-02 (Confirmed), Argus discovery. Muse Spark proposed 1 development and it was **rejected** ("date not found in the source text"). Spark summary accepted by the lint.

**B. CVE-free AI-security write-up (Invariant Labs, GitHub MCP toxic agent flow), feed item + fetched page.** 44 s. No registry ids. Muse Spark proposed 2, both accepted with verbatim quotes (e.g. "We showcase a critical vulnerability with the official GitHub MCP server…", date "2025-05-26"). All events Reported.

**C. Date conflict with Muse Wonder (`WONDER_ESCALATION=1`).** Test input: a synthetic feed item written by us for this check, paraphrasing Vercel's public postmortem (not a verbatim quote of it): private report on February 27, 2025, advisory published March 21, 2025. 43 s. Spark extracted the Feb 27 disclosure; code flagged it against the registry's Mar 21 publication; **Muse Wonder was called** and answered `unresolved`, grounded (its quote was found in the material), reason: "Both dates can be true: 2025-02-27 is the private disclosure to the Next.js team, while 2025-03-21 is the later advisory publication." Both events stayed, labelled "Sources give different dates…", with Wonder's reason shown.

Not exercised live: a Wonder answer that prefers one date (covered by unit tests only); an ungrounded Wonder preference (unit tests only).

## Browser (local dev server, stub sign-in, case page for c1_affected)

Timeline renders and hydrates; "All / Confirmed only" filter works (5 Confirmed events remain); repository lane shows "Checked … affected (confirmed from code evidence)" and "You were alerted". At 375 px the page is exactly 375 px wide (fixed while testing: the case page grid, the AI-agent prompt and the header nav were widening the page on phones). An older fix record without an audit trail crashed the repository lane on first load (error state shown correctly); fixed and covered by a test.

## Known limitations

- Production: not deployed (no commit yet). `WONDER_ESCALATION` should stay unset on Vercel until the owner decides.
- Timeline body text is English; only the heading is localized.
- Feed items keep only their summary; the timeline fetches the linked page (robots.txt, rate-limited) like the pipeline, so a page that blocks crawlers yields fewer extracted events.
- One Wonder review per build; a threat with several conflicts shows the rest side by side without review.
- Registry lookups cover at most 2 GHSA and 2 CVE ids per threat.
