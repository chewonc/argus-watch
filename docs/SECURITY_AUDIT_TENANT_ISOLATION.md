Product renamed to SaveBell on 2026-11-05; names and URLs below are historical.

# Tenant isolation and persistence audit (Nov 4, 2026)

Scope: authentication, ownership model, cross-user isolation, shared demo repositories, database options.
Method: code reading of every route, server action, page, background job and MCP tool, plus read-only checks of the
public production status endpoint. **No code was changed and nothing was migrated.** Items marked *verified* were
observed in code or on production; items marked *inferred* follow from code but were not exercised.

## 1. Persistence and identity (verified)

| Question | Answer |
|---|---|
| Persistent user database? | **Yes, but not a relational one.** Users live in **Upstash Redis** (key-value) as `user:gh:<github id>`, plus a `users` set. Local dev uses an in-process map (`.data/store.json`). |
| Provider / ORM | Upstash Redis REST client (`lib/store.ts`), zod schemas (`lib/schema.ts`). No SQL, no ORM, no row-level security. |
| Sign-in | Better Auth, **stateless**: encrypted cookie session, GitHub OAuth only, no auth database (`lib/auth.ts`). |
| Internal user id | `gh:<numeric GitHub id>`, resolved server-side from the session via GitHub `/user`, cached as `uidmap:<better-auth id>` (`lib/session.ts currentUser`). Never taken from the request. |
| Installations | `inst:<id>` with `user_ids[]`. Linked in `/api/github/setup` only if the user's own GitHub token lists that installation (*verified*: the query `installation_id` is not trusted). |
| Repositories | Global `repo:<owner/name[/subdir]>` (`WatchedRepo`, shared by everyone who watches it) + per-user link `urepo:<uid>:<key>` (`UserRepo`: paused, allow_pr, installation) + reverse set `repo:<key>:users`. |
| Findings / items | **Global** (`finding:<id>`, `item:<id>`): public threat intelligence, no owner. `Finding.relevant_repos` lists **every** watched repo key it applies to, across all users. |
| Assessments | **Per repository key, not per user** (`assessment:<finding>:<repo>:<sha>:<v>`). Two users watching the same repo share them, including the `agent` report field. |
| Fixes (remediation jobs, patches) | `fix:<id>` with `user_id` owner, indexed per assessment (`assessment:<id>:fixes`), not per user. |
| Notifications | `notifi:<nid>` with `user_id`; per-user list/unread/read/resolved sets. |
| Agent (MCP) tokens | Hashed, per user (`lib/agent-token.ts`); resolve to a uid. |
| Audit log | One **global** list `log` (`LogEntry {kind, source, detail, ref}`), no owner field. |
| Settings, push subscriptions | Per user (`user:<uid>`.settings, `push:<uid>`). |

Resources with **no ownership relationship**: findings, items, `WatchedRepo`, assessments, the audit log, poll state.
Findings and items are public intelligence by design. The others are where the leaks below come from.

## 2. Isolation status per surface

