# Argus Watch — setup and operations

Everything here is read-only toward your repositories except a pull request (and, in "Fix & push" mode, its merge after passing checks) that a user explicitly authorizes. The Argus server never executes repository code. Automated fixes are edited by Meta Muse Code and tested inside an ephemeral GitHub Actions runner, never on the server. Argus never reproduces or exploits a vulnerability.

## 1. Secrets (never commit, never paste into chat)

Create `.env.local` at the project root (gitignored). On Vercel, add the same names under Project → Settings → Environment Variables.

| Variable | Required | What it is |
|---|---|---|
| `META_API_KEY` | yes | Meta Model API key (dev.meta.ai). Muse Spark 1.3 does claim extraction, report fact-checking (Responses API + `web_search`), agentic repository investigation (tool calling), condition assessment, fix preview, user-impact simulation and UI translation. |
| `META_MODEL`, `META_BASE_URL` | no | Defaults `muse-spark-1.3`, `https://api.meta.ai/v1`. |
| `GITHUB_TOKEN` | fallback | Fine-grained token with read-only Contents; used only for repositories registered by the admin API (demo fixtures) or when an installation token is unavailable. |
| `GITHUB_WEBHOOK_SECRET` | yes | The secret set on the GitHub App webhook. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` | yes for onboarding | App id, the PEM private key (newlines may be escaped as `\n`), and the App's URL slug (`https://github.com/apps/<slug>`). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | yes for sign-in | The GitHub App's OAuth client id and a client secret. |
| `BETTER_AUTH_SECRET` | yes for sign-in | 32+ random bytes (`openssl rand -base64 32`). Sessions are stateless cookies encrypted with it. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | yes for deployment | Durable storage. Without them the app uses `.data/store.json` (dev only). |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | yes for deployment | Scheduler + queue. Without them, polls run only when called and findings are processed inline. |
| `QSTASH_URL` | yes if the QStash account is regional | The endpoint shown next to the token in the Upstash console (e.g. `https://qstash-eu-central-1.upstash.io`). Without it a regional account fails with "user … not found". |
| `ALERT_WEBHOOK_URL` | optional | A global Slack or Discord *incoming webhook*. Users can add their own in Settings. |
| `GOOGLE_TRANSLATE_API_KEY` | optional | Not needed: without it Muse Spark translates (identifiers protected by placeholders; cached per string). Korean ships as a reviewed static dictionary. Set it only to prefer Google Cloud Translation. |
| `NVD_API_KEY` | optional | Raises the NVD API rate limit (public: 5 requests / 30 s). |
| `FIX_ENABLED` | optional | `1` enables fix drafting and authorized write actions. Off by default. |
| `RUNNER_DISPATCH_TOKEN` | for automated fixes | Fine-grained PAT on **this** repository only, permission *Actions: read and write*. Used to dispatch `.github/workflows/remediate.yml`. |
| `ARGUS_RUNNER_SECRET` | for automated fixes | Long random string; set the same value as the Actions secret `ARGUS_RUNNER_SECRET`. |
| `RUNNER_REPO`, `RUNNER_WORKFLOW` | optional | Defaults `chewonc/argus-watch`, `remediate.yml`. |
| `AW_AGENTIC`, `AW_VERIFY_MODEL` | optional | Set to `0` to switch off agentic investigation or the web-search fact-check (cost control). |
| `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional (browser push) | `npx web-push generate-vapid-keys`; put the public key in both public-key variables; subject is `mailto:you@example.com`. |
| `DEMO_SHARED_REPOS` | optional | `1` shows admin-registered (system) repositories to every signed-in user, labelled demo. |
| `ADMIN_TOKEN` | yes | Long random string protecting `/api/admin`, `/api/analyze`, manual polls and the push fan-out route. |
| `APP_URL` | yes for deployment | Public base URL (`https://argus-watch-three.vercel.app`). QStash, GitHub and Better Auth call back to it. |

## 1b. Automated remediation runner (Meta Muse Code)

