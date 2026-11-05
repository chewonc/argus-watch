Product renamed to SaveBell on 2026-11-05; names and URLs below are historical.

# Expected results: MCP toxic agent flow (c13 / c14)

Written before any Argus run. These are the answers the validation is scored against; they must not be edited to match a run.

**Source:** Invariant Labs, "GitHub MCP Exploited: Accessing private repositories via MCP", Marco Milanta and Luca Beurer-Kellner, 2025-05-26, https://invariantlabs.ai/blog/mcp-github-vulnerability. No CVE. The authors say it is not a bug in the GitHub MCP server code: it affects any agent wired up this way.

**Attack conditions in the article:**
- A1. The agent's GitHub access covers private repositories as well as the public one it works on (broad token).
- A2. The agent reads untrusted public content (issue text) into the model context.
- A3. The agent can perform write actions (e.g. create a pull request) that publish data.
- A4 (mitigation absent). No human confirmation on tool calls ("Always Allow").
- A5 (mitigation absent). No per-session restriction to one repository / least-privilege guardrail.

## c13_mcp_toxic_flow_affected: expected **potentially affected**
| Condition | Expected state | Evidence |
|---|---|---|
| A1 broad token | Inferred | `src/triage-agent.ts:13` passes `GH_PAT`; scope stated only by the comment on line 9 (a token's real scope is not visible in code) |
| A2 untrusted issue text into context | Observed | `:25` task reads issues of the public repo; `:37` tool output pushed into `messages` |
| A3 write tools available | Observed | `:19-20` every server tool (read and write) exposed to the model |
| A4 no confirmation | Observed | `:34-35` auto-approve `callTool` with model-chosen arguments |
| A5 no repo restriction | Observed | `:35` arguments passed through unchecked |

Expected verdict: **not "Not Affected"**. Source is a single blog post (tier `signal`), so the rule's tier cap must keep it at **Unclear / Potentially affected**, never Confirmed. Exploitability is not proven (no run, attacker issue hypothetical).

## c14_mcp_toxic_flow_control: expected **Not Affected** (or, at worst, Unclear; never Affected)
| Condition | Expected state | Evidence |
|---|---|---|
| A1 broad token | Contradicted (or Unknown) | `:15` token named `GH_PAT_WEBSITE_ONLY`; comment line 10 says single repo. Scope again not provable from code |
| A3 write tools that publish | Contradicted | `:21-23` allowlist; only `add_issue_comment` can write; no PR creation; `:14` toolsets restricted |
| A4 no confirmation | Contradicted | `:42-46` writes require `rl.question` yes |
| A5 no repo restriction | Contradicted | `:41` refuses any call outside acme/website |

Pass criteria: c13 cites lines in `src/triage-agent.ts` within the ranges above for at least two of A2–A4; c14 is not Affected and at least one of A3–A5 is Contradicted with a citation to the lines above; every citation passes the mechanical check; the dashboard shows c13 and c14 with these states.