Enforcement is **application-level only**: each route resolves the user server-side and checks
`canSee(uid, repoKey)` (= the user's own `urepo` links, plus the system/demo repos when `DEMO_SHARED_REPOS=1`), or
`fix.user_id === user.id` for fix actions. There is no database-level isolation (Redis has none).

| Surface | Check | Status |
|---|---|---|
| Threats list, case page, `/api/assessments`, `/api/timeline`, `/api/simulate`, `/api/remediation`, MCP `list_findings` / `get_finding` / `get_file_context` | `visibleRepoKeys` / `canSee` | Correct for repo scope (*verified in code*) |
| Fix approve / apply / run / cancel | session + `fix.user_id === user.id` + repo opt-in + App write permission + approval grant | Correct for owner (*verified, tests*) |
| Notifications read/list, settings, push subscribe, agent tokens | per-uid keys; `markNotificationRead` checks `n.user_id` | Correct (*verified in code*) |
| `/api/github/setup` | user token must list the installation | Correct (*verified*) |
| Runner callbacks | shared secret + single-use nonce | Correct (*verified, tests*) |
| Pollers, process, push send, admin, analyze | admin token or QStash signature | Correct (*verified in code*) |

## 3. Vulnerabilities found (ranked)

**V1 — Critical, live on production: the public `/api/status` endpoint returns the last 100 raw audit-log entries.**
*Verified* on https://argus-watch-three.vercel.app/api/status without signing in: entries include GitHub logins
("cancelled by chewonc", "chewonc paused monitoring of …"), repository names, commit SHAs, PR numbers and branch names.
With more users this discloses every user's private repository names and actions to anyone. The Monitoring page's
"Advanced diagnostics" shows the same raw global log to every signed-in user.
Fix: drop `log` from the public response (keep aggregate counts/latency); show signed-in users only entries about their
own repositories; keep the raw log behind the admin token.

**V2 — High: `Finding.relevant_repos` leaks other users' repository names.** `/api/findings` (signed-in) returns the
whole finding for any finding relevant to one of the caller's repos, including `relevant_repos` = all matching repo keys
of all users. *Inferred* from code (only the owner's repos exist today, so not observed with a second user).
Fix: filter `relevant_repos` to the caller's visible keys (or omit it) in every user-facing response.

**V3 — High: remediation history is shared between users of the same repository.** Fixes are listed per assessment,
and assessments are per repository. `/api/fix/[id]` (GET) checks only `canSee(repo)`, and `/api/fix-context`, the case
page and the Threats list read `listFixes(a.id)` without filtering by `user_id`. So user B, who legitimately watches the
same org repository, can read user A's generated patches, runner logs, PR links and audit events, and sees A's fix state
("PR created") as their own. *Inferred* from code.
Fix: filter every fix read by `fix.user_id === user.id` (centralized `fixesFor(uid, aid)`); `/api/fix/[id]` → owner only.

**V4 — High: an MCP agent can change what other users see.** `report_result` writes `assessment.agent`, which lives
on the shared assessment. Any user who can see the repository (including **every user on the shared demo repos**) can
mark a finding "not affected" (moving it to Resolved) or "confirmed" for everyone. *Inferred* from code.
Fix: store agent reports per user (`agentreport:<uid>:<assessment>`), never on the shared assessment.

**V5 — Medium: demo repositories are visible to, and notify, every user.** See section 4.

**V6 — Medium: GitHub access is checked once, never revalidated.** `Installation.user_ids` and `UserRepo` links persist
after a user leaves an organization or loses repository access. Within an org installation, `addRepos` lists repos with
the installation token, so a member can watch (and read code excerpts / findings of) a private repo the App can read but
that member cannot. The fix routes check the App's write permission, not the user's own GitHub permission on that repo.
*Inferred* from code. Fix: on add and periodically (and before any write), confirm access with the user's token
(`GET /user/installations/{id}/repositories` or `GET /repos/{o}/{r}` with `permissions.push` for writes); drop stale links.

**V7 — Low: the Activity log is global.** It shows sanitized phrases only ("Fix pull request opened"), but the timing of
other users' actions is visible. Fix together with V1 (per-user filtering).

**V8 — Low: `/api/push/ack` is unauthenticated** (by necessity); it only sets `received_at` once on an unguessable id.
Acceptable; noted.

Not found: no route trusts a client-supplied user id; installation ids from the browser are verified; tokens are never
returned to the browser; write paths require the owner's approval grant (`lib/write-auth.ts`).

## 4. The "shared demo" entries (c13_mcp_toxic_flow_affected, c14_mcp_toxic_flow_control)

- **What they are:** fixture folders inside the public repository `chewonc/argus-watch`, registered by the admin
  endpoint under the special owner `system` (`app/api/admin/route.ts`). The UI labels any `system`-owned repo
  "Shared demo".
- **Who sees them:** every signed-in user when `DEMO_SHARED_REPOS=1`. That variable **is set on Vercel production**
  (value encrypted; *inferred* "1" from the behavior you see) and in local `.env.local`. They appear in Repositories,
  Threats, case pages (with code excerpts; the code itself is public on GitHub) and MCP results for all users.
- **Notifications:** `lib/notify.ts recipientsFor` sends demo-repo alerts to **every registered user**.
- **What other users can do:** cannot pause, remove, enable changes on, or open PRs against them (`setAllowPr` refuses;
  approve/run refuse "shared demo repositories never receive changes"). They **can** trigger "Rescan" (server cost) and,
  through MCP `report_result`, overwrite the shared agent verdict (V4).
- **Demo data bypasses ownership checks** by design: `visibleRepoKeys` adds all `system` repos.
- **Can you hide them?** Not today: "Remove" only removes your own link, and you have none for demo repos.
- **Verdict:** intentionally shared, and the content is public, so this is not a private-data leak by itself. The
  problems are V4 (shared mutable state), global notifications, and no opt-out. Recommended: keep demo content public
  but read-only (per-user agent reports, no shared writes, rescan admin-only), send demo notifications only to users who
  opt in, and add a per-user "Hide demo repositories" switch. Your entries are untouched.

## 5. Is a new database necessary?

**Not for isolation.** Every leak above is a missing filter in application code, not a storage limitation; the same
bugs would exist on Postgres without RLS, and RLS would not fix V1 (a public endpoint reading the log with server
credentials). Redis KV can model per-user ownership correctly (per-user keys, as notifications already do).

**Where Postgres would genuinely help** (reasons to plan a move, not to block the fixes): relational queries
(per-user findings with joins instead of scanning 400 assessments), RLS as defense in depth for user-scoped tables,
transactions instead of SETNX claims, backups/point-in-time restore, and an audit log that can be filtered by owner.

### Candidates (pricing from third-party 2026 summaries; confirm on the vendors' pages before deciding)

| | Upstash Redis (current) | Neon Postgres | Supabase | Prisma Postgres / others |
|---|---|---|---|---|
| Free tier | 500K commands/mo, 256 MB | 0.5 GB, 100 CU-hours/project/mo, scale-to-zero | 500 MB DB, 2 projects, **pauses after ~1 week idle** | similar small free tiers |
| Paid entry | pay-as-you-go $0.20/100K commands | usage-based, no minimum (~$0.106/CU-hour, $0.35/GB-mo on Launch) | Pro $25/mo (+compute beyond $10 credit) | varies |
| RLS | no | yes (Postgres RLS) | yes, first-class | yes (Postgres) |
| Fit with stack | already wired; Vercel Marketplace | Vercel Marketplace integration; standard Postgres (portable) | brings its own auth/storage we do not need; we keep Better Auth | fine |
| Lock-in | low data volume, easy to export | low (plain Postgres) | low for DB, higher if using its auth/APIs | low |
| Ops | none | none (serverless) | low | low |

Rough monthly cost (assumption: today a handful of users; "moderate" = ~500 users, ~20 repos each, pollers every
5–15 min): Upstash stays at $0–$10 today and roughly $10–$40 at moderate scale, driven by poller command volume (check
the Upstash dashboard for the real current count). Neon: $0 today within the free tier, roughly $5–$30 at moderate scale
(compute-hours). Supabase: $0 only for a dev project (pausing is unacceptable in production), so effectively $25+/mo.

**Recommendation:** (1) Fix V1–V7 now in the existing Redis architecture with centralized helpers; no new
infrastructure. (2) If you want relational storage and RLS as defense in depth, **Neon Postgres via the Vercel
Marketplace** fits best (standard Postgres, scale-to-zero free tier, no second auth system), keeping Upstash for
queues/claims/caches. Supabase is a good product but its main advantages (auth, storage, client-side RLS) overlap with
what we already have, and its free tier pauses.

## 6. Proposed authorization design (for approval)

1. `lib/authz.ts` (new, the only place that answers "may this user …"):
   `visibleRepoKeys`, `assertCanSeeRepo`, `assertOwnsFix`, `fixesFor(uid, aid)` (owner-filtered),
   `redactFinding(f, keys)`, `ownLogEntries(uid, log)`, `assertRepoAccessFresh(uid, repoKey)` (GitHub re-check, cached
   ~10 min), `assertCanWriteRepo(uid, repoKey)` (user's own GitHub `push` permission).
2. Apply it in: `/api/status` (no raw log), Monitoring/Activity (own entries), `/api/findings`, `/api/fix/[id]`,
   `/api/fix-context`, case page, Threats list, MCP `get_finding` / `report_result`, approve/run routes.
3. Per-user agent reports: `agentreport:<uid>:<assessmentId>` (read-through fallback to the legacy field only for the
   user who wrote it, via `client`/`at` match → otherwise ignored). No destructive migration: legacy `assessment.agent`
   values stay in place and are simply no longer shown to other users.
4. Audit log entries gain an optional `uid` (new writes only); readers filter by it. Old entries remain admin-only.
5. Demo: per-user `settings.hide_demo`, demo notifications opt-in, rescan of `system` repos admin-only.
6. Tests: two synthetic users (`gh:9001`, `gh:9002`) in the local store, asserting denial for every surface in section 2
   (reads and writes, manipulated ids, MCP calls, fix/patch retrieval, notifications, logs, status endpoint).

**Migration impact:** additive keys only; no existing key is rewritten or deleted. **Rollback:** revert the commit; the
new keys are ignored by the old code. A Postgres move (if approved later) would be a separate dual-write → backfill →
read-switch plan with Redis kept as the source of truth until verified.

## 7. Not verified

- Behavior with a real second GitHub account (no second account was used; no real users' data was touched).
- The exact value of `DEMO_SHARED_REPOS` on production (encrypted; inferred from behavior).
- Upstash command volume and current storage size (dashboard not accessed).

## 8. Fixes implemented (Nov 4, local; not deployed)

| Issue | Change | Test (tests/tenant-isolation.test.ts unless noted) |
|---|---|---|
| V1 | `/api/status` no longer returns the raw log (aggregates only). Monitoring diagnostics show only entries about the caller's repositories or about no repository. | V1/V7 test + static check on the route |
| V2 | `/api/findings` redacts `relevant_repos` to the caller's visible repositories (`lib/authz.ts redactFinding`). | V2 |
| V3 | Every user-facing fix read uses `fixesFor` / `ownFix` (owner only): Threats, case page, fix modal context, `/api/fix`, `/api/fix/[id]`, simulate, timeline, MCP. | V3 + static guard |
| V4 | MCP `report_result` writes `agentreport:<uid>:<assessment>`; readers personalize via `withAgentFor`. Legacy shared reports are shown only to a repository's sole watcher, never on shared or demo repos (not deleted). | V4 |
| V5 | Settings → Shared demo: "Show shared demo repositories" (default on) and "Notify me about demo findings" (default off). Demo alerts go only to opted-in users. Rescan is limited to one's own repositories. | V5 |
| V6 | `lib/access.ts`: GitHub access re-checked with the user's own token at most every 15 min (installations unlinked, repositories marked `access_lost`: hidden, not notified, nothing deleted, restored automatically). Adding repositories lists only those the user can access on GitHub. Approve / apply / write-mode run require the user's own GitHub push permission. | V6 |
| V7 | Activity log filtered like V1. | V1/V7 |

New keys only (`agentreport:*`, `access_checked:*`, optional `UserRepo.access_lost`, `UserSettings.hide_demo/demo_alerts`); nothing is
rewritten or deleted. Rollback = revert the commit.

Still not verified: behavior with a real second GitHub account; the GitHub calls in `lib/access.ts` against the real API (unit-tested
with mocks). Note: approvals now need a working GitHub sign-in token; if it has expired, the user is asked to sign in again.
