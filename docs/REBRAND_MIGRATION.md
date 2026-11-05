# Rebrand migration: Argus Watch to SaveBell

Branch: `chore/rebrand-savebell` (based on `feat/remediation-windows`, so the PR #1 fixes are included). Status as of 2026-11-05: the code changes are made locally and nothing is committed, pushed, merged or deployed. External changes are not made yet, and each one waits for approval.

## A. Branding changes

| Old | New | Where | Status |
|---|---|---|---|
| Argus Watch / Argus (UI text) | SaveBell | app/, components/, lib/i18n (en + ko), layout title, manifest, sw.js, demo pages | Done |
| Push, Slack/Discord, window report text | SaveBell | lib/push.ts, lib/alert.ts, lib/window-deps.ts | Done |
| PR titles, bodies, commit messages | SaveBell | lib/fix.ts, lib/fix-apply.ts, lib/runner.ts | Done (only for PRs opened from now on) |
| Model prompts | SaveBell | lib/spark, verify, simulate, analyze; scripts/remediate/run.mjs | Done |
| MCP instructions, tool descriptions, serverInfo.title, 401 text | SaveBell | lib/mcp.ts, app/api/mcp/route.ts | Done |
| Agent config snippet key `argus-watch`, `ARGUS_WATCH_TOKEN` | `savebell`, `SAVEBELL_TOKEN` | components/connect-agent.tsx, README | Done (the key is local to the client, so existing configs keep working) |
| User-Agent `ArgusWatch/0.1` | `SaveBell/0.1 (+APP_URL)` | lib/ua.ts, used by every outbound fetch | Done |
| Fix branch `argus/fix-<id>` | `savebell/fix-<id>` | lib/fix-branch.ts | Done. Grants issued before the change keep their stored branch (lib/fix-apply.ts uses `fix.grant.branch` first) |
| Demo prefix `chewonc/argus-watch/feasibility/cases/` | `chewonc/save-bell/...`, with the legacy prefix still accepted | lib/demo.ts, lib/demo-path.ts | Done. The repo prefix is hidden in the UI |
| package name | `save-bell` | package.json, package-lock.json | Done |
| `RUNNER_REPO` default | `chewonc/save-bell` | lib/env.ts, .env.example | Done |
| `ARGUS_URL` fallback in remediate.yml | `https://save-bell.vercel.app` | .github/workflows/remediate.yml | Done |
| Docs | SaveBell / save-bell | README, SETUP, CONTRIBUTING, USER_GUIDE, DEMO, SUBMISSION | Done. Historical reports have a rename note and keep their original evidence |

Remediation window form simplification is in components/window-forms.tsx, app/alerts/page.tsx, app/windows/page.tsx and app/runs/[id]/page.tsx, plus the limit messages in app/settings/window-actions.ts. The field names, defaults and server validation are unchanged.

### Remaining "argus" occurrences and why they stay

None of these is shown to users as a brand. `tests/brand.test.ts` makes sure "Argus Watch" / "ArgusWatch" does not come back.

| Identifier | Location | Reason kept |
|---|---|---|
| Timeline kinds `argus_discovered/assessed/notified`, basis `argus_record`, i18n keys `argus_*` | lib/timeline.ts, components/threat-timeline.tsx, lib/i18n, app/case | Stored in Redis. The labels render as SaveBell |
| Fix event actor `"argus"` | lib/runner.ts, app/api/bulk/approve | Stored on fix events |
| Header `x-argus-runner-secret`, env `ARGUS_RUNNER_SECRET`, `ARGUS_URL`, `ARGUS_MCP_URL/TOKEN` | lib/runner-gates.ts, lib/env.ts, remediate.yml, run.mjs, scripts/checks | A contract shared with GitHub Actions secrets and variables. Renaming needs coordinated secret changes |
| `aw_` token prefix, cookies `aw_gh_state`, `aw_locale`, storage `aw_threats_qs`, globals `__aw_*`, `AW_*` env | various | Issued tokens and browser state must keep working |
| MCP `serverInfo.name` and realm `argus-watch` | lib/mcp.ts, app/api/mcp/route.ts | Protocol identifiers, not displayed |
| `LEGACY_DEMO_PREFIX` | lib/demo.ts, lib/demo-path.ts | Existing demo keys in Redis |
| robots.txt match `/savebell\|argus/i` | lib/fetchpage.ts | Honors rules sites wrote for the old agent name |
| Diff label `argus-fix`, temp dir `argus-`, helper names | lib/fix.ts, run.mjs | Internal only |
| `chewonc/argus-demo-api` | README, docs | A real, separate demo repository |
| Historical reports | docs/VALIDATION_*, SECURITY_AUDIT_*, sprint-report.html, feasibility/* | Evidence. Each has a rename note |

**Data, not code.** Stored records can still contain the old name:
- the watched repo key `chewonc/argus-watch` (until the repo is renamed and re-added)
- PR bodies already posted on GitHub
- notification text saved before the change

A read-only scan of production Redis was **not** run. It needs your approval to use production credentials.

## B. External service changes

| Service | Current | Required | Automatic? | Manual? |
|---|---|---|---|---|
| Vercel domain | argus-watch-three.vercel.app | Add save-bell.vercel.app (or savebell.vercel.app). Both returned DEPLOYMENT_NOT_FOUND on 2026-11-05; Vercel confirms availability when you add the name | No | Yes |
| Vercel project name | argus-watch | Optional rename to save-bell. It doesn't change domains or env | No | Optional |
| Vercel Git link | chewonc/argus-watch | Confirm it follows the rename; reconnect if not | Usually | Check |
| GitHub repo | chewonc/argus-watch | Rename to save-bell. History, PRs, Actions secrets/variables, branch protection and App installations carry over, and old URLs redirect | Yes, through GitHub | Yes (the rename itself) |
| GitHub App | argus-watch-chewonc | Rename to save-bell-chewonc. App ID, client ID/secret, key, webhook secret and installations are unchanged. The slug changes | No | Yes |
| GitHub App URLs | old domain | Add a callback (keep the old one), webhook, setup and homepage URLs on the new domain | No | Yes |
| Upstash QStash schedule | /api/poll/tick on the old domain | Recreate on the new domain, then delete the old one | No | Yes |
| MCP clients (yours) | argus-watch -> old /api/mcp | Point at the new /api/mcp. The same token works | No | Yes |
| Demo data | keys under chewonc/argus-watch/... | Optional: re-register under chewonc/save-bell/... (both are accepted) | No | Optional |
| Local git remote | github.com/chewonc/argus-watch | `git remote set-url origin https://github.com/chewonc/save-bell.git` | No | Yes |

## C. Credentials and secrets (names only)

| Name | Service | Must change? | Reason | Verify |
|---|---|---|---|---|
| GITHUB_APP_SLUG | Vercel env | Yes | Follows the App name and builds the install URL | The install link opens save-bell-chewonc |
| APP_URL | Vercel env, GitHub Actions secret | Yes | Base URL for auth, QStash callbacks, links, the heartbeat | Settings shows the new MCP URL; heartbeat run is green |
| ARGUS_URL | GitHub Actions variable | Yes | Runner target | The runner calls the new domain |
| RUNNER_REPO | Vercel env (optional) | Set it, or leave it unset to use the new default | Repo slug | A test dispatch succeeds |
| GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY | GitHub App | No | A rename keeps the identity | Repo list loads |
| GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET | GitHub App OAuth | No | Same App | Sign in on the new domain |
| GITHUB_WEBHOOK_SECRET | GitHub App | No | Only the URL moves | Recent Deliveries return 2xx |
| GITHUB_TOKEN, RUNNER_DISPATCH_TOKEN | GitHub PAT | No (check) | Scoped by repo ID | Dispatch once after the rename |
| ARGUS_RUNNER_SECRET | Vercel + Actions | No | The value is unchanged | The runner callback is accepted |
| BETTER_AUTH_SECRET | Vercel | No | Not tied to the domain. Sessions reset because cookies are per host | /api/auth/whoami |
| UPSTASH_REDIS_REST_URL/TOKEN, QSTASH_* | Upstash | No | Not tied to the domain | Tick returns 200 |
| META_API_KEY, META_MODEL, META_BASE_URL | Meta model API | No | Not tied to the domain | Analysis run |
| VAPID_* | Web Push | No | Subscriptions are per origin, so users re-subscribe | Test push |
| ALERT_WEBHOOK_URL, GOOGLE_TRANSLATE_API_KEY, NVD_API_KEY, ADMIN_TOKEN | various | No | Not tied to the domain | Alert test, translate, NVD fetch, admin heartbeat |

No credential needs to be rotated.

## D. Manual actions (in order, after approval)

1. Merge PR #1, then this branch, and deploy Production. Do both only when you approve. The old domain keeps working.
2. **Vercel**:
   - Project argus-watch -> Settings -> Domains -> Add `save-bell.vercel.app`. If it is taken, use `savebell.vercel.app`.
   - Keep the old domain attached.
3. **Vercel env (Production)**:
   - `APP_URL=https://save-bell.vercel.app`
   - `GITHUB_APP_SLUG=save-bell-chewonc`
   - Then redeploy.
4. **GitHub App**: Settings -> Developer settings -> GitHub Apps -> argus-watch-chewonc -> General.
   - Set Name to `save-bell-chewonc` and update the description.
   - Set Homepage to the new URL.
   - Callback URL: add `https://save-bell.vercel.app/api/auth/callback/github` and keep the old one.
   - Setup URL: `https://save-bell.vercel.app/api/github/setup`.
   - Webhook URL: `https://save-bell.vercel.app/api/webhooks/github`.
   - Save. Do step 3 straight after this one, so the install link is never broken.
5. **GitHub repo**:
   - Settings -> Rename to `save-bell`.
   - Then Settings -> Secrets and variables -> Actions: set the secret `APP_URL` and the variable `ARGUS_URL` to the new URL.
   - Never create a new repo named `argus-watch`, because that breaks the redirects.
6. **Vercel -> Git**: confirm the repo shows as chewonc/save-bell.
7. **QStash**: create a 5-minute schedule for `https://save-bell.vercel.app/api/poll/tick`, then delete the old schedule.
8. **Local**: `git remote set-url origin https://github.com/chewonc/save-bell.git`, and update your MCP client URL.
9. After a week without errors, redirect the old domain to the new one, and remove it later.

Cut over while no remediation window is running, because messages already queued carry the old URLs.

## E. Verification results

**Passed locally (2026-11-05):**
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 1 warning that was already there (unused `ms`, feasibility/gate.mjs).
- `npm test`: 196 passed, 0 failed. This includes the new tests/brand.test.ts.
- Rendered dev site (localhost:3112, in-memory store, dev user):
  - The title and header say SaveBell.
  - "Argus Watch" appears nowhere in the HTML for /, /alerts, /windows, /settings, /sources, /demo, /notifications, the manifest or sw.js.
- Window form:
  - The new labels render.
  - The Action options map to investigate, prepare and draft_pr.
  - The draft PR note appears only for draft_pr, with role=note and aria-describedby.
  - "All repositories" submits `*`; "Choose" shows the checkboxes.
  - An out-of-range spending limit is refused by the server with a role=alert message.
  - A 1-hour window started, then pause, resume and cancel all worked.
  - The mobile layout (375px) stacks into one column.

**Not run (needs the external changes or production access):**
- Sign-in on the new domain.
- GitHub App install and permissions after the rename.
- Webhook delivery.
- MCP against the deployed URL.
- The QStash tick.
- The heartbeat workflow.
- Runner dispatch on the renamed repo.
- Draft PR creation.
- Push to the new origin.
- The production Redis scan.

None of these is claimed as working.

**Risks:**
- Sessions and push subscriptions reset on the new origin.
- Messages already in flight target the old URL.
- The install link breaks during the gap between the App rename and the `GITHUB_APP_SLUG` update.
- Vercel's Git link needs checking after the repo rename.
- Branch protection rules that name `argus/fix-*` patterns would need `savebell/fix-*` added (check repo settings).
