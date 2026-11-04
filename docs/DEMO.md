# Three-minute demo script

Goal: show what Meta's models make possible, end to end, on real data. Every screen below exists in the product; nothing is mocked except the clearly labelled example on the landing page.

Opening line (required by the rules): "Argus Watch was built entirely during the hackathon, Oct 31 – Nov 4 2026."

| Time | Screen | Say | Meta capability on screen |
|---|---|---|---|
| 0:00 | Landing | "I research AI safety. Attacks on AI agents show up as blog posts and papers, often with no CVE. Finding out whether one touches my code means reading it and searching my repos by hand." | — |
| 0:20 | `/sources` | "Argus watches 25+ sources: advisories, NVD, OSV with my exact package versions, arXiv, AI-security research and news. Every interval shown is measured." | — |
| 0:40 | An alert → *Is this threat real?* | "Before anything else, it fact-checks the report. Registry lookups, then Muse Spark with Meta's web search looks for primary sources and contradictions. A fabricated CVE comes out *Likely false*; a rumour stays *Unverified* and can never become a confirmed issue." | Muse Spark + `web_search` (Responses API) |
| 1:05 | MCP toxic-flow alert → *Technical details → How this was analysed* | "Muse Spark investigated my repository with read-only tools, found the agent's tool setup, and cited exact lines. Code re-reads every cited line; the verdict comes from a fixed rule." | Muse Spark tool calling, structured output |
| 1:30 | Control repository | "Same threat, different repo: *Not affected*, and here is the line that proves it." | — |
| 1:45 | *What happens if you don't fix this?* → Simulate | "This is what a user of my app would experience, built only from the evidence. Every step says whether it is shown in my code or hypothetical." Switch to *With fix*. | Muse Spark |
| 2:15 | *Fix & create PR* dialog | "Muse Code makes the change in an isolated runner, my tests run, and only then do I get a pull request. Nothing runs on the Argus server, nothing is pushed without my authorization." (If the runner is configured: show the PR link and test log.) | Meta Muse Code (headless) |
| 2:35 | Header → 한국어 | "Korean, and any language, translated by Muse Spark; code and identifiers untouched." | Muse Spark |
| 2:45 | Settings → Connect AI agent | "And Muse Code, Claude Code or Codex can work the same alerts over MCP." | — |
| 2:55 | README status table | "Evaluated on 16 labelled cases, zero false *Not affected*. Open source, Apache-2.0." | — |

Recording notes: open the case pages once before recording so translations and simulations are cached (first Korean render of a case takes ~40 s). Use the `c13_mcp_toxic_flow_affected` / `c14_mcp_toxic_flow_control` fixtures for the MCP story.