1. Repository secrets (GitHub → this repo → Settings → Secrets and variables → Actions): `META_API_KEY`, `ARGUS_RUNNER_SECRET`. Optional variables `ARGUS_URL` (defaults to the production URL) and `MUSE_APPROVAL_FLAGS` (default: approvals off with Muse Code's sandbox on, no shell, no web tools; see `docs/VALIDATION_MUSE_CODE.md`).
2. Vercel: `FIX_ENABLED=1`, `RUNNER_DISPATCH_TOKEN`, `ARGUS_RUNNER_SECRET`.
3. For a repository to receive fixes: the GitHub App installation must have Contents + Pull requests write, and the user enables changes for it on the Repos page.

The runner clones the repository at the assessed commit with a short-lived installation token, runs `muse exec --json`, enforces the file allowlist, runs the repository's tests with secrets removed from the environment, and posts the result back. Argus re-validates and only then writes through the GitHub App. The runner never pushes.

## 2. Accounts and one-time setup (owner actions)

1. **Vercel:** import the repo, add the env vars, deploy. Functions use up to 300 s.
2. **Upstash:** one Redis database (free) and one QStash project (free).
3. **GitHub App** (Settings → Developer settings → GitHub Apps):
   - Webhook URL `https://<APP_URL>/api/webhooks/github`, secret = `GITHUB_WEBHOOK_SECRET`.
   - Callback URL `https://<APP_URL>/api/auth/callback/github`. Leave "Request user authorization (OAuth) during installation" off (sign-in and installation are separate steps).
   - Setup URL `https://<APP_URL>/api/github/setup`, tick "Redirect on update".
   - Repository permissions: **Metadata: read, Contents: read & write, Pull requests: read & write, Checks: read**. Account permissions: **Email addresses: read**. Contents/Pull requests write is used only after a user enables draft PRs for a repository and approves a specific fix; read-only monitoring never uses it.
   - Subscribe to events: **Security advisory**, **Push**, **Installation**, **Installation repositories**.
   - Generate a private key and a client secret; copy the App id, slug, client id.
   - Existing installations must accept the new permissions (GitHub prompts the account owner; until then writes fail with 403 and the UI says so).
4. **QStash schedule** (QStash console → Schedules): ONE schedule, POST with no body, every 5 minutes (`*/5 * * * *`): `https://<APP_URL>/api/poll/tick`. The tick runs each source on its own interval (GitHub Advisory DB and fast feeds every 5 min, CISA KEV every 10 min, NVD every 30 min, slow research feeds and OSV hourly) with conditional GET, so unchanged feeds cost nothing. Delete older per-source schedules. Budget: 288 messages/day on the free tier's 1,000.
5. **Backup heartbeat:** `.github/workflows/heartbeat.yml` calls `/api/admin` `{"op":"heartbeat"}` every 15 minutes and runs the tick if QStash has not run it for 10 minutes. Add repository secrets `APP_URL` and `ADMIN_TOKEN`.
6. **After deploying the identity layer:** run `{"op":"migrate_system"}` once so repositories registered earlier stay visible (as demo repos).

### 2.1 Checklist to unblock the end-to-end journey (status Nov 2 2026: none of these is configured on the deployment)

The production landing page shows "Sign-in is not configured on this deployment yet" and `POST /api/auth/sign-in/social` answers 503 until step C is done. Nothing in steps 1–2 and 7 of the user journey (sign in, connect a repository, open a draft PR) can be exercised by anyone before then.

A. **GitHub App → OAuth client (for sign-in).** On the App's settings page (github.com/settings/apps/<slug>): under "Identifying and authorizing users" set Callback URL `https://argus-watch-three.vercel.app/api/auth/callback/github`; tick **Expire user authorization tokens** off or on (both work); leave "Request user authorization (OAuth) during installation" **off**. Click **Generate a new client secret**; copy the **Client ID** and the secret.
B. **GitHub App → private key, permissions, events.** Under "Private keys" click **Generate a private key** (downloads a `.pem`). Under "Permissions & events": Repository → Metadata Read, Contents **Read and write**, Pull requests **Read and write**, Checks Read; Account → Email addresses Read; Subscribe to events: Security advisory, Push, Installation, Installation repositories. Save. GitHub then asks every existing installation (your account) to **accept the new permissions**: open github.com/settings/installations → Argus Watch → "Review request" and accept. Set Setup URL `https://argus-watch-three.vercel.app/api/github/setup` with **Redirect on update** ticked.
C. **Vercel → Project → Settings → Environment Variables (Production)** add: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (from A); `GITHUB_APP_ID` (the numeric "App ID" on the App page), `GITHUB_APP_SLUG` (the URL slug), `GITHUB_APP_PRIVATE_KEY` (paste the whole `.pem`; Vercel keeps newlines, or escape them as `\n`); `BETTER_AUTH_SECRET` (`openssl rand -base64 32`); `DEMO_SHARED_REPOS=1`. Then **Redeploy** (Deployments → ⋯ → Redeploy) because env changes are not applied to the running build.
D. **Verify:** open the site: the landing page shows **Sign in with GitHub**; sign in; **Repos → Connect GitHub** installs the App on a repository you own; tick it, **Watch selected**; packages > 0 appear. Enable **Allow draft pull requests** for that repository.
E. **Produce an alert on your repository** (one of): wait for a matching live advisory; or, for a demo, add `"next": "14.2.10"` to a `package.json` + lockfile in that repository and replay GHSA-f82v (section 4). Then on the case page: **Draft fix** → diff → **Approve & open draft PR…** → the draft PR link and the "Repository CI" panel appear.
F. **QStash schedule** (section 2 step 4) and **heartbeat secrets** (step 5). `/api/status` → `infra.scheduler.tick_schedule_detected` becomes `true` after the first delivery from the schedule; until then the legacy `rss`/`kev` schedules also run every other due poller.
G. Optional for the demo: `ALERT_WEBHOOK_URL` (Slack/Discord), `GOOGLE_TRANSLATE_API_KEY`, VAPID keys (section 1).

## 3. Register demo repositories (admin API; users use the Repos page instead)

```bash
curl -X POST "$APP_URL/api/admin" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"op":"watch","repo":"owner/name","default_branch":"main","label":"production"}'
```

Optional `"subdir":"path/inside/repo"` watches a sub-folder (demo fixtures under `feasibility/cases/`). `{"op":"unwatch","repo":"owner/name[/subdir]"}` removes one. `{"op":"cleanup"}` dedupes the assessment list; `{"op":"cleanup","repo_prefix":"owner/name/feasibility"}` also deletes demo assessments and findings under that prefix.

## 4. Replay a received advisory (labelled, never counted as live)

```bash
curl -X POST "$APP_URL/api/admin" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d @replay.json
# {"op":"replay_ghsa","payload":{"action":"published","security_advisory":{...}}}
```

The same pipeline runs; every resulting assessment and notification is marked **replayed**. Repeated replays of the same payload reuse the same item id.

## 5. On-demand / agent-callable analysis

```bash
curl -X POST "$APP_URL/api/analyze" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"advisory_id":"GHSA-f82v-jwr5-mffw"}'
```

## 6. Status, latency and acceptance tests

`GET /api/status` (public) reports each source's class (push / near_realtime / periodic), nominal and measured interval, first and last successful poll, per-stage latency medians (L1 publish→discover per source, L2 extract, L3 assess, L4 alert, L5 push sent, L6 push received, totals) over live items with first-run backlog excluded, and `unattended_24h` (poll runs logged in the last 24 h vs expected) for AT-3.

## 7. Local development

```bash
npm install
npm run dev        # http://localhost:3000 ; store = .data/store.json ; findings are processed inline
npm test           # unit tests (no network, no model)
npm run typecheck && npm run lint
```

Set at least `META_API_KEY`, `GITHUB_TOKEN`, `ADMIN_TOKEN` in `.env.local`; add the sign-in and App variables to try onboarding locally (GitHub callback URLs must then point at `http://localhost:3000`). Trigger the scheduler with `curl -X POST "localhost:3000/api/poll/tick?force=1" -H "authorization: Bearer $ADMIN_TOKEN"`.

**Signed-in UI without OAuth credentials (local only):** `AW_DEV_USER=<login>` in `.env.local` signs in a stub user `dev:<login>`. It is honoured only when `NODE_ENV` is not `production` **and** none of the sign-in variables is set, so it can never activate on Vercel. With `DEMO_SHARED_REPOS=1` the stub sees admin-registered repos; `{"op":"watch","repo":"owner/name","subdir":"…","user_id":"dev:<login>","allow_pr":true}` links a repository to the stub so the approval dialog can be exercised (the apply is still refused without an App installation).
