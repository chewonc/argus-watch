# Argus Watch — setup and operations

Everything here is read-only toward your repositories. Argus Watch never executes repository code, never runs tests it generates, and never reproduces or exploits a vulnerability.

## 1. Secrets (never commit, never paste into chat)

Create `.env.local` at the project root (gitignored). On Vercel, add the same names under Project → Settings → Environment Variables.

| Variable | Required | What it is |
|---|---|---|
| `META_API_KEY` | yes | Meta Model API key (dev.meta.ai). Used only for Muse Spark 1.3 structured-output calls. |
| `META_MODEL` | no | Defaults to `muse-spark-1.3`. |
| `GITHUB_TOKEN` | yes in practice | A fine-grained token with **read-only Contents** on the watched repos (public repos: a token is still needed because unauthenticated reads are limited to 60/hour). |
| `GITHUB_WEBHOOK_SECRET` | yes | The secret you set on the GitHub App webhook. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | yes for deployment | Durable storage. Without them the app uses `.data/store.json` (dev only). |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | yes for deployment | Scheduler + queue. Without them, polls run only when called and findings are processed inline. |
| `ALERT_WEBHOOK_URL` | optional | A Slack or Discord *incoming webhook* URL. Alerts always also land in the in-app inbox. |
| `ADMIN_TOKEN` | yes | A long random string. Protects `/api/admin`, `/api/analyze`, and manual poll triggers. |
| `APP_URL` | yes for deployment | Public base URL, e.g. `https://argus-watch.vercel.app`. QStash calls back to it. |

## 2. Accounts and one-time setup (owner actions, ~45 minutes)

1. **Vercel:** import the repo, add the env vars, deploy. Functions use up to 300 s (Hobby limit).
2. **Upstash:** create one Redis database (free) and copy the REST URL/token. Create a QStash project (free) and copy the token and both signing keys.
3. **GitHub App** (Settings → Developer settings → GitHub Apps → New):
   - Webhook URL: `https://<APP_URL>/api/webhooks/github`; Webhook secret: your `GITHUB_WEBHOOK_SECRET`.
   - Permissions: none are needed for the global advisory event. (For private watched repos, add *Contents: read* and install the app on them, or use `GITHUB_TOKEN`.)
   - **Subscribe to events: "Security advisory"** (this is the global, GitHub-reviewed advisory stream; it is only available to GitHub Apps).
   - Install the app on your account (required for deliveries to start). Then open Advanced → Recent deliveries and confirm the `ping` arrived (it is logged in the app's Live log).
4. **QStash schedules** (QStash console → Schedules), both POST with no body:
   - `https://<APP_URL>/api/poll/kev` every 30 minutes (`*/30 * * * *`)
   - `https://<APP_URL>/api/poll/rss` every 10 minutes (`*/10 * * * *`)
   QStash signs these requests; the routes verify the signature.
5. **Backup heartbeat (optional):** the workflow in `.github/workflows/heartbeat.yml` calls `/api/admin` `{"op":"heartbeat"}` every 15 minutes and re-runs any poll that is stale. Add repository secrets `APP_URL` and `ADMIN_TOKEN`.

## 3. Register watched repositories

```bash
curl -X POST "$APP_URL/api/admin" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"op":"watch","repo":"owner/name","default_branch":"main","label":"production"}'
```

Optional `"subdir":"path/inside/repo"` watches a sub-folder (used for the demo fixtures under `feasibility/cases/`).

## 4. Replay a received advisory (labeled, never counted as live)

```bash
curl -X POST "$APP_URL/api/admin" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d @replay.json   # {"op":"replay_ghsa","payload":{"action":"published","security_advisory":{...}}}
```

The payload shape is the GitHub `security_advisory` webhook payload. The same pipeline runs; every resulting assessment is marked **replayed**.

## 5. On-demand / agent-callable analysis (manual override)

```bash
curl -X POST "$APP_URL/api/analyze" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"advisory_id":"GHSA-f82v-jwr5-mffw"}'
```

Returns the finding and its assessments as JSON. This is the read-only tool contract an agent can call.

## 6. Local development

```bash
npm install
npm run dev     # http://localhost:3000 ; store = .data/store.json ; findings are processed inline
```

Set at least `META_API_KEY`, `GITHUB_TOKEN` and `ADMIN_TOKEN` in `.env.local`. Trigger a poll with
`curl -X POST localhost:3000/api/poll/rss -H "authorization: Bearer $ADMIN_TOKEN"`.
